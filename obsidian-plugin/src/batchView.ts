import { App, Modal, Setting } from 'obsidian';
import type { Batch } from './batch.ts';
import type { QueueItem } from './config.ts';

const MARK: Record<QueueItem['status'], string> = { waiting: '⏳', running: '▶', done: '✅', skipped: '⏭', failed: '❌' };

/** The batch: each paper with its state, and the buttons that start, pause, retry and clear it. */
export class BatchModal extends Modal {
	private batch: Batch;
	private queue: () => QueueItem[];
	private paused: () => boolean;
	private showNote: (path: string) => void;

	constructor(app: App, batch: Batch, queue: () => QueueItem[], paused: () => boolean, showNote: (path: string) => void) {
		super(app);
		this.batch = batch;
		this.queue = queue;
		this.paused = paused;
		this.showNote = showNote;
	}

	onOpen(): void {
		this.setTitle('Chapter batch');
		this.refresh();
	}

	refresh(): void {
		const el = this.contentEl;
		el.empty();
		const q = this.queue();
		const waiting = q.filter((x) => x.status === 'waiting').length;
		el.createDiv({ cls: 'p2c-muted', text: this.batch.running
			? (this.paused() ? 'Pausing: the paper in hand finishes first.' : 'Working: one paper at a time. You can close this window.')
			: waiting ? `${waiting} waiting${this.paused() ? ', paused' : ''}.` : 'Nothing waiting. Add papers from a PDF\'s menu or with the batch commands.' });
		const actions = new Setting(el);
		if (this.batch.running && !this.paused()) actions.addButton((b) => b.setButtonText('Pause').onClick(() => this.batch.pause()));
		else if (waiting) actions.addButton((b) => b.setButtonText(this.paused() ? 'Resume' : 'Start').setCta().onClick(() => void this.batch.resume()));
		if (q.some((x) => x.status === 'failed')) actions.addButton((b) => b.setButtonText('Retry the failed').onClick(() => this.batch.retryFailed()));
		if (q.some((x) => x.status === 'done' || x.status === 'skipped')) actions.addButton((b) => b.setButtonText('Clear the finished').onClick(() => this.batch.clearFinished()));
		for (const item of q) {
			const row = new Setting(el).setName(`${MARK[item.status]} ${item.name}`).setDesc(item.message ?? '');
			if (item.note && (item.status === 'done' || item.status === 'skipped')) {
				row.addExtraButton((b) => b.setIcon('file-text').setTooltip('Open the note').onClick(() => this.showNote(item.note!)));
			}
			if (item.status !== 'running') row.addExtraButton((b) => b.setIcon('x').setTooltip('Remove').onClick(() => this.batch.remove(item.key)));
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
