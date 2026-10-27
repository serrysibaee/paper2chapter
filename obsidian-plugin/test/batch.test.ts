/* The batch: several papers, one at a time, kept in the settings so it survives a restart. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Batch, type BatchDeps } from '../src/batch.ts';
import type { QueueItem } from '../src/config.ts';

function harness(process: BatchDeps['process']) {
	const state = { queue: [] as QueueItem[], paused: false, saves: 0, changes: 0 };
	const batch = new Batch({
		queue: () => state.queue,
		paused: () => state.paused,
		setPaused: (p) => { state.paused = p; },
		save: async () => { state.saves++; },
		process,
		onChange: () => { state.changes++; },
	});
	return { state, batch };
}

const paper = (key: string) => ({ key, name: `${key}.pdf`, kind: 'vault' as const });

test('papers are done one at a time, in order; a paper whose note is there is skipped; a failure stops only that paper', async () => {
	const order: string[] = [];
	const { state, batch } = harness(async (item, report) => {
		order.push(item.key);
		report('Writing the chapter');
		assert.equal(state.queue.filter((q) => q.status === 'running').length, 1, 'one at a time');
		if (item.key === 'b') return { status: 'skipped', note: 'Chapters/B.md', message: 'Chapters/B.md is there already' };
		if (item.key === 'c') throw new Error('The backend is not running.');
		return { status: 'done', note: `Chapters/${item.key}.md`, message: 'Written' };
	});
	assert.deepEqual(batch.add([paper('a'), paper('b'), paper('c'), paper('d')], '2026-10-27'), { added: 4, already: 0 });
	await batch.start();
	assert.deepEqual(order, ['a', 'b', 'c', 'd']);
	assert.deepEqual(state.queue.map((q) => [q.key, q.status]), [['a', 'done'], ['b', 'skipped'], ['c', 'failed'], ['d', 'done']]);
	assert.equal(state.queue[2]!.message, 'The backend is not running.');
	assert.equal(state.queue[0]!.note, 'Chapters/a.md');
	assert.ok(state.saves >= 8, 'saved as each paper starts and ends, so a restart loses nothing');
	assert.equal(batch.running, false);
});

test('pause lets the paper in hand finish, then stops; resume goes on from the next', async () => {
	let h!: ReturnType<typeof harness>;
	h = harness(async (item) => {
		if (item.key === 'a') h.batch.pause();
		return { status: 'done', note: `${item.key}.md`, message: 'Written' };
	});
	h.batch.add([paper('a'), paper('b')], '2026-10-27');
	await h.batch.start();
	assert.deepEqual(h.state.queue.map((q) => q.status), ['done', 'waiting']);
	assert.equal(h.state.paused, true);
	await h.batch.resume();
	assert.deepEqual(h.state.queue.map((q) => q.status), ['done', 'done']);
	assert.equal(h.state.paused, false);
});

test('a paper already waiting is not added twice; finished papers can be cleared and failed ones retried', async () => {
	let fail = true;
	const { state, batch } = harness(async (item) => {
		if (item.key === 'c' && fail) throw new Error('no');
		return { status: 'done', note: 'x.md', message: '' };
	});
	batch.add([paper('a'), paper('c')], '2026-10-27');
	assert.deepEqual(batch.add([paper('a'), paper('e')], '2026-10-27'), { added: 1, already: 1 });
	await batch.start();
	assert.deepEqual(state.queue.map((q) => q.status), ['done', 'failed', 'done']);
	fail = false;
	assert.equal(batch.retryFailed(), 1);
	await batch.start();
	assert.equal(batch.clearFinished(), 3);
	assert.deepEqual(state.queue, []);
});

test('starting twice runs one loop; a paper can be removed unless it is the one in hand', async () => {
	let release!: () => void;
	const gate = new Promise<void>((r) => { release = r; });
	let calls = 0;
	const { state, batch } = harness(async () => { calls++; await gate; return { status: 'done', note: 'x.md', message: '' }; });
	batch.add([paper('a'), paper('b')], '2026-10-27');
	const one = batch.start();
	const two = batch.start();
	await new Promise((r) => setTimeout(r, 0));
	assert.equal(batch.remove('a'), false, 'in hand');
	assert.equal(batch.remove('b'), true);
	release();
	await Promise.all([one, two]);
	assert.equal(calls, 1);
	assert.deepEqual(state.queue.map((q) => q.key), ['a']);
});
