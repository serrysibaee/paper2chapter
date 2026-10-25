import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, Paper2ChapterClient } from '../src/api.ts';
import type { PaperRecord } from '../src/types.ts';
import { noSleep, response, scripted } from './helpers.ts';

const rec = (status: PaperRecord['status'], job: Partial<NonNullable<PaperRecord['job']>> | null = null): PaperRecord => ({
	id: 'p1', filename: 'a.pdf', status, title: '', page_count: 3, has_analysis: false, has_chapter: false,
	usage: { calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0 },
	job: job ? { kind: 'extract', status: 'running', stage: '', progress: 0, message: '', error: null, ...job } : null,
});

test('errors carry the backend detail and status', async () => {
	const http = scripted([(r) => (r.url.endsWith('/analyze') ? response(400, { detail: 'Claude Code is not signed in.' }) : undefined)]);
	const c = new Paper2ChapterClient('http://x:1/', http);
	await assert.rejects(c.analyze('p1'), (e: ApiError) => e.status === 400 && e.message === 'Claude Code is not signed in.');
	assert.equal(http.calls[0]!.url, 'http://x:1/api/papers/p1/analyze');
	assert.equal(http.calls[0]!.method, 'POST');
});

test('an unreachable backend is a clear error, and health() says false', async () => {
	const c = new Paper2ChapterClient('http://x:1', async () => { throw new Error('ECONNREFUSED'); });
	await assert.rejects(c.settings(), /Cannot reach the paper2chapter backend at http:\/\/x:1/);
	assert.equal(await c.health(), false);
});

test('upload sends multipart, export passes its options in the query', async () => {
	const http = scripted([
		(r) => (r.url.endsWith('/api/papers') && r.method === 'POST' ? response(200, rec('extracting')) : undefined),
		(_r, u) => (u.pathname.endsWith('/export.md') ? response(200, { markdown: '# x', assets: [], title: 'x', filename: 'x.md' }) : undefined),
	]);
	const c = new Paper2ChapterClient('http://h', http);
	await c.upload('a.pdf', new ArrayBuffer(4));
	assert.match(http.calls[0]!.contentType!, /^multipart\/form-data; boundary=/);
	await c.exportMarkdown('p1', { solutions: false, assetPrefix: 'My note - ', pdfLink: 'Papers/a b.pdf' });
	const u = new URL(http.calls[1]!.url);
	assert.equal(u.searchParams.get('solutions'), 'false');
	assert.equal(u.searchParams.get('asset_prefix'), 'My note - ');
	assert.equal(u.searchParams.get('pdf_link'), 'Papers/a b.pdf');
	assert.equal(u.searchParams.get('flavor'), 'obsidian');
});

test('waitFor follows a job to its status and reports progress', async () => {
	const seq = [rec('extracting', { progress: 0.2 }), rec('extracting', { progress: 0.8 }), rec('extracted')];
	const c = new Paper2ChapterClient('http://h', scripted([() => response(200, seq.shift() ?? rec('extracted'))]));
	const seen: number[] = [];
	const done = await c.waitFor('p1', ['extracted'], { sleep: noSleep, onProgress: (r) => seen.push(r.job?.progress ?? 1) });
	assert.equal(done.status, 'extracted');
	assert.deepEqual(seen, [0.2, 0.8, 1]);
});

test('waitFor throws the job error when a step fails, and stops when cancelled', async () => {
	const failed = rec('failed', { status: 'failed', kind: 'analyze', error: 'Your Claude plan\'s usage limit was reached.' });
	const c = new Paper2ChapterClient('http://h', scripted([() => response(200, failed)]));
	await assert.rejects(c.waitFor('p1', ['analyzed'], { sleep: noSleep }), /usage limit/);
	const c2 = new Paper2ChapterClient('http://h', scripted([() => response(200, rec('analyzing', { kind: 'analyze' }))]));
	await assert.rejects(c2.waitFor('p1', ['analyzed'], { sleep: noSleep, signal: { aborted: true } }), /Cancelled/);
});
