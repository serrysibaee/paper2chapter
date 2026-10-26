/* The preview window: the note the current settings write for the sample chapter, rendered or as Markdown. */
import { App, Component, MarkdownRenderer, Modal, Setting } from 'obsidian';
import type { P2CSettings } from './config.ts';
import type { NoteEnv } from './run.ts';
import { previewNote, type Preview } from './sampleBackend.ts';

export class PreviewModal extends Modal {
	private settings: P2CSettings;
	private env: NoteEnv;
	private exists: (path: string) => boolean;
	private component = new Component();

	constructor(app: App, settings: P2CSettings, env: NoteEnv, exists: (path: string) => boolean) {
		super(app);
		this.settings = settings;
		this.env = env;
		this.exists = exists;
	}

	onOpen(): void {
		this.setTitle('Preview of a chapter note');
		this.modalEl.addClass('p2c-preview-modal');
		this.component.load();
		void this.show();
	}

	private async show(): Promise<void> {
		const el = this.contentEl;
		el.empty();
		let p: Preview;
		try {
			p = await previewNote(this.settings, this.env, this.exists);
		} catch (e) {
			el.createDiv({ cls: 'p2c-error', text: (e as Error).message });
			return;
		}
		el.createDiv({ cls: 'p2c-muted', text: 'A sample chapter, written with your settings. Figures are not shown, and page numbers are not linked in the sample.' });
		el.createDiv({ text: p.skipped ? `A note named ${p.notePath} is there already: with these settings nothing would be written.` : `It would be saved as ${p.notePath}.` });
		if (p.figures.length) el.createDiv({ cls: 'p2c-muted', text: `Figures: ${p.figures.join(', ')}` });
		let raw = false;
		const toggle = new Setting(el).setName('Show the Markdown');
		const body = el.createDiv({ cls: 'p2c-preview' });
		const draw = async () => {
			body.empty();
			if (raw) body.createEl('pre', { cls: 'p2c-preview-raw', text: p.markdown });
			else await MarkdownRenderer.render(this.app, p.markdown, body, p.notePath, this.component);
		};
		toggle.addToggle((t) => t.setValue(false).onChange(async (v) => {
			raw = v;
			await draw();
		}));
		await draw();
	}

	onClose(): void {
		this.component.unload();
		this.contentEl.empty();
	}
}
