import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Paper2ChapterClient } from '../src/api.ts';
import { ChapterRun, type PaperCacheEntry, type PdfSource } from '../src/run.ts';
import type { PaperRecord } from '../src/types.ts';
import { MemoryVault, noSleep, response, scripted } from './helpers.ts';

/** A backend in memory: each poll moves a running job one step on. */
function fakeBackend() {
	const papers = new Map<string, PaperRecord>();
	const counts = { upload: 0, analyze: 0, generate: 0 };
	let next = 1;
	const make = (id: string): PaperRecord => ({
		id, filename: 'paper.pdf', status: 'extracting', title: 'Paper', page_count: 3, has_analysis: false, has_chapter: false,
		usage: { calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0 },
		job: { kind: 'extract', status: 'running', stage: '', progress: 0.5, message: 'working', error: null },
	});
	const step: Partial<Record<PaperRecord['status'], () => Partial<PaperRecord>>> = {
		extracting: () => ({ status: 'extracted', job: null }),
		analyzing: () => ({ status: 'analyzed', has_analysis: true, job: null }),
		generating: () => ({ status: 'ready', has_chapter: true, job: null }),
	};
	const http = scripted([
		(r, u) => {
			if (u.pathname === '/api/papers' && r.method === 'POST') {
				counts.upload++;
				const p = make('p' + next++);
				papers.set(p.id, p);
				return response(200, p);
			}
			const m = u.pathname.match(/^\/api\/papers\/(\w+)(\/.*)?$/);
			if (!m) return undefined;
			const p = papers.get(m[1]!);
			if (!p) return response(404, { detail: 'Not found' });
			const rest = m[2] ?? '';
			if (rest === '') {
				const out = { ...p };
				const s = step[p.status];
				if (s) Object.assign(p, s());
				return response(200, out);
			}
			if (rest === '/analyze') { counts.analyze++; Object.assign(p, { status: 'analyzing', job: { ...make('').job!, kind: 'analyze' } }); return response(200, p); }
			if (rest === '/generate') { counts.generate++; Object.assign(p, { status: 'generating', job: { ...make('').job!, kind: 'generate' } }); return response(200, p); }
			if (rest === '/analysis') return response(200, { title: 'Softmax Weighting', authors: ['A'], year: '2026', field: 'ML', one_sentence_summary: 's', difficulty: 'intermediate', prerequisites: [] });
			if (rest === '/estimate') return response(200, { provider: 'claude-cli', model: 'sonnet', tier: 'subscription', requests: 12, input_tokens: 1, output_tokens: 1, cost_usd: 0, cost_with_cache_usd: null });
			if (rest.startsWith('/export.md')) return response(200, { markdown: `# Ch\n\n![[${u.searchParams.get('asset_prefix')}F1.png]]\n${u.searchParams.get('pdf_link')}`, assets: ['F1.png'], title: 'Ch', filename: 'Ch.md' });
			if (rest.startsWith('/assets/')) return response(200, 'PNG');
			return undefined;
		},
	]);
	return { http, papers, counts };
}

function setup(stamp = 's1', path = 'Papers/paper.pdf') {
	const be = fakeBackend();
	const client = new Paper2ChapterClient('http://h', be.http);
	const store = new Map<string, PaperCacheEntry>();
	const cache = { get: (p: string) => store.get(p), set: async (p: string, e: PaperCacheEntry) => { store.set(p, e); } };
	const pdf: PdfSource = { path, name: 'paper.pdf', stamp, read: async () => new ArrayBuffer(8) };
	const vault = new MemoryVault();
	return { be, client, cache, store, pdf, vault, run: () => new ChapterRun(client, vault, pdf, cache, noSleep) };
}

const out = { folder: 'Chapters', attachments: 'attachments', solutions: true };
const opts = { audience: 'undergraduate' as const, known_prerequisites: [], focus: '', include_python: true };

test('a PDF goes through upload, extraction, analysis and generation into a note', async () => {
	const t = setup();
	const run = t.run();
	const phases: string[] = [];
	const analysis = await run.prepare((s) => phases.push(s.phase));
	assert.equal(analysis.title, 'Softmax Weighting');
	assert.equal(run.estimate?.tier, 'subscription');
	const res = await run.generate(opts, out, (s) => phases.push(s.phase));
	assert.equal(res.notePath, 'Chapters/Softmax Weighting.md');
	assert.equal(t.vault.text(res.notePath), '# Ch\n\n![[Softmax Weighting - F1.png]]\nPapers/paper.pdf');
	assert.ok(t.vault.files.has('Chapters/attachments/Softmax Weighting - F1.png'));
	for (const p of ['upload', 'extract', 'analyze', 'prepared', 'generate', 'write', 'done']) assert.ok(phases.includes(p), p);
	assert.deepEqual(t.be.counts, { upload: 1, analyze: 1, generate: 1 });
	assert.equal(t.store.get('Papers/paper.pdf')?.paperId, run.paperId);
});

test('an unchanged PDF reuses its extraction and analysis; a changed one is uploaded again', async () => {
	const t = setup();
	await t.run().prepare(() => {});
	await t.run().prepare(() => {});
	assert.deepEqual(t.be.counts, { upload: 1, analyze: 1, generate: 0 });

	t.pdf.stamp = 's2';
	await t.run().prepare(() => {});
	assert.equal(t.be.counts.upload, 2);
});

test('a paper the backend no longer has is uploaded again', async () => {
	const t = setup();
	await t.cache.set('Papers/paper.pdf', { paperId: 'gone', stamp: 's1' });
	await t.run().prepare(() => {});
	assert.equal(t.be.counts.upload, 1);
});

test('a PDF path that cannot be a wikilink is not linked', async () => {
	const t = setup('s1', 'Papers/[draft] paper.pdf');
	const run = t.run();
	await run.prepare(() => {});
	const res = await run.generate(opts, out, () => {});
	assert.ok(!t.vault.text(res.notePath).includes('[draft]'));
});
