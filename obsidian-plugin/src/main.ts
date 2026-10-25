import { FuzzySuggestModal, normalizePath, Notice, Platform, Plugin, requestUrl, TFile, type App } from 'obsidian';
import { Paper2ChapterClient, type Http } from './api.ts';
import { BackendManager, type SpawnFn } from './backend.ts';
import { GenerateModal } from './modal.ts';
import { ChapterRun, type PdfSource, type RunStatus } from './run.ts';
import { DEFAULT_SETTINGS, P2CSettingTab, type P2CSettings } from './settings.ts';
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<P2CSettings> | null);
		this.settings.papers ??= {};
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

	private newRun(file: TFile | null): ChapterRun {
		const empty: PdfSource = { path: '', name: 'paper.pdf', stamp: '', read: async () => new ArrayBuffer(0) };
		return new ChapterRun(this.client(), this.vault(), file ? this.source(file) : empty, {
			get: (p) => this.settings.papers[p],
			set: async (p, entry) => {
				this.settings.papers[p] = entry;
				await this.saveSettings();
			},
		});
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
		void this.modelText().then((text) => new GenerateModal(this.app, this, this.newRun(file), file.name, text).open());
	}

	private pickPdf(): void {
		const pdfs = this.app.vault.getFiles().filter((f) => f.extension === 'pdf');
		if (!pdfs.length) {
			new Notice('There is no PDF in this vault.');
			return;
		}
		new PdfSuggest(this.app, pdfs, (f) => this.openGenerate(f)).open();
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
		const pdfPath = Object.entries(this.settings.papers).find(([, v]) => v.paperId === p.id)?.[0];
		const file = pdfPath ? this.app.vault.getAbstractFileByPath(pdfPath) : null;
		const run = this.newRun(file instanceof TFile ? file : null);
		try {
			const res = await run.write(this.outOpts(), () => {}, p.id, p.title || p.filename.replace(/\.pdf$/i, ''));
			new Notice(`paper2chapter: wrote ${res.notePath}`);
			if (this.settings.openAfter) await this.openNote(res.notePath);
		} catch (e) {
			new Notice((e as Error).message, 10000);
		}
	}

	private outOpts() {
		return { folder: this.settings.outputFolder, attachments: this.settings.attachments, solutions: this.settings.solutions };
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

class PdfSuggest extends FuzzySuggestModal<TFile> {
	private files: TFile[];
	private pick: (f: TFile) => void;
	constructor(app: App, files: TFile[], pick: (f: TFile) => void) {
		super(app);
		this.files = files;
		this.pick = pick;
		this.setPlaceholder('Pick a PDF to turn into a chapter');
	}
	getItems(): TFile[] { return this.files; }
	getItemText(f: TFile): string { return f.path; }
	onChooseItem(f: TFile): void { this.pick(f); }
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
