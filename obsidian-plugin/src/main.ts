import {
	FuzzySuggestModal, moment, normalizePath, Notice, Platform, Plugin, requestUrl, SuggestModal, TFile, type App,
} from 'obsidian';
import { Paper2ChapterClient, type Http } from './api.ts';
import { BackendManager, type SpawnFn } from './backend.ts';
import { lines, migrate, type PaperCacheEntry } from './config.ts';
import { GenerateModal } from './modal.ts';
import { findPaperNote, inFolders, type PaperIdentity } from './paperNote.ts';
import { PreviewModal } from './preview.ts';
import { ChapterRun, type NoteEnv, type PdfSource, type RunStatus } from './run.ts';
import { DEFAULT_SETTINGS, P2CSettingTab, type P2CSettings } from './settings.ts';
import { listPdfs, ZoteroClient, zoteroSuggestions, type ZoteroItem } from './sources.ts';
import type { GenerationOptions, PaperRecord } from './types.ts';
import type { VaultLike } from './writer.ts';

/** Obsidian's requestUrl: no CORS, works against a local backend from the app. */
const obsidianHttp: Http = async (req) => {
	const res = await requestUrl({ url: req.url, method: req.method ?? 'GET', body: req.body, contentType: req.contentType, throw: false });
	return { status: res.status, text: res.text, arrayBuffer: res.arrayBuffer };
};

export default class Paper2ChapterPlugin extends Plugin {
	settings: P2CSettings = { ...DEFAULT_SETTINGS };
	backend!: BackendManager;
	private apiClient: Paper2ChapterClient | null = null;
	private statusBar: HTMLElement | null = null;
	private active = 0;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.backend = new BackendManager({
			spawn: desktopSpawn(),
			health: () => this.client().health(),
			exists: desktopExists(),
			platform: Platform.isWin ? 'win32' : Platform.isMacOS ? 'darwin' : 'linux',
			env: desktopEnv(),
			killTree: desktopKillTree(),
			parentPid: desktopPid(),
		});
		this.addSettingTab(new P2CSettingTab(this.app, this));
		this.statusBar = this.addStatusBarItem();
		this.statusBar.hide();

		this.addRibbonIcon('book-open-text', 'Generate a chapter from a PDF', () => this.pickPdf());
		this.addCommand({
			id: 'generate-from-active-pdf',
			name: 'Generate a chapter from this PDF',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'pdf') return false;
				if (!checking) this.openGenerate(file);
				return true;
			},
		});
		this.addCommand({ id: 'generate-from-pdf', name: 'Generate a chapter from a PDF…', callback: () => this.pickPdf() });
		this.addCommand({ id: 'import-chapter', name: 'Import a chapter generated earlier', callback: () => void this.pickGenerated() });
		this.addCommand({ id: 'preview-note', name: 'Preview the chapter note these settings write', callback: () => this.openPreview() });
		this.addCommand({
			id: 'start-backend',
			name: 'Start the backend',
			callback: async () => {
				try {
					new Notice((await this.ensureBackend()) === 'started' ? 'paper2chapter: backend started.' : 'paper2chapter: the backend is already running.');
				} catch (e) {
					new Notice((e as Error).message, 10000);
				}
			},
		});
		this.addCommand({
			id: 'stop-backend',
			name: 'Stop the backend',
			callback: () => {
				const owned = this.backend.ownsProcess;
				this.backend.stop();
				new Notice(owned ? 'paper2chapter: backend stopped.' : 'paper2chapter: this plugin did not start the backend, so it left it running.');
			},
		});
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || file.extension !== 'pdf') return;
			menu.addItem((item) => item.setTitle('Generate a chapter').setIcon('book-open-text').onClick(() => this.openGenerate(file)));
		}));
	}

	onunload(): void {
		this.backend?.stop();
	}

	async loadSettings(): Promise<void> {
		this.settings = migrate(await this.loadData()); // any older version's settings, made current
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	client(): Paper2ChapterClient {
		this.apiClient ??= new Paper2ChapterClient(this.settings.backendUrl, obsidianHttp);
		return this.apiClient;
	}

	resetClient(): void {
		this.apiClient = null;
	}

	ensureBackend(): Promise<'running' | 'started'> {
		return this.backend.ensure(this.settings);
	}

	private vault(): VaultLike {
		const v = this.app.vault;
		return {
			exists: (p) => v.adapter.exists(normalizePath(p)),
			createFolder: async (p) => { await v.createFolder(normalizePath(p)); },
			createText: async (p, text) => { await v.create(normalizePath(p), text); },
			createBinary: async (p, data) => { await v.createBinary(normalizePath(p), data); },
		};
	}

	private source(file: TFile): PdfSource {
		return {
			path: file.path,
			name: file.name,
			stamp: `${file.stat.size}:${file.stat.mtime}`,
			read: () => this.app.vault.readBinary(file),
		};
	}

	/** A PDF on this computer, outside the vault: read from disk, never copied in. */
	private fileSource(absPath: string, extra: Partial<PdfSource> = {}): PdfSource {
		const fs = nodeRequire()?.('fs') as NodeFs | undefined;
		if (!fs) throw new Error('Reading a PDF outside the vault needs the desktop app.');
		let stamp = '';
		try {
			const st = fs.statSync(absPath);
			stamp = `${st.size}:${Math.round(st.mtimeMs)}`;
		} catch {
			throw new Error(`Cannot read ${absPath}.`);
		}
		return {
			path: absPath, name: absPath.split(/[\\/]/).pop() ?? 'paper.pdf', stamp, kind: 'file', absPath,
			read: async () => {
				const b = fs.readFileSync(absPath);
				return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
			},
			...extra,
		};
	}

	private newRun(src: PdfSource | null): ChapterRun {
		const empty: PdfSource = { path: '', name: 'paper.pdf', stamp: '', read: async () => new ArrayBuffer(0) };
		return new ChapterRun(this.client(), this.vault(), src ?? empty, {
			get: (p) => this.settings.papers[p],
			set: async (p, entry) => {
				this.settings.papers[p] = entry;
				await this.saveSettings();
			},
		});
	}

	zotero(): ZoteroClient {
		return new ZoteroClient(this.settings.zoteroUrl, obsidianHttp);
	}

	/** What writing a note needs from Obsidian: dates, the paper's own note, template notes, attachment paths. */
	noteEnv(): NoteEnv {
		const app = this.app;
		return {
			formatDate: (f) => moment().format(f),
			now: () => new Date(),
			wait: (ms) => new Promise<void>((r) => window.setTimeout(r, ms)),
			paperNote: (who: PaperIdentity) => {
				const folders = lines(this.settings.paperNoteFolders);
				const files = app.vault.getMarkdownFiles().filter((f) => inFolders(f.path, folders));
				const hit = findPaperNote(files.map((f) => ({
					path: f.path, basename: f.basename, frontmatter: app.metadataCache.getFileCache(f)?.frontmatter ?? {},
				})), who, lines(this.settings.paperNoteKeys));
				const file = hit ? app.vault.getAbstractFileByPath(hit.path) : null;
				if (!(file instanceof TFile)) return null;
				const parent = file.parent?.path ?? '';
				return { linktext: app.metadataCache.fileToLinktext(file, ''), folder: parent === '/' ? '' : parent };
			},
			template: async (path) => {
				const f = app.vault.getAbstractFileByPath(normalizePath(path));
				if (!(f instanceof TFile)) throw new Error(`The template note ${path} does not exist.`);
				return app.vault.cachedRead(f);
			},
			attachmentPath: (name, notePath) => app.fileManager.getAvailablePathForAttachment(name, notePath),
		};
	}

	openPreview(): void {
		const exists = (p: string) => this.app.vault.getAbstractFileByPath(normalizePath(p)) !== null;
		new PreviewModal(this.app, this.settings, this.noteEnv(), exists).open();
	}

	private async modelText(): Promise<string> {
		try {
			const s = await this.client().settings();
			const p = s.providers.find((x) => x.id === s.selection.provider);
			return `Model: ${p?.label ?? s.selection.provider} / ${s.selection.model} (change it in the plugin settings)`;
		} catch {
			return '';
		}
	}

	openGenerate(file: TFile): void {
		this.openSource(this.source(file));
	}

	openSource(src: PdfSource): void {
		void this.modelText().then((text) => new GenerateModal(this.app, this, this.newRun(src), src.name, text).open());
	}

	/** Every paper the enabled sources offer: the vault's PDFs, folders on this computer, and a way into Zotero. */
	private pickPdf(): void {
		const items: SourceItem[] = [];
		if (this.settings.vaultPdfs) {
			for (const f of this.app.vault.getFiles().filter((x) => x.extension === 'pdf')) items.push({ label: f.path, pick: () => this.openGenerate(f) });
		}
		const folders = lines(this.settings.pdfFolders);
		const fs = nodeRequire()?.('fs') as NodeFs | undefined;
		if (folders.length && fs) {
			const readdir = (d: string) => fs.readdirSync(d, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }));
			for (const p of listPdfs(folders, { readdir })) {
				items.push({ label: p, note: 'on this computer', pick: () => this.tryOpen(() => this.fileSource(p)) });
			}
		}
		if (this.settings.zotero) items.unshift({ label: 'Search Zotero…', note: 'Zotero', pick: () => new ZoteroSuggest(this.app, this).open() });
		if (!items.length) {
			new Notice('No paper to pick: there is no PDF in the vault, and no other source is set up (see the settings).');
			return;
		}
		new SourceSuggest(this.app, items).open();
	}

	private tryOpen(make: () => PdfSource): void {
		try {
			this.openSource(make());
		} catch (e) {
			new Notice((e as Error).message, 10000);
		}
	}

	/** A Zotero item's PDF, read from where Zotero keeps it. */
	async openZoteroItem(item: ZoteroItem): Promise<void> {
		try {
			const z = this.zotero();
			const att = await z.pdf(item.key);
			if (!att) {
				new Notice(`"${item.title}" has no PDF in Zotero.`, 8000);
				return;
			}
			const abs = await z.filePath(att.key, Platform.isWin ? 'win32' : Platform.isMacOS ? 'darwin' : 'linux');
			const src = this.fileSource(abs, {
				path: `zotero:${att.key}`, kind: 'zotero', zotero: { itemKey: item.key, pdfKey: att.key },
				meta: { title: item.title, authors: item.authors, year: item.year, doi: item.doi, arxiv: item.arxiv },
			});
			if (att.stamp.replace(':', '')) src.stamp = att.stamp;
			this.openSource(src);
		} catch (e) {
			new Notice((e as Error).message, 10000);
		}
	}

	/** The source a cached paper came from, so its note can be written again. */
	private cachedSource(path: string, entry: PaperCacheEntry): PdfSource | null {
		if (entry.kind === 'file' || entry.kind === 'zotero') {
			return {
				path, name: (entry.absPath ?? path).split(/[\\/]/).pop() ?? 'paper.pdf', stamp: entry.stamp, read: async () => new ArrayBuffer(0),
				kind: entry.kind, absPath: entry.absPath, zotero: entry.zotero, meta: entry.meta,
			};
		}
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? this.source(file) : null;
	}

	private async pickGenerated(): Promise<void> {
		let papers: PaperRecord[];
		try {
			await this.ensureBackend();
			papers = (await this.client().listPapers()).filter((p) => p.has_chapter);
		} catch (e) {
			new Notice((e as Error).message, 10000);
			return;
		}
		if (!papers.length) {
			new Notice('The backend has no generated chapter yet.');
			return;
		}
		new PaperSuggest(this.app, papers, (p) => void this.importChapter(p)).open();
	}

	private async importChapter(p: PaperRecord): Promise<void> {
		const hit = Object.entries(this.settings.papers).find(([, v]) => v.paperId === p.id);
		const run = this.newRun(hit ? this.cachedSource(hit[0], hit[1]) : null);
		try {
			const res = await run.write(this.outOpts(), () => {}, p.id, p.title || p.filename.replace(/\.pdf$/i, ''));
			new Notice(res.skipped ? `paper2chapter: ${res.notePath} is there already; nothing written.` : `paper2chapter: wrote ${res.notePath}`);
			if (this.settings.openAfter && !res.skipped) await this.openNote(res.notePath);
		} catch (e) {
			new Notice((e as Error).message, 10000);
		}
	}

	private outOpts() {
		return {
			folder: this.settings.outputFolder, attachments: this.settings.attachments, solutions: this.settings.solutions,
			note: this.settings, env: this.noteEnv(),
		};
	}

	/** Runs in the plugin, not the modal: closing the modal does not stop it. */
	startGeneration(run: ChapterRun, options: GenerationOptions, modal: GenerateModal): void {
		this.active++;
		const report = (s: RunStatus) => {
			modal.status(s);
			if (this.statusBar) {
				this.statusBar.show();
				this.statusBar.setText(`📖 ${s.phase === 'generate' ? Math.round(s.progress * 100) + '%' : s.phase}`);
			}
		};
		void run.generate(options, this.outOpts(), report).then(async (res) => {
			if (res.skipped) {
				new Notice(`paper2chapter: the chapter is ready, but ${res.notePath} is there already, so nothing was written.`, 12000);
				modal.showError(`A note named ${res.notePath} is there already. The chapter stays on the backend: "Import a chapter generated earlier" writes it.`);
				return;
			}
			new Notice(`paper2chapter: chapter ready, ${res.notePath}`);
			modal.showDone(res.notePath);
			if (this.settings.openAfter) await this.openNote(res.notePath);
		}).catch((e: Error) => {
			new Notice(`paper2chapter: ${e.message}`, 12000);
			modal.showError(e.message);
		}).finally(() => {
			this.active--;
			if (this.active === 0) this.statusBar?.hide();
		});
	}

	async openNote(path: string): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (f instanceof TFile) await this.app.workspace.getLeaf(true).openFile(f);
	}
}

interface SourceItem {
	label: string;
	note?: string;
	pick: () => void;
}

/** The paper picker: the vault's PDFs, PDFs on this computer, and Zotero. */
class SourceSuggest extends FuzzySuggestModal<SourceItem> {
	private items: SourceItem[];
	constructor(app: App, items: SourceItem[]) {
		super(app);
		this.items = items;
		this.setPlaceholder('Pick a paper to turn into a chapter');
	}
	getItems(): SourceItem[] { return this.items; }
	getItemText(i: SourceItem): string { return i.note ? `${i.label} · ${i.note}` : i.label; }
	onChooseItem(i: SourceItem): void { i.pick(); }
}

/** Zotero's items, searched as you type (title, creators, year), through Zotero's local API. */
class ZoteroSuggest extends SuggestModal<ZoteroItem> {
	private plugin: Paper2ChapterPlugin;
	constructor(app: App, plugin: Paper2ChapterPlugin) {
		super(app);
		this.plugin = plugin;
		this.setPlaceholder('Search Zotero: title, author or year');
		this.emptyStateText = 'Type two letters or more.';
	}
	async getSuggestions(query: string): Promise<ZoteroItem[]> {
		// why nothing was found (Zotero not running, its API off, no match) shows in place of the list, once
		const r = await zoteroSuggestions(this.plugin.zotero(), query);
		this.emptyStateText = r.empty;
		return r.items;
	}
	renderSuggestion(item: ZoteroItem, el: HTMLElement): void {
		el.createDiv({ text: item.title || '(untitled)' });
		const who = (item.authors ?? []).slice(0, 3).join(', ') + ((item.authors?.length ?? 0) > 3 ? ' et al.' : '');
		el.createEl('small', { cls: 'p2c-muted', text: [who, item.year].filter(Boolean).join(' · ') });
	}
	onChooseSuggestion(item: ZoteroItem): void {
		void this.plugin.openZoteroItem(item);
	}
}

class PaperSuggest extends FuzzySuggestModal<PaperRecord> {
	private papers: PaperRecord[];
	private pick: (p: PaperRecord) => void;
	constructor(app: App, papers: PaperRecord[], pick: (p: PaperRecord) => void) {
		super(app);
		this.papers = papers;
		this.pick = pick;
		this.setPlaceholder('Pick a generated chapter to write into the vault');
	}
	getItems(): PaperRecord[] { return this.papers; }
	getItemText(p: PaperRecord): string { return `${p.title || p.filename} (${p.filename})`; }
	onChooseItem(p: PaperRecord): void { this.pick(p); }
}

/* Desktop-only pieces. Node's modules exist in Obsidian's desktop app; the plugin is marked desktop-only. */
type NodeRequire = (id: string) => unknown;
interface NodeFs {
	statSync(p: string): { size: number; mtimeMs: number };
	readFileSync(p: string): Uint8Array;
	readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
}
function nodeRequire(): NodeRequire | null {
	if (!Platform.isDesktopApp) return null;
	const w = window as unknown as { require?: NodeRequire };
	return typeof w.require === 'function' ? w.require : null;
}

function desktopSpawn(): SpawnFn {
	return (cmd, args, opts) => {
		const req = nodeRequire();
		if (!req) throw new Error('Starting the backend needs the desktop app.');
		const cp = req('child_process') as { spawn: (c: string, a: string[], o: object) => ReturnType<SpawnFn> };
		return cp.spawn(cmd, args, { cwd: opts.cwd, env: opts.env, windowsHide: true });
	};
}

function desktopExists(): (p: string) => boolean {
	return (p) => {
		const req = nodeRequire();
		if (!req) return false;
		return (req('fs') as { existsSync: (p: string) => boolean }).existsSync(p);
	};
}

function desktopEnv(): Record<string, string | undefined> {
	const req = nodeRequire();
	return req ? { ...(req('process') as { env: Record<string, string | undefined> }).env } : {};
}

function desktopPid(): number | undefined {
	const req = nodeRequire();
	return req ? (req('process') as { pid: number }).pid : undefined;
}

function desktopKillTree(): (pid: number) => void {
	return (pid) => {
		const req = nodeRequire();
		if (!req) return;
		const cp = req('child_process') as { spawnSync: (c: string, a: string[], o: object) => unknown };
		const proc = req('process') as { platform: string; kill: (pid: number) => void };
		if (proc.platform === 'win32') cp.spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true });
		else proc.kill(pid);
	};
}
