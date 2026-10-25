/*
 * One PDF's way to a chapter note: upload, extract, analyze (prepare), then generate and write. Kept apart from the
 * modal so a generation keeps going, and its note still gets written, after the modal is closed.
 *
 * A PDF already sent to the backend is not sent again: the plugin remembers its paper id with the file's size and
 * modification time, and reuses the extraction and analysis while the file is unchanged. That saves plan usage.
 */
import { ApiError, type Paper2ChapterClient } from './api.ts';
import type { Estimate, GenerationOptions, PaperAnalysis, PaperRecord } from './types.ts';
import { writeChapter, type VaultLike, type WriteResult } from './writer.ts';

export interface PaperCacheEntry {
	paperId: string;
	stamp: string;
}

export interface PaperCache {
	get(pdfPath: string): PaperCacheEntry | undefined;
	set(pdfPath: string, entry: PaperCacheEntry): Promise<void>;
}

export interface PdfSource {
	path: string; // vault path
	name: string;
	stamp: string; // size + mtime: changes when the file does
	read(): Promise<ArrayBuffer>;
}

export interface RunStatus {
	phase: 'upload' | 'extract' | 'analyze' | 'prepared' | 'generate' | 'write' | 'done';
	progress: number; // 0..1 within the phase
	message: string;
}

export type StatusFn = (s: RunStatus) => void;

export interface OutputOptions {
	folder: string;
	attachments: string;
	solutions: boolean;
}

const PDF_LINK_BAD = /[[\]|#^\r\n]/;

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
			await this.cache.set(this.pdf.path, { paperId: rec.id, stamp: this.pdf.stamp });
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
		const pdfLink = this.pdf.path && !PDF_LINK_BAD.test(this.pdf.path) ? this.pdf.path : '';
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
}
