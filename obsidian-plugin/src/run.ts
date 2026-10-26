/*
 * One PDF's way to a chapter note: upload, extract, analyze (prepare), then generate and write. Kept apart from the
 * modal so a generation keeps going, and its note still gets written, after the modal is closed.
 *
 * A PDF already sent to the backend is not sent again: the plugin remembers its paper id with the file's size and
 * modification time, and reuses the extraction and analysis while the file is unchanged. That saves plan usage.
 */
import { ApiError, type ExportOptions, type Paper2ChapterClient } from './api.ts';
import { CHAPTER_ROWS, isClassicNote, lines, type P2CSettings, type PaperCacheEntry } from './config.ts';
import { renderProperties, withoutFrontmatter } from './frontmatter.ts';
import { quietDelay, resolveFolder, resolveName } from './output.ts';
import type { PaperIdentity } from './paperNote.ts';
import { pathToFileUrl, type PaperMeta } from './sources.ts';
import { renderBody, TEXTBOOK_TEMPLATE } from './template.ts';
import { buildTokens, fill, type FormatDate, type Tokens } from './tokens.ts';
import type { ChapterParts, Estimate, GenerationOptions, PaperAnalysis, PaperRecord } from './types.ts';
import { usablePageLink } from './validate.ts';
import { writeChapter, type VaultLike, type WriteResult } from './writer.ts';

export type { PaperCacheEntry } from './config.ts';

export interface PaperCache {
	get(pdfPath: string): PaperCacheEntry | undefined;
	set(pdfPath: string, entry: PaperCacheEntry): Promise<void>;
}

export interface PdfSource {
	path: string; // the vault path; for a PDF outside the vault, the key the cache keeps it under
	name: string;
	stamp: string; // size + mtime: changes when the file does
	read(): Promise<ArrayBuffer>;
	kind?: 'vault' | 'file' | 'zotero'; // default: vault
	absPath?: string; // the file on this computer (file, zotero)
	zotero?: { itemKey: string; pdfKey: string };
	meta?: PaperMeta; // what the source knows of the paper (Zotero's metadata)
}

export interface RunStatus {
	phase: 'upload' | 'extract' | 'analyze' | 'prepared' | 'generate' | 'write' | 'done';
	progress: number; // 0..1 within the phase
	message: string;
}

export type StatusFn = (s: RunStatus) => void;

/** What writing a note needs from Obsidian; injected, so the logic is tested in Node. */
export interface NoteEnv {
	formatDate: FormatDate;
	now: () => Date;
	wait: (ms: number) => Promise<void>;
	paperNote: (who: PaperIdentity) => { linktext: string; folder: string } | null;
	template: (path: string) => Promise<string>;
	attachmentPath?: (filename: string, notePath: string) => Promise<string>;
}

export interface OutputOptions {
	folder: string;
	attachments: string;
	solutions: boolean;
	/** The note settings. Without them the note is written as 0.1.1 wrote it, from `folder` and `attachments`. */
	note?: P2CSettings;
	env?: NoteEnv;
}

const PDF_LINK_BAD = /[[\]|#^\r\n]/;
/** Tokens only the parts know: a folder or name template using one needs them even for the classic note. */
const PARTS_TOKENS = ['title', 'doi', 'arxiv', 'paperNote', 'paperNoteFolder', 'provider', 'model', 'generated'];

const DEFAULT_ENV: NoteEnv = {
	formatDate: () => new Date().toISOString().slice(0, 10),
	now: () => new Date(),
	wait: (ms) => new Promise<void>((r) => window.setTimeout(r, ms)),
	paperNote: () => null,
	template: async (p) => { throw new Error(`Cannot read the template note ${p}.`); },
};

const pad = (n: number) => String(n).padStart(2, '0');
const usesAny = (templates: string[], names: string[]) => templates.some((t) => names.some((n) => t.includes(`{{${n}}}`)));

export class ChapterRun {
	paperId = '';
	analysis: PaperAnalysis | null = null;
	estimate: Estimate | null = null;
	private signal = { aborted: false };
	private client: Paper2ChapterClient;
	private vault: VaultLike;
	private pdf: PdfSource;
	private cache: PaperCache;
	private sleep?: (ms: number) => Promise<void>;

	constructor(client: Paper2ChapterClient, vault: VaultLike, pdf: PdfSource, cache: PaperCache, sleep?: (ms: number) => Promise<void>) {
		this.client = client;
		this.vault = vault;
		this.pdf = pdf;
		this.cache = cache;
		this.sleep = sleep;
	}

	cancel(): void {
		this.signal.aborted = true;
	}

	private wait(want: PaperRecord['status'][], phase: RunStatus['phase'], on: StatusFn): Promise<PaperRecord> {
		return this.client.waitFor(this.paperId, want, {
			signal: this.signal,
			sleep: this.sleep,
			onProgress: (rec) => on({ phase, progress: rec.job?.progress ?? 0, message: rec.job?.message || rec.status }),
		});
	}

	/** Upload (or reuse), extract and analyze. Ends with the analysis, ready for the reader's choices. */
	async prepare(on: StatusFn): Promise<PaperAnalysis> {
		let rec = await this.reuse();
		if (!rec) {
			on({ phase: 'upload', progress: 0, message: `Uploading ${this.pdf.name}` });
			rec = await this.client.upload(this.pdf.name, await this.pdf.read());
			this.paperId = rec.id;
			const entry: PaperCacheEntry = { paperId: rec.id, stamp: this.pdf.stamp };
			if (this.pdf.kind === 'file' || this.pdf.kind === 'zotero') {
				Object.assign(entry, { kind: this.pdf.kind, absPath: this.pdf.absPath, zotero: this.pdf.zotero, meta: this.pdf.meta });
			}
			await this.cache.set(this.pdf.path, entry);
		}
		if (!rec.has_analysis) {
			if (rec.status !== 'extracted') rec = await this.wait(['extracted', 'analyzed', 'ready'], 'extract', on);
			if (!rec.has_analysis) {
				on({ phase: 'analyze', progress: 0, message: 'Analyzing the paper' });
				await this.client.analyze(this.paperId);
				await this.wait(['analyzed', 'ready'], 'analyze', on);
			}
		}
		this.analysis = await this.client.analysis(this.paperId);
		try {
			this.estimate = await this.client.estimate(this.paperId);
		} catch {
			this.estimate = null;
		}
		on({ phase: 'prepared', progress: 1, message: 'Ready to generate' });
		return this.analysis;
	}

	/** A paper the backend already has for this exact file, or null to upload it again. */
	private async reuse(): Promise<PaperRecord | null> {
		const hit = this.cache.get(this.pdf.path);
		if (!hit || hit.stamp !== this.pdf.stamp) return null;
		let rec: PaperRecord;
		try {
			rec = await this.client.paper(hit.paperId);
		} catch (e) {
			if (e instanceof ApiError && e.status === 404) return null;
			throw e;
		}
		if (rec.status === 'failed' && !rec.has_analysis && rec.job?.kind === 'extract') return null;
		this.paperId = rec.id;
		if (rec.status === 'failed' || rec.job?.status === 'failed') {
			// analysis or generation failed earlier: the extraction is still good
			return { ...rec, status: rec.has_analysis ? 'analyzed' : 'extracted' };
		}
		return rec;
	}

	/** Generate the chapter and write it into the vault. */
	async generate(options: GenerationOptions, out: OutputOptions, on: StatusFn): Promise<WriteResult> {
		if (!this.paperId) throw new Error('Prepare the paper first.');
		on({ phase: 'generate', progress: 0, message: 'Starting generation' });
		await this.client.generate(this.paperId, options);
		await this.wait(['ready'], 'generate', on);
		return this.write(out, on);
	}

	/**
	 * Write the paper's current chapter into the vault (also used to import one generated earlier). The note is
	 * named after the paper, so it sorts next to the PDF it came from.
	 */
	async write(out: OutputOptions, on: StatusFn, paperId = this.paperId, title = ''): Promise<WriteResult> {
		on({ phase: 'write', progress: 0, message: 'Writing the note' });
		if (out.note) return this.writeNote(out.note, out.env ?? DEFAULT_ENV, on, paperId, title);
		const pdfLink = this.vaultPdfLink();
		const res = await writeChapter(this.vault, {
			markdown: (prefix) => this.client.exportMarkdown(paperId, { solutions: out.solutions, assetPrefix: prefix, pdfLink }),
			asset: (name) => this.client.asset(paperId, name),
		}, {
			folder: out.folder,
			attachments: out.attachments,
			title: title || this.analysis?.title || this.pdf.name.replace(/\.pdf$/i, ''),
		});
		on({ phase: 'done', progress: 1, message: `Wrote ${res.notePath}` });
		return res;
	}

	/** The PDF's vault path when it can be a wikilink: a PDF outside the vault is never one. */
	private vaultPdfLink(): string {
		const vault = (this.pdf.kind ?? 'vault') === 'vault';
		return vault && this.pdf.path && !PDF_LINK_BAD.test(this.pdf.path) ? this.pdf.path : '';
	}

	/** Page links by the settings: to the vault PDF, Zotero, a file on this computer, a template, or none. */
	private links(s: P2CSettings, tokens: Tokens, formatDate: FormatDate): { pdfLink: string; pageLink: string } {
		const pdfLink = this.vaultPdfLink();
		if (s.pageLinks === 'plain') return { pdfLink: '', pageLink: '' };
		if (s.pageLinks === 'custom') {
			const encoded: Tokens = Object.fromEntries(Object.entries(tokens).map(([k, v]) =>
				[k, Array.isArray(v) ? v.map(encodeURIComponent) : v === undefined ? v : encodeURIComponent(v)]));
			return { pdfLink, pageLink: usablePageLink(fill(s.pageLinkTemplate, encoded, formatDate)) };
		}
		if (this.pdf.kind === 'zotero' && this.pdf.zotero?.pdfKey) {
			return { pdfLink: '', pageLink: `zotero://open-pdf/library/items/${encodeURIComponent(this.pdf.zotero.pdfKey)}?page={page}` };
		}
		if (this.pdf.kind === 'file' && this.pdf.absPath) {
			return { pdfLink: '', pageLink: usablePageLink(pathToFileUrl(this.pdf.absPath) + '#page={page}') };
		}
		return { pdfLink, pageLink: '' };
	}

	private async writeNote(s: P2CSettings, env: NoteEnv, on: StatusFn, paperId: string, title: string): Promise<WriteResult> {
		const delay = quietDelay(env.now(), s.quietHours);
		if (delay > 0) {
			const end = new Date(env.now().getTime() + delay);
			on({ phase: 'write', progress: 0, message: `Waiting for the quiet hours to end at ${pad(end.getHours())}:${pad(end.getMinutes())}` });
			await env.wait(delay);
		}
		const meta = this.pdf.meta ?? {};
		const classic = isClassicNote(s);
		let analysis = this.analysis;
		// the classic note asks the backend nothing 0.1.1 did not, unless a folder or name template needs the paper
		if (!analysis && (!classic || usesAny([s.outputFolder, s.noteName], ['authors', 'firstAuthor', 'year', 'field', 'paperSlug', ...PARTS_TOKENS]))) {
			try { analysis = await this.client.analysis(paperId); } catch { analysis = null; }
		}
		const fd = env.formatDate;
		const paperTitle = title || analysis?.title || meta.title || this.pdf.name.replace(/\.pdf$/i, '');
		const vault = (this.pdf.kind ?? 'vault') === 'vault';
		const sources = {
			paperTitle,
			authors: analysis?.authors ?? meta.authors ?? [],
			year: analysis?.year ?? meta.year ?? '',
			field: analysis?.field ?? '',
			doi: meta.doi ?? '',
			arxiv: meta.arxiv ?? '',
			zoteroKey: this.pdf.zotero?.itemKey ?? '',
			zoteroPdfKey: this.pdf.zotero?.pdfKey ?? '',
			pdf: vault ? this.pdf.path : this.pdf.absPath ?? '',
			pdfLink: this.vaultPdfLink(),
			paperId,
		};
		const { pdfLink, pageLink } = this.links(s, buildTokens(sources), fd);
		const ex: ExportOptions = { solutions: s.solutions, assetPrefix: '', pdfLink, pageLink };

		const needParts = !classic || s.propertiesMode === 'custom'
			|| usesAny([s.outputFolder, s.noteName], PARTS_TOKENS);
		const parts: ChapterParts | null = needParts ? await this.client.exportParts(paperId, ex) : null;
		const who: PaperIdentity = {
			pdfPath: sources.pdf, zoteroKey: sources.zoteroKey || undefined, zoteroKeys: sources.zoteroPdfKey ? [sources.zoteroPdfKey] : [],
			doi: parts?.paper.doi || sources.doi, arxiv: parts?.paper.arxiv || sources.arxiv, title: paperTitle,
		};
		const paperNote = lines(s.paperNoteKeys).length ? env.paperNote(who) : null;
		const tokens = buildTokens({
			...sources,
			chapterTitle: parts?.title,
			authors: sources.authors.length ? sources.authors : parts?.paper.authors ?? [],
			year: sources.year || parts?.paper.year || '',
			field: sources.field || parts?.paper.field || '',
			doi: who.doi ?? '',
			arxiv: who.arxiv ?? '',
			paperNote,
			provider: parts?.provider, model: parts?.model, audience: parts?.audience, generated: parts?.generated_at,
		});
		const folder = resolveFolder(s.outputFolder, tokens, fd);
		const name = resolveName(s.noteName, tokens, fd, paperTitle);

		const markdown = async (prefix: string) => {
			if (classic || s.layout === 'paper2chapter') {
				const md = await this.client.exportMarkdown(paperId, { ...ex, assetPrefix: prefix });
				if (classic) return md;
				const fm = renderProperties(s.propertyRows, tokens, fd);
				const body = withoutFrontmatter(md.markdown);
				return { markdown: fm ? fm + body : body.replace(/^\n+/, ''), assets: md.assets };
			}
			const p = parts!;
			const template = s.layout === 'textbook' ? TEXTBOOK_TEMPLATE : await env.template(s.templatePath);
			let body = renderBody(template, p, { headingLevel: s.headingLevel, sectionHeading: s.sectionHeading, examples: s.examples }, tokens, fd);
			// the parts came without the figures' prefix: their embeds take it here
			for (const a of p.assets) body = body.split(`![[${a}]]`).join(`![[${prefix}${a}]]`);
			const fm = renderProperties(s.propertiesMode === 'custom' ? s.propertyRows : CHAPTER_ROWS, tokens, fd);
			return { markdown: fm ? `${fm}\n${body}` : body, assets: p.assets };
		};
		const res = await writeChapter(this.vault, { markdown, asset: (n) => this.client.asset(paperId, n) }, {
			folder, attachments: s.attachments, title: name, figures: s.figures, figuresFolder: s.figuresFolder,
			onExists: s.onExists, attachmentPath: env.attachmentPath,
		});
		on({ phase: 'done', progress: 1, message: res.skipped ? `A note named ${res.notePath} is there already: nothing written` : `Wrote ${res.notePath}` });
		return res;
	}
}
