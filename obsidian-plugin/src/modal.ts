import { App, FuzzySuggestModal, Modal, Setting } from 'obsidian';
import { knownText, suggestReview, teachSuggestions, ConceptIndex, type ConceptNote, type ReviewRow } from './concepts.ts';
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
			const env = this.plugin.reviewEnv();
			const rows = env ? await suggestReview(analysis.prerequisites, env) : null;
			const teaches = env && this.plugin.settings.matchConcepts ? teachSuggestions(analysis.title, new ConceptIndex(env.notes())) : [];
			this.form(analysis, rows, teaches, env?.notes() ?? []);
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

	private form(a: PaperAnalysis, rows: ReviewRow[] | null, teaches: ConceptNote[], notes: ConceptNote[]): void {
		const s = this.plugin.settings;
		const opts: GenerationOptions = { audience: s.audience, known_prerequisites: [], focus: '', include_python: s.includePython };
		const el = this.bodyEl;
		el.empty();
		el.createEl('h3', { text: a.title });
		const meta = [a.authors.slice(0, 4).join(', ') + (a.authors.length > 4 ? ' et al.' : ''), a.year, a.field, a.difficulty]
			.filter(Boolean).join(' · ');
		el.createDiv({ cls: 'p2c-muted', text: meta });
		el.createEl('p', { text: a.one_sentence_summary });

		if (rows && rows.length) {
			el.createEl('h4', { text: 'What do you already know?' });
			el.createDiv({ cls: 'p2c-muted', text: s.matchConcepts
				? 'Each prerequisite with the concept note it matches: change the note if it is the wrong one. Ticked: you know it, and why it was ticked is beside it. The chapter opens with a short primer on each of the others (up to six).'
				: 'Ticked: you know it, and why it was ticked is beside it. The chapter opens with a short primer on each of the others (up to six).' });
			for (const r of rows) this.reviewRow(el, r, notes, s.matchConcepts);
		} else if (a.prerequisites.length) {
			el.createEl('h4', { text: 'What do you already know?' });
			el.createDiv({ cls: 'p2c-muted', text: 'Tick what you know. The chapter opens with a short primer on each of the others (up to six).' });
			rows = a.prerequisites.map((p) => ({ id: p.id, name: p.name, level: p.level, why: p.why_needed, candidates: [], note: null, known: false, suggested: null }));
			for (const r of rows) {
				new Setting(el)
					.setName(r.name)
					.setDesc(`${r.level} · ${plainCitations(r.why)}`)
					.addToggle((t) => t.setValue(false).onChange((known) => { r.known = known; }));
			}
		}
		if (s.matchConcepts) this.teachesList(el, teaches, notes);
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
				opts.known_prerequisites = (rows ?? []).filter((r) => r.known).map((r) => r.id);
				this.run.review = rows ? { rows, teaches } : null;
				this.started = true;
				el.empty();
				el.createDiv({ cls: 'p2c-muted', text: 'This takes a few minutes. You can close this window: the note is written when the chapter is ready.' });
				this.plugin.startGeneration(this.run, opts, this);
			}))
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
	}

	/** One prerequisite: its note (the one match, a choice when several fit, or another note), and the tick with its reason. */
	private reviewRow(el: HTMLElement, r: ReviewRow, notes: ConceptNote[], matching: boolean): void {
		const row = new Setting(el).setName(r.name).setDesc(`${r.level} · ${plainCitations(r.why)}`);
		const info = row.descEl.createDiv({ cls: 'p2c-muted' });
		const show = () => {
			const note = matching ? (r.note ? `Note: ${r.note.basename}` : r.candidates.length > 1 ? 'Several notes fit: pick one' : 'No concept note') : '';
			const why = r.known && r.suggested ? knownText(r.suggested) : '';
			info.setText([note, why].filter(Boolean).join(' · '));
		};
		show();
		if (matching) {
			row.addDropdown((d) => {
				const options = new Map<string, ConceptNote>();
				for (const c of r.candidates) options.set(c.path, c);
				if (r.note) options.set(r.note.path, r.note);
				d.addOption('', 'No note');
				for (const [path, c] of options) d.addOption(path, c.basename);
				d.addOption('?', 'Another note…');
				d.setValue(r.note?.path ?? '');
				d.onChange((v) => {
					if (v === '?') {
						new ConceptPicker(this.app, notes, (picked) => {
							options.set(picked.path, picked);
							d.addOption(picked.path, picked.basename);
							d.setValue(picked.path);
							r.note = picked;
							show();
						}).open();
						d.setValue(r.note?.path ?? '');
						return;
					}
					r.note = v ? options.get(v) ?? null : null;
					show();
				});
			});
		}
		row.addToggle((t) => t.setValue(r.known).onChange((known) => {
			r.known = known;
			show();
		}));
	}

	/** The concept notes the chapter teaches: suggested from the paper's title, and any the reader adds. */
	private teachesList(el: HTMLElement, teaches: ConceptNote[], notes: ConceptNote[]): void {
		el.createEl('h4', { text: 'What does it teach?' });
		el.createDiv({ cls: 'p2c-muted', text: 'The concept notes this chapter teaches, for its properties.' });
		const list = el.createDiv({ cls: 'p2c-teaches' });
		const draw = () => {
			list.empty();
			if (!teaches.length) list.createDiv({ cls: 'p2c-muted', text: 'None yet.' });
			for (const n of [...teaches]) {
				new Setting(list).setName(n.basename).addExtraButton((b) => b.setIcon('x').setTooltip('Remove').onClick(() => {
					teaches.splice(teaches.indexOf(n), 1);
					draw();
				}));
			}
		};
		draw();
		new Setting(el).addButton((b) => b.setButtonText('Add a concept note…').onClick(() => {
			new ConceptPicker(this.app, notes, (picked) => {
				if (!teaches.some((x) => x.path === picked.path)) teaches.push(picked);
				draw();
			}).open();
		}));
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

/** Pick a concept note by name. */
class ConceptPicker extends FuzzySuggestModal<ConceptNote> {
	private notes: ConceptNote[];
	private pick: (n: ConceptNote) => void;
	constructor(app: App, notes: ConceptNote[], pick: (n: ConceptNote) => void) {
		super(app);
		this.notes = notes;
		this.pick = pick;
		this.setPlaceholder('Pick a concept note');
	}
	getItems(): ConceptNote[] { return this.notes; }
	getItemText(n: ConceptNote): string { return n.path === `${n.basename}.md` ? n.basename : `${n.basename} · ${n.path}`; }
	onChooseItem(n: ConceptNote): void { this.pick(n); }
}
