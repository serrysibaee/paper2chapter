import { App, Modal, Setting } from 'obsidian';
import type Paper2ChapterPlugin from './main.ts';
import type { ChapterRun, RunStatus } from './run.ts';
import { AUDIENCES } from './settings.ts';
import { costLine, plainCitations } from './text.ts';
import type { Audience, GenerationOptions, PaperAnalysis } from './types.ts';

const PHASE: Record<RunStatus['phase'], string> = {
	upload: 'Uploading',
	extract: 'Extracting text, figures and references',
	analyze: 'Analyzing the paper',
	prepared: 'Ready',
	generate: 'Writing the chapter',
	write: 'Saving the note',
	done: 'Done',
};

/** Upload → extract → analyze, then the reader's choices, then generation, which outlives the modal. */
export class GenerateModal extends Modal {
	private statusEl!: HTMLElement;
	private barEl!: HTMLProgressElement;
	private bodyEl!: HTMLElement;
	private started = false;
	private plugin: Paper2ChapterPlugin;
	private run: ChapterRun;
	private pdfName: string;
	private modelText: string;

	constructor(app: App, plugin: Paper2ChapterPlugin, run: ChapterRun, pdfName: string, modelText: string) {
		super(app);
		this.plugin = plugin;
		this.run = run;
		this.pdfName = pdfName;
		this.modelText = modelText;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('p2c-modal');
		this.setTitle(`Chapter from ${this.pdfName}`);
		contentEl.createDiv({ cls: 'p2c-muted', text: this.modelText });
		this.statusEl = contentEl.createDiv({ cls: 'p2c-status' });
		this.barEl = contentEl.createEl('progress', { cls: 'p2c-bar' });
		this.barEl.max = 1;
		this.bodyEl = contentEl.createDiv();
		void this.prepare();
	}

	onClose(): void {
		if (!this.started) this.run.cancel(); // the backend keeps its extraction; nothing is lost
		this.contentEl.empty();
	}

	status(s: RunStatus): void {
		if (!this.statusEl) return;
		this.statusEl.setText(`${PHASE[s.phase]}${s.message && s.message !== s.phase ? ': ' + s.message : ''}`);
		this.barEl.value = s.phase === 'prepared' || s.phase === 'done' ? 1 : s.progress;
	}

	private async prepare(): Promise<void> {
		try {
			await this.plugin.ensureBackend();
			const analysis = await this.run.prepare((s) => this.status(s));
			this.form(analysis);
		} catch (e) {
			this.fail((e as Error).message, () => void this.prepare());
		}
	}

	private fail(message: string, retry: () => void): void {
		this.statusEl.setText('');
		this.barEl.hide();
		this.bodyEl.empty();
		this.bodyEl.createDiv({ cls: 'p2c-error', text: message });
		new Setting(this.bodyEl)
			.addButton((b) => b.setButtonText('Retry').setCta().onClick(() => {
				this.barEl.show();
				this.bodyEl.empty();
				retry();
			}))
			.addButton((b) => b.setButtonText('Close').onClick(() => this.close()));
	}

	private form(a: PaperAnalysis): void {
		const s = this.plugin.settings;
		const opts: GenerationOptions = { audience: s.audience, known_prerequisites: [], focus: '', include_python: s.includePython };
		const el = this.bodyEl;
		el.empty();
		el.createEl('h3', { text: a.title });
		const meta = [a.authors.slice(0, 4).join(', ') + (a.authors.length > 4 ? ' et al.' : ''), a.year, a.field, a.difficulty]
			.filter(Boolean).join(' · ');
		el.createDiv({ cls: 'p2c-muted', text: meta });
		el.createEl('p', { text: a.one_sentence_summary });

		if (a.prerequisites.length) {
			el.createEl('h4', { text: 'What do you already know?' });
			el.createDiv({ cls: 'p2c-muted', text: 'Tick what you know. The chapter opens with a short primer on each of the others (up to six).' });
			for (const p of a.prerequisites) {
				new Setting(el)
					.setName(p.name)
					.setDesc(`${p.level} · ${plainCitations(p.why_needed)}`)
					.addToggle((t) => t.setValue(false).onChange((known) => {
						opts.known_prerequisites = known
							? [...opts.known_prerequisites, p.id]
							: opts.known_prerequisites.filter((x) => x !== p.id);
					}));
			}
		}
		el.createEl('h4', { text: 'Chapter' });
		new Setting(el).setName('Audience').addDropdown((d) => {
			for (const [k, label] of Object.entries(AUDIENCES)) d.addOption(k, label);
			d.setValue(opts.audience).onChange((v) => { opts.audience = v as Audience; });
		});
		new Setting(el).setName('Python exercises').addToggle((t) => t.setValue(opts.include_python).onChange((v) => { opts.include_python = v; }));
		new Setting(el).setName('Focus').setDesc('Optional: what the chapter should emphasise.')
			.addTextArea((t) => t.setPlaceholder('For example, the derivation in section 3').onChange((v) => { opts.focus = v; }));
		const cost = costLine(this.run.estimate);
		if (cost) el.createDiv({ cls: 'p2c-muted', text: cost });
		new Setting(el)
			.addButton((b) => b.setButtonText('Generate chapter').setCta().onClick(() => {
				this.started = true;
				el.empty();
				el.createDiv({ cls: 'p2c-muted', text: 'This takes a few minutes. You can close this window: the note is written when the chapter is ready.' });
				this.plugin.startGeneration(this.run, opts, this);
			}))
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
	}

	showDone(notePath: string): void {
		if (!this.bodyEl) return;
		this.bodyEl.empty();
		this.bodyEl.createDiv({ text: `Saved as ${notePath}.` });
		new Setting(this.bodyEl).addButton((b) => b.setButtonText('Open the note').setCta().onClick(() => {
			void this.plugin.openNote(notePath);
			this.close();
		}));
	}

	showError(message: string): void {
		if (this.bodyEl) this.fail(message, () => this.close());
	}
}
