/*
 * The batch: papers queued from a folder, a Zotero collection or the picker, turned into chapters one at a time.
 * The queue lives in the plugin's settings and is saved as each paper starts and ends, so a restart loses nothing (a
 * paper that was running waits again, config.ts). Pausing lets the paper in hand finish. A paper whose chapter note
 * is already there is skipped, and one the backend has already written is imported rather than generated again;
 * that is the processing step's business (`process`), which main.ts supplies.
 */
import type { QueueItem } from './config.ts';

export type NewItem = Omit<QueueItem, 'status' | 'added' | 'message' | 'note'>;

export interface BatchDeps {
	queue(): QueueItem[]; // the live list, kept in the settings
	paused(): boolean;
	setPaused(p: boolean): void;
	save(): Promise<void>;
	process(item: QueueItem, report: (message: string) => void): Promise<{ status: 'done' | 'skipped'; note: string; message: string }>;
	onChange?(): void;
}

export class Batch {
	running = false;
	private deps: BatchDeps;
	private loop: Promise<void> | null = null;

	constructor(deps: BatchDeps) {
		this.deps = deps;
	}

	/** Papers not already waiting or running join the end of the queue. */
	add(items: NewItem[], today: string): { added: number; already: number } {
		const q = this.deps.queue();
		let added = 0;
		let already = 0;
		for (const it of items) {
			if (q.some((x) => x.key === it.key && (x.status === 'waiting' || x.status === 'running'))) {
				already++;
				continue;
			}
			q.push({ ...it, status: 'waiting', added: today });
			added++;
		}
		this.deps.onChange?.();
		return { added, already };
	}

	/** Work through the waiting papers until none is left or the batch is paused. Starting it twice runs one loop. */
	start(): Promise<void> {
		this.loop ??= this.work().finally(() => { this.loop = null; });
		return this.loop;
	}

	private async work(): Promise<void> {
		this.running = true;
		this.deps.onChange?.();
		try {
			while (!this.deps.paused()) {
				const item = this.deps.queue().find((q) => q.status === 'waiting');
				if (!item) break;
				item.status = 'running';
				item.message = 'Starting';
				await this.deps.save();
				this.deps.onChange?.();
				try {
					const r = await this.deps.process(item, (m) => { item.message = m; this.deps.onChange?.(); });
					item.status = r.status;
					item.note = r.note;
					item.message = r.message;
				} catch (e) {
					item.status = 'failed';
					item.message = (e as Error).message;
				}
				await this.deps.save();
				this.deps.onChange?.();
			}
		} finally {
			this.running = false;
			this.deps.onChange?.();
		}
	}

	/** The paper in hand finishes; then the batch stops until it is resumed. */
	pause(): void {
		this.deps.setPaused(true);
		void this.deps.save();
		this.deps.onChange?.();
	}

	resume(): Promise<void> {
		this.deps.setPaused(false);
		void this.deps.save();
		return this.start();
	}

	retryFailed(): number {
		let n = 0;
		for (const q of this.deps.queue()) {
			if (q.status === 'failed') {
				q.status = 'waiting';
				q.message = '';
				n++;
			}
		}
		void this.deps.save();
		this.deps.onChange?.();
		return n;
	}

	clearFinished(): number {
		const q = this.deps.queue();
		const keep = q.filter((x) => x.status !== 'done' && x.status !== 'skipped');
		const n = q.length - keep.length;
		q.splice(0, q.length, ...keep);
		void this.deps.save();
		this.deps.onChange?.();
		return n;
	}

	/** A paper leaves the queue, unless it is the one in hand. */
	remove(key: string): boolean {
		const q = this.deps.queue();
		const i = q.findIndex((x) => x.key === key && x.status !== 'running');
		if (i < 0) return false;
		q.splice(i, 1);
		void this.deps.save();
		this.deps.onChange?.();
		return true;
	}
}
