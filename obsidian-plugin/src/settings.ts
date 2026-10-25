import { App, Notice, PluginSettingTab, type Setting, type SettingDefinitionItem } from 'obsidian';
import type Paper2ChapterPlugin from './main.ts';
import type { PaperCacheEntry } from './run.ts';
import type { AppSettings, Audience, Effort, Selection } from './types.ts';

export interface P2CSettings {
	backendUrl: string;
	backendDir: string;
	pythonPath: string;
	autoStart: boolean;
	outputFolder: string;
	attachments: string;
	solutions: boolean;
	audience: Audience;
	includePython: boolean;
	openAfter: boolean;
	papers: Record<string, PaperCacheEntry>;
}

export const DEFAULT_SETTINGS: P2CSettings = {
	backendUrl: 'http://127.0.0.1:8000',
	backendDir: '',
	pythonPath: '',
	autoStart: true,
	outputFolder: 'Paper chapters',
	attachments: 'attachments',
	solutions: true,
	audience: 'undergraduate',
	includePython: true,
	openAfter: true,
	papers: {},
};

export const AUDIENCES: Record<Audience, string> = {
	'high-school': 'High school',
	undergraduate: 'Undergraduate',
	graduate: 'Graduate',
	practitioner: 'Practitioner',
};

const TIER: Record<string, string> = {
	subscription: 'included in your plan', free: 'free', 'free-tier': 'free tier', local: 'local', paid: 'paid',
};

/** A short dropdown label: the provider's own note already says a subscription is included. */
export function modelLabel(m: AppSettings['providers'][number]['models'][number]): string {
	if (m.tier === 'subscription') return m.label;
	const cost = m.typical_chapter_cost_usd === null ? '' : m.typical_chapter_cost_usd === 0
		? ' · free' : ` · ~$${m.typical_chapter_cost_usd.toFixed(2)}/chapter`;
	return `${m.label} (${TIER[m.tier] ?? m.tier}${cost})`;
}

/** Text settings stored trimmed; an empty value falls back to the default where one is required. */
const TRIMMED = new Set(['backendUrl', 'backendDir', 'pythonPath', 'outputFolder', 'attachments']);
const REQUIRED = new Set(['backendUrl', 'attachments']);

/**
 * The settings tab, on Obsidian's declarative settings API (1.13+), so every setting is found by the settings
 * search. The plugin's own settings are `control` rows; the model choice lives in the backend, so its rows are
 * rendered from what the backend reports.
 */
export class P2CSettingTab extends PluginSettingTab {
	private plugin: Paper2ChapterPlugin;
	private remote: AppSettings | null = null;
	private remoteError = '';
	private tried = false;
	private connection = 'Not checked yet.';
	private sel: Selection | null = null;

	constructor(app: App, plugin: Paper2ChapterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getControlValue(key: string): unknown {
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		let v = value;
		if (typeof v === 'string' && TRIMMED.has(key)) v = v.trim();
		if (REQUIRED.has(key) && !v) v = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = v;
		if (key === 'backendUrl') this.plugin.resetClient();
		await this.plugin.saveSettings();
	}

	hide(): void {
		this.tried = false;
		super.hide();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const hasRemote = () => this.remote !== null;
		return [
			{
				type: 'group',
				heading: 'Backend',
				items: [
					{ name: 'Backend address', desc: 'Where the paper2chapter backend listens.', control: { type: 'text', key: 'backendUrl', placeholder: DEFAULT_SETTINGS.backendUrl } },
					{
						name: 'Start the backend automatically',
						desc: 'When it is not running, start it from the backend folder below. It stops again when Obsidian closes.',
						control: { type: 'toggle', key: 'autoStart' },
					},
					{ name: 'Backend folder', desc: 'The backend folder of your paper2chapter checkout: the one that contains app/main.py.', control: { type: 'text', key: 'backendDir' } },
					{ name: 'Python interpreter', desc: "Leave empty to use the backend's own virtual environment.", control: { type: 'text', key: 'pythonPath', placeholder: 'Automatic' } },
					{ name: 'Connection', render: (setting) => this.renderConnection(setting) },
					{ name: 'Backend log', searchable: false, visible: () => this.plugin.backend.log.length > 0, render: (setting) => this.renderLog(setting) },
				],
			},
			{
				type: 'group',
				heading: 'Model',
				items: [
					{ name: 'Providers', visible: () => !hasRemote(), render: (setting) => this.renderLoad(setting) },
					{ name: 'Provider', aliases: ['subscription', 'API key', 'Claude', 'OpenAI'], visible: hasRemote, render: (setting) => this.renderProvider(setting) },
					{ name: 'Model', visible: hasRemote, render: (setting) => this.renderModel(setting) },
					{ name: 'Other model', visible: hasRemote, render: (setting) => this.renderOtherModel(setting) },
					{ name: 'Reasoning effort', visible: hasRemote, render: (setting) => this.renderEffort(setting) },
					{ name: 'Save model', searchable: false, visible: hasRemote, render: (setting) => this.renderActions(setting) },
				],
			},
			{
				type: 'group',
				heading: 'Chapters',
				items: [
					{ name: 'Folder', desc: 'Where chapter notes are created. Figures go into a subfolder.', control: { type: 'folder', key: 'outputFolder', placeholder: DEFAULT_SETTINGS.outputFolder, includeRoot: true } },
					{ name: 'Figures subfolder', control: { type: 'text', key: 'attachments', placeholder: DEFAULT_SETTINGS.attachments } },
					{ name: 'Default audience', control: { type: 'dropdown', key: 'audience', options: AUDIENCES } },
					{ name: 'Python exercises', desc: 'Include coding exercises; their reference solutions are run and checked by the backend.', control: { type: 'toggle', key: 'includePython' } },
					{ name: 'Include solutions', desc: 'Solutions are folded under each exercise.', control: { type: 'toggle', key: 'solutions' } },
					{ name: 'Open the note when it is ready', control: { type: 'toggle', key: 'openAfter' } },
				],
			},
		];
	}

	// ------------------------------------------------------------------ backend rows

	private renderConnection(setting: Setting): void {
		setting.setDesc(this.connection).addButton((b) => b.setButtonText('Connect').setCta().onClick(async () => {
			setting.setDesc('Connecting…');
			try {
				const how = await this.plugin.ensureBackend();
				this.connection = how === 'started' ? 'Started the backend.' : 'The backend is running.';
				await this.loadRemote();
			} catch (e) {
				this.connection = (e as Error).message;
			}
			this.update();
		}));
	}

	private renderLog(setting: Setting): void {
		setting.setDesc('The last lines the backend printed.');
		setting.descEl.createEl('pre', { text: this.plugin.backend.log.slice(-60).join('\n'), cls: 'p2c-log' });
	}

	// ------------------------------------------------------------------ model rows (stored by the backend)

	private async loadRemote(): Promise<void> {
		try {
			this.remote = await this.plugin.client().settings();
			this.sel = { ...this.remote.selection };
			this.remoteError = '';
		} catch (e) {
			this.remote = null;
			this.remoteError = (e as Error).message;
		}
	}

	private provider() {
		return this.remote?.providers.find((p) => p.id === this.sel?.provider);
	}

	private renderLoad(setting: Setting): void {
		if (!this.tried) {
			// one quiet attempt per opening; it fails fast when the backend is not running
			this.tried = true;
			void this.loadRemote().then(() => { if (this.remote) this.update(); });
		}
		setting
			.setDesc(this.remoteError || 'Connect to the backend to choose a provider: a Claude or OpenAI subscription, an API key, or a local model.')
			.addButton((b) => b.setButtonText('Load providers').onClick(async () => {
				await this.loadRemote();
				this.update();
			}));
	}

	private renderProvider(setting: Setting): void {
		const r = this.remote;
		const sel = this.sel;
		if (!r || !sel) return;
		setting.setDesc('Subscriptions need no API key: they use the command-line tool of your plan, signed in on this computer.');
		setting.addDropdown((d) => {
			for (const p of r.providers) d.addOption(p.id, p.label + (p.configured ? '' : ' (not set up)'));
			d.setValue(sel.provider).onChange((v) => {
				sel.provider = v;
				sel.model = this.provider()?.models[0]?.id ?? '';
				this.update();
			});
		});
		const p = this.provider();
		if (p && !p.configured) {
			setting.descEl.createDiv({ cls: 'p2c-warn', text: p.setup_hint || (p.api_key_env ? `Set ${p.api_key_env} in the backend's environment and restart it.` : '') });
		}
		if (p?.free_note) setting.descEl.createDiv({ cls: 'p2c-note', text: p.free_note });
	}

	private renderModel(setting: Setting): void {
		const sel = this.sel;
		const p = this.provider();
		if (!sel) return;
		setting.addDropdown((d) => {
			for (const m of p?.models ?? []) d.addOption(m.id, modelLabel(m));
			if (sel.model && !p?.models.some((m) => m.id === sel.model)) d.addOption(sel.model, sel.model);
			d.setValue(sel.model).onChange((v) => {
				sel.model = v;
				this.update(); // the description shows the chosen model's note
			});
		});
		const note = p?.models.find((m) => m.id === sel.model)?.notes;
		if (note) setting.setDesc(note);
	}

	private renderOtherModel(setting: Setting): void {
		setting
			.setDesc('Optional: any model ID the provider accepts, instead of the list above.')
			.addText((t) => t.setPlaceholder('Model ID').onChange((v) => {
				if (this.sel && v.trim()) this.sel.model = v.trim();
			}));
	}

	private renderEffort(setting: Setting): void {
		const sel = this.sel;
		if (!sel) return;
		setting.addDropdown((d) => {
			d.addOption('low', 'Low: faster, lighter on limits').addOption('medium', 'Medium').addOption('high', 'High: best derivations');
			d.setValue(sel.effort).onChange((v) => { sel.effort = v as Effort; });
		});
	}

	private renderActions(setting: Setting): void {
		const p = this.provider();
		setting.setName('');
		if (p?.kind === 'cli') {
			setting.addButton((b) => b.setButtonText('Check the tool').onClick(async () => {
				try {
					const c = await this.plugin.client().checkProvider(p.id);
					new Notice(`${p.label}: ${c.version ? c.version + ' · ' : ''}${c.message}`, 8000);
				} catch (e) {
					new Notice((e as Error).message, 8000);
				}
			}));
		}
		setting.addButton((b) => b.setButtonText('Save model').setCta().onClick(async () => {
			if (!this.sel) return;
			try {
				this.remote = await this.plugin.client().saveSettings(this.sel);
				this.sel = { ...this.remote.selection };
				new Notice(`New chapters will use ${this.sel.provider} / ${this.sel.model}.`);
				this.update();
			} catch (e) {
				new Notice((e as Error).message, 8000);
			}
		}));
	}
}
