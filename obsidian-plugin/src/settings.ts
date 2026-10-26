import { App, Modal, Notice, PluginSettingTab, Setting, type SettingDefinitionItem, TFile } from 'obsidian';
import {
	CHAPTER_ROWS, DEFAULT_SETTINGS, exportProfile, importProfile, lines, type P2CSettings, type PropertyRow, type PropertyType,
} from './config.ts';
import type Paper2ChapterPlugin from './main.ts';
import { FRAGMENT_HELP } from './template.ts';
import { TOKEN_HELP } from './tokens.ts';
import type { AppSettings, Audience, Effort, Selection } from './types.ts';
import {
	checkFolders, checkFolderTemplate, checkNameTemplate, checkPageLinkTemplate, checkQuietHours, checkRows,
	checkSectionHeading, checkTemplateText, checkUrl,
} from './validate.ts';

export { DEFAULT_SETTINGS } from './config.ts';
export type { P2CSettings } from './config.ts';

const PROPERTY_TYPES: Record<PropertyType, string> = {
	text: 'Text', list: 'List', link: 'Link', number: 'Number', date: 'Date', checkbox: 'Checkbox',
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
const TRIMMED = new Set(['backendUrl', 'backendDir', 'pythonPath', 'outputFolder', 'attachments', 'noteName', 'figuresFolder',
	'quietHours', 'templatePath', 'pageLinkTemplate', 'zoteroUrl', 'sectionHeading']);
const REQUIRED = new Set(['backendUrl', 'attachments', 'noteName', 'zoteroUrl', 'sectionHeading']);
const NUMBERS = new Set(['headingLevel']);

/** A short explanation of every token, for the settings. */
function helpList(el: HTMLElement, title: string, help: Record<string, string>): void {
	const d = el.createEl('details', { cls: 'p2c-help' });
	d.createEl('summary', { text: title });
	const ul = d.createEl('ul');
	for (const [k, v] of Object.entries(help)) {
		const li = ul.createEl('li');
		li.createEl('code', { text: `{{${k}}}` });
		li.appendText(`: ${v}`);
	}
}

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
		const v = (this.plugin.settings as unknown as Record<string, unknown>)[key];
		return NUMBERS.has(key) ? String(v) : v;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		let v = value;
		if (typeof v === 'string' && TRIMMED.has(key)) v = v.trim();
		if (REQUIRED.has(key) && !v) v = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
		if (NUMBERS.has(key)) v = Number(v);
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = v;
		if (key === 'backendUrl') this.plugin.resetClient();
		await this.plugin.saveSettings();
		// rows that show or hide with this choice
		if (['zotero', 'figures', 'layout', 'pageLinks', 'propertiesMode', 'paperNoteKeys'].includes(key)) this.update();
	}

	private get s(): P2CSettings {
		return this.plugin.settings;
	}

	private async checkTemplatePath(path: string): Promise<string> {
		if (this.s.layout !== 'template' && !path.trim()) return '';
		if (!path.trim()) return 'Pick the note to use as the template.';
		const f = this.app.vault?.getAbstractFileByPath?.(path.trim());
		if (!(f instanceof TFile) || f.extension !== 'md') return 'There is no such note in this vault.';
		return checkTemplateText(await this.app.vault.cachedRead(f));
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
				heading: 'Sources',
				items: [
					{ name: 'PDFs in the vault', desc: "Offer the vault's PDFs in the paper picker. Right-clicking a PDF always works.", control: { type: 'toggle', key: 'vaultPdfs' } },
					{
						name: 'Folders outside the vault',
						desc: 'Folders on this computer whose PDFs the picker offers, one per line. A PDF is read, never copied into the vault.',
						aliases: ['literature', 'library', 'external'],
						control: { type: 'textarea', key: 'pdfFolders', rows: 3, placeholder: 'C:\\Papers', validate: (v) => checkFolders(v) },
					},
					{
						name: 'Zotero',
						desc: "Pick papers from Zotero, which must be running with its local API on (Zotero: Settings → Advanced → Allow other applications on this computer to communicate with Zotero). Nothing in Zotero is changed.",
						control: { type: 'toggle', key: 'zotero' },
					},
					{ name: 'Zotero address', visible: () => this.s.zotero, control: { type: 'text', key: 'zoteroUrl', placeholder: DEFAULT_SETTINGS.zoteroUrl, validate: (v) => checkUrl(v) } },
					{ name: 'Check Zotero', searchable: false, visible: () => this.s.zotero, render: (setting) => this.renderZoteroCheck(setting) },
					{
						name: "Find the paper's own note",
						desc: 'The properties of the note your vault keeps for a paper, one per line, tried in order: for example source, doi, arxiv, zotero, title; file.name is the note\'s own name. A match must name exactly one note. Empty: off.',
						aliases: ['literature note', 'reference note', 'paper note'],
						control: { type: 'textarea', key: 'paperNoteKeys', rows: 4, placeholder: 'doi\narxiv\ntitle' },
					},
					{
						name: 'Look for it in these folders',
						desc: 'One per line. Empty: the whole vault.',
						visible: () => lines(this.s.paperNoteKeys).length > 0,
						control: { type: 'textarea', key: 'paperNoteFolders', rows: 2 },
					},
				],
			},
			{
				type: 'group',
				heading: 'Chapters',
				items: [
					{
						name: 'Folder',
						desc: 'Where chapter notes are created. Tokens such as {{year}} or {{paperNoteFolder}} can be part of it.',
						control: { type: 'folder', key: 'outputFolder', placeholder: DEFAULT_SETTINGS.outputFolder, includeRoot: true, validate: (v) => checkFolderTemplate(v) },
					},
					{ name: 'Note name', desc: 'A template: {{paperTitle}}, or {{firstAuthor}} {{year}} - {{paperTitle}}, for example.', control: { type: 'text', key: 'noteName', placeholder: DEFAULT_SETTINGS.noteName, validate: (v) => checkNameTemplate(v) } },
					{ name: 'Tokens', searchable: false, render: (setting) => { setting.setName(''); helpList(setting.descEl, 'Tokens you can use', TOKEN_HELP); } },
					{
						name: 'Figures',
						control: { type: 'dropdown', key: 'figures', options: { subfolder: 'In a subfolder beside the note', obsidian: "Where Obsidian puts attachments", folder: 'In a fixed folder' } },
					},
					{ name: 'Figures subfolder', visible: () => this.s.figures === 'subfolder', control: { type: 'text', key: 'attachments', placeholder: DEFAULT_SETTINGS.attachments } },
					{ name: 'Figures folder', visible: () => this.s.figures === 'folder', control: { type: 'folder', key: 'figuresFolder', validate: (v) => (this.s.figures === 'folder' && !v.trim() ? 'Pick a folder.' : '') } },
					{ name: 'When the name is taken', control: { type: 'dropdown', key: 'onExists', options: { number: 'Write a second note, numbered', skip: 'Write nothing' } } },
					{
						name: 'Quiet hours',
						desc: 'No note is written between these times (for example 23:00-06:00, while other tools work in the vault); a chapter that finishes then waits. Empty: none.',
						control: { type: 'text', key: 'quietHours', placeholder: '23:00-06:00', validate: (v) => checkQuietHours(v) },
					},
					{ name: 'Default audience', control: { type: 'dropdown', key: 'audience', options: AUDIENCES } },
					{ name: 'Python exercises', desc: 'Include coding exercises; their reference solutions are run and checked by the backend.', control: { type: 'toggle', key: 'includePython' } },
					{ name: 'Include solutions', desc: 'Solutions are folded under each exercise.', control: { type: 'toggle', key: 'solutions' } },
					{ name: 'Open the note when it is ready', control: { type: 'toggle', key: 'openAfter' } },
				],
			},
			{
				type: 'group',
				heading: 'Note format',
				items: [
					{
						name: 'Layout',
						desc: "paper2chapter's note as the backend writes it; a textbook layout; or your own template note.",
						control: { type: 'dropdown', key: 'layout', options: { paper2chapter: 'paper2chapter', textbook: 'Textbook', template: 'My template note' } },
					},
					{
						name: 'Template note',
						desc: 'A note with placeholders for the pieces of the chapter, and tokens. Its own frontmatter is not used: set properties below.',
						visible: () => this.s.layout === 'template',
						control: { type: 'file', key: 'templatePath', filter: (f) => f.extension === 'md', validate: (v) => this.checkTemplatePath(v) },
					},
					{ name: 'Pieces', searchable: false, visible: () => this.s.layout === 'template', render: (setting) => { setting.setName(''); helpList(setting.descEl, 'Pieces a template can place', FRAGMENT_HELP); } },
					{
						name: 'Section heading',
						desc: 'A template: {{n}} the number, {{title}}, {{page}} the first page it cites, {{pages}}; {{#page}} … {{/page}} only when there is one.',
						visible: () => this.s.layout !== 'paper2chapter',
						control: { type: 'text', key: 'sectionHeading', placeholder: DEFAULT_SETTINGS.sectionHeading, validate: (v) => checkSectionHeading(v) },
					},
					{ name: 'Section heading level', visible: () => this.s.layout !== 'paper2chapter', control: { type: 'dropdown', key: 'headingLevel', options: { 1: '#', 2: '##', 3: '###', 4: '####' } } },
					{ name: 'Worked examples', visible: () => this.s.layout !== 'paper2chapter', control: { type: 'dropdown', key: 'examples', options: { inline: 'In their sections', gathered: 'Gathered in one place ({{workedExamples}})' } } },
					{
						name: 'Page links',
						desc: 'Where (p. 4) leads: automatically to the PDF in the vault, its Zotero item, or the file on this computer; or a URL template; or nowhere.',
						control: { type: 'dropdown', key: 'pageLinks', options: { auto: 'Automatic', custom: 'A URL template', plain: 'Plain page numbers' } },
					},
					{
						name: 'Page link template',
						desc: 'A URL with {page}, and tokens: zotero://open-pdf/library/items/{{zoteroPdfKey}}?page={page}, for example. Tokens are percent-encoded.',
						visible: () => this.s.pageLinks === 'custom',
						control: { type: 'text', key: 'pageLinkTemplate', validate: (v) => (!v.trim() && this.s.pageLinks !== 'custom' ? '' : checkPageLinkTemplate(v)) },
					},
				],
			},
			{
				type: 'group',
				heading: 'Properties',
				items: [
					{
						name: 'Properties',
						desc: "paper2chapter's own (title, paper, authors, source PDF, model, …), or your own rows below.",
						control: { type: 'dropdown', key: 'propertiesMode', options: { chapter: "paper2chapter's", custom: 'My own' } },
					},
					{ name: 'Check the rows', searchable: false, visible: () => this.s.propertiesMode === 'custom', render: (setting) => this.renderRowsCheck(setting) },
				],
			},
			{
				type: 'list',
				heading: 'Property rows',
				visible: () => this.s.propertiesMode === 'custom',
				emptyState: 'No property: the note has no frontmatter.',
				items: this.s.propertyRows.map((row, i) => ({
					name: row.key || `Property ${i + 1}`,
					searchable: false,
					render: (setting: Setting) => this.renderRow(setting, row),
				})),
				onDelete: (i) => { this.s.propertyRows.splice(i, 1); void this.plugin.saveSettings().then(() => this.update()); },
				onReorder: (from, to) => {
					const [r] = this.s.propertyRows.splice(from, 1);
					if (r) this.s.propertyRows.splice(to, 0, r);
					void this.plugin.saveSettings().then(() => this.update());
				},
				addItem: { name: 'Add a property', action: () => { this.s.propertyRows.push({ key: '', value: '', type: 'text' }); void this.plugin.saveSettings().then(() => this.update()); } },
			},
			{
				type: 'group',
				heading: 'Settings profile',
				items: [
					{ name: 'Preview', desc: 'See the note these settings write, from a sample chapter: no model is asked and nothing is written.', render: (setting) => this.renderPreview(setting) },
					{ name: 'Export settings', desc: "Copy these settings as JSON, without this computer's paths, to keep them or use them in another vault.", render: (setting) => this.renderExport(setting) },
					{ name: 'Import settings', desc: "Paste settings exported before. This computer's paths are kept.", render: (setting) => this.renderImport(setting) },
					{ name: 'Reset the note settings', desc: 'Sources, chapters, format and properties back to their defaults. The backend and the model stay.', render: (setting) => this.renderReset(setting) },
				],
			},
		];
	}

	// ------------------------------------------------------------------ sources, properties, profile rows

	private renderZoteroCheck(setting: Setting): void {
		setting.setName('').addButton((b) => b.setButtonText('Check Zotero').onClick(async () => {
			try {
				new Notice(await this.plugin.zotero().check(), 6000);
			} catch (e) {
				new Notice((e as Error).message, 10000);
			}
		}));
	}

	private renderRowsCheck(setting: Setting): void {
		const problem = checkRows(this.s.propertyRows);
		setting.setName('').setDesc(problem || 'Every row is fine.');
		if (problem) setting.descEl.addClass('p2c-warn');
		setting.addButton((b) => b.setButtonText("Start from paper2chapter's rows").onClick(async () => {
			this.s.propertyRows = CHAPTER_ROWS.map((r) => ({ ...r }));
			await this.plugin.saveSettings();
			this.update();
		}));
	}

	private renderRow(setting: Setting, row: PropertyRow): void {
		setting.setName('');
		setting.addText((t) => t.setPlaceholder('Property').setValue(row.key).onChange(async (v) => {
			row.key = v.trim();
			await this.plugin.saveSettings();
		}));
		setting.addDropdown((d) => {
			for (const [k, label] of Object.entries(PROPERTY_TYPES)) d.addOption(k, label);
			d.setValue(row.type).onChange(async (v) => {
				row.type = v as PropertyType;
				await this.plugin.saveSettings();
			});
		});
		setting.addText((t) => t.setPlaceholder('Value, e.g. {{paperNote}}').setValue(row.value).onChange(async (v) => {
			row.value = v;
			await this.plugin.saveSettings();
		}));
	}

	private renderPreview(setting: Setting): void {
		setting.addButton((b) => b.setButtonText('Preview').setCta().onClick(() => this.plugin.openPreview()));
	}

	private renderExport(setting: Setting): void {
		setting.addButton((b) => b.setButtonText('Copy').onClick(async () => {
			try {
				await navigator.clipboard.writeText(exportProfile(this.s));
				new Notice('Settings copied.');
			} catch (e) {
				new Notice((e as Error).message, 8000);
			}
		}));
	}

	private renderImport(setting: Setting): void {
		setting.addButton((b) => b.setButtonText('Paste…').onClick(() => {
			new ImportModal(this.app, async (text) => {
				this.plugin.settings = importProfile(text, this.s);
				this.plugin.resetClient();
				await this.plugin.saveSettings();
				this.update();
				new Notice('Settings imported.');
			}).open();
		}));
	}

	private renderReset(setting: Setting): void {
		let armed = false;
		setting.addButton((b) => b.setButtonText('Reset').setDestructive().onClick(async () => {
			if (!armed) {
				armed = true;
				b.setButtonText('Click again to reset');
				return;
			}
			const keep = ['backendUrl', 'backendDir', 'pythonPath', 'autoStart', 'papers'] as const;
			const next: P2CSettings = { ...DEFAULT_SETTINGS, propertyRows: CHAPTER_ROWS.map((r) => ({ ...r })) };
			for (const k of keep) (next as unknown as Record<string, unknown>)[k] = this.s[k];
			this.plugin.settings = next;
			await this.plugin.saveSettings();
			this.update();
			new Notice('Note settings reset.');
		}));
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

/** Paste a settings profile; it is checked before anything changes. */
class ImportModal extends Modal {
	private apply: (text: string) => Promise<void>;
	constructor(app: App, apply: (text: string) => Promise<void>) {
		super(app);
		this.apply = apply;
	}

	onOpen(): void {
		this.setTitle('Import settings');
		let text = '';
		const area = this.contentEl.createEl('textarea', { cls: 'p2c-import', attr: { rows: '12', placeholder: 'Paste the settings here' } });
		area.addEventListener('input', () => { text = area.value; });
		const error = this.contentEl.createDiv({ cls: 'p2c-error' });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Import').setCta().onClick(async () => {
				try {
					await this.apply(text);
					this.close();
				} catch (e) {
					error.setText((e as Error).message);
				}
			}))
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
