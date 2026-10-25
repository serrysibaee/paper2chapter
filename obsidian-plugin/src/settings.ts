import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type Paper2ChapterPlugin from './main.ts';
import type { PaperCacheEntry } from './run.ts';
import type { AppSettings, Audience, Effort } from './types.ts';

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

export function modelLabel(m: AppSettings['providers'][number]['models'][number]): string {
	const cost = m.tier === 'subscription' ? '' : m.typical_chapter_cost_usd === null ? '' : m.typical_chapter_cost_usd === 0
		? ' · free' : ` · ~$${m.typical_chapter_cost_usd.toFixed(2)}/chapter`;
	return `${m.label} (${TIER[m.tier] ?? m.tier}${cost})`;
}

export class P2CSettingTab extends PluginSettingTab {
	private plugin: Paper2ChapterPlugin;
	private remote: AppSettings | null = null;
	private remoteError = '';

	constructor(app: App, plugin: Paper2ChapterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private tried = false;

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		if (!this.remote && !this.tried) {
			// one quiet attempt per opening; it fails fast when the backend is not running
			this.tried = true;
			void this.loadRemote().then(() => { if (this.remote) this.display(); });
		}
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();

		new Setting(containerEl).setName('Backend').setHeading();
		new Setting(containerEl)
			.setName('Backend address')
			.setDesc('Where the paper2chapter backend listens.')
			.addText((t) => t.setPlaceholder(DEFAULT_SETTINGS.backendUrl).setValue(s.backendUrl).onChange(async (v) => {
				s.backendUrl = v.trim() || DEFAULT_SETTINGS.backendUrl;
				this.plugin.resetClient();
				await save();
			}));
		new Setting(containerEl)
			.setName('Start the backend automatically')
			.setDesc('When it is not running, start it from the backend folder below. It stops again when Obsidian closes.')
			.addToggle((t) => t.setValue(s.autoStart).onChange(async (v) => {
				s.autoStart = v;
				await save();
			}));
		new Setting(containerEl)
			.setName('Backend folder')
			.setDesc('The backend/ folder of your paper2chapter checkout, for example C:\\code\\paper2chapter\\backend.')
			.addText((t) => t.setValue(s.backendDir).onChange(async (v) => {
				s.backendDir = v.trim();
				await save();
			}));
		new Setting(containerEl)
			.setName('Python')
			.setDesc('Leave empty to use the backend\'s .venv, or Python on your PATH.')
			.addText((t) => t.setPlaceholder('auto').setValue(s.pythonPath).onChange(async (v) => {
				s.pythonPath = v.trim();
				await save();
			}));
		const status = new Setting(containerEl).setName('Connection').setDesc('Not checked yet.');
		status.addButton((b) => b.setButtonText('Connect').setCta().onClick(async () => {
			status.setDesc('Connecting…');
			try {
				const how = await this.plugin.ensureBackend();
				status.setDesc(how === 'started' ? 'Started the backend.' : 'The backend is running.');
				await this.loadRemote();
				this.display();
			} catch (e) {
				status.setDesc((e as Error).message);
			}
		}));
		if (this.plugin.backend.log.length) {
			const details = containerEl.createEl('details');
			details.createEl('summary', { text: 'Backend log' });
			details.createEl('pre', { text: this.plugin.backend.log.slice(-60).join('\n'), cls: 'p2c-log' });
		}

		this.modelSection(containerEl);

		new Setting(containerEl).setName('Chapters').setHeading();
		new Setting(containerEl)
			.setName('Folder')
			.setDesc('Where chapter notes are created. Figures go into a subfolder.')
			.addText((t) => t.setPlaceholder(DEFAULT_SETTINGS.outputFolder).setValue(s.outputFolder).onChange(async (v) => {
				s.outputFolder = v.trim();
				await save();
			}));
		new Setting(containerEl)
			.setName('Figures subfolder')
			.addText((t) => t.setPlaceholder(DEFAULT_SETTINGS.attachments).setValue(s.attachments).onChange(async (v) => {
				s.attachments = v.trim() || DEFAULT_SETTINGS.attachments;
				await save();
			}));
		new Setting(containerEl)
			.setName('Default audience')
			.addDropdown((d) => {
				for (const [k, label] of Object.entries(AUDIENCES)) d.addOption(k, label);
				d.setValue(s.audience).onChange(async (v) => {
					s.audience = v as Audience;
					await save();
				});
			});
		new Setting(containerEl)
			.setName('Python exercises')
			.setDesc('Include coding exercises; their reference solutions are run and checked by the backend.')
			.addToggle((t) => t.setValue(s.includePython).onChange(async (v) => {
				s.includePython = v;
				await save();
			}));
		new Setting(containerEl)
			.setName('Include solutions')
			.setDesc('Solutions are folded under each exercise.')
			.addToggle((t) => t.setValue(s.solutions).onChange(async (v) => {
				s.solutions = v;
				await save();
			}));
		new Setting(containerEl)
			.setName('Open the note when it is ready')
			.addToggle((t) => t.setValue(s.openAfter).onChange(async (v) => {
				s.openAfter = v;
				await save();
			}));
	}

	hide(): void {
		this.tried = false;
	}

	private async loadRemote(): Promise<void> {
		try {
			this.remote = await this.plugin.client().settings();
			this.remoteError = '';
		} catch (e) {
			this.remote = null;
			this.remoteError = (e as Error).message;
		}
	}

	private modelSection(el: HTMLElement): void {
		new Setting(el).setName('Model').setHeading();
		if (!this.remote) {
			new Setting(el)
				.setDesc(this.remoteError || 'Connect to the backend to choose a provider: a Claude or ChatGPT subscription, an API key, or a local model.')
				.addButton((b) => b.setButtonText('Load providers').onClick(async () => {
					await this.loadRemote();
					this.display();
				}));
			return;
		}
		const r = this.remote;
		const sel = { ...r.selection };
		const provider = () => r.providers.find((p) => p.id === sel.provider);

		new Setting(el)
			.setName('Provider')
			.setDesc('Subscriptions use the Claude Code or Codex CLI on this computer, signed in with your plan: no API key needed.')
			.addDropdown((d) => {
				for (const p of r.providers) d.addOption(p.id, p.label + (p.configured ? '' : ' (not set up)'));
				d.setValue(sel.provider).onChange((v) => {
					sel.provider = v;
					sel.model = provider()?.models[0]?.id ?? '';
					this.remote = { ...r, selection: sel };
					this.display();
				});
			});
		const p = provider();
		if (p && !p.configured) {
			el.createDiv({ cls: 'p2c-warn', text: p.setup_hint || (p.api_key_env ? `Set ${p.api_key_env} in the backend's environment and restart it.` : '') });
		}
		if (p?.free_note) el.createDiv({ cls: 'setting-item-description p2c-note', text: p.free_note });
		new Setting(el)
			.setName('Model')
			.addDropdown((d) => {
				for (const m of p?.models ?? []) d.addOption(m.id, modelLabel(m));
				if (sel.model && !p?.models.some((m) => m.id === sel.model)) d.addOption(sel.model, sel.model);
				d.setValue(sel.model).onChange((v) => {
					sel.model = v;
				});
			})
			.addText((t) => t.setPlaceholder('or type a model id').onChange((v) => {
				if (v.trim()) sel.model = v.trim();
			}));
		new Setting(el)
			.setName('Reasoning effort')
			.addDropdown((d) => {
				d.addOption('low', 'Low: faster, lighter on limits').addOption('medium', 'Medium').addOption('high', 'High: best derivations');
				d.setValue(sel.effort).onChange((v) => {
					sel.effort = v as Effort;
				});
			});
		const actions = new Setting(el);
		if (p?.kind === 'cli') {
			actions.addButton((b) => b.setButtonText('Check the CLI').onClick(async () => {
				try {
					const c = await this.plugin.client().checkProvider(p.id);
					new Notice(`${p.label}: ${c.version ? c.version + ' · ' : ''}${c.message}`, 8000);
				} catch (e) {
					new Notice((e as Error).message, 8000);
				}
			}));
		}
		actions.addButton((b) => b.setButtonText('Save model').setCta().onClick(async () => {
			try {
				this.remote = await this.plugin.client().saveSettings(sel);
				new Notice(`New chapters will use ${sel.provider} / ${sel.model}.`);
				this.display();
			} catch (e) {
				new Notice((e as Error).message, 8000);
			}
		}));
	}
}
