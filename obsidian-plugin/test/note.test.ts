/* Writing a chapter note under the note settings: layouts, properties, folders and names, page links, quiet hours. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Paper2ChapterClient } from '../src/api.ts';
import { DEFAULT_SETTINGS, type P2CSettings } from '../src/config.ts';
import { ChapterRun, type NoteEnv, type PdfSource } from '../src/run.ts';
import { SAMPLE } from '../src/sample.ts';
import type { ChapterParts, PaperAnalysis } from '../src/types.ts';
import { MemoryVault, noSleep, response, scripted } from './helpers.ts';

const ANALYSIS: PaperAnalysis = { title: 'Softmax Weighting for Robust Averaging', authors: ['Jane Doe', 'John Roe'], year: '2020', field: 'ML',
	one_sentence_summary: 's', difficulty: 'intermediate', prerequisites: [] };

function backend(pageCount: number | null = null) {
	const exports: URLSearchParams[] = [];
	const http = scripted([(_r, u) => {
		const m = u.pathname.match(/^\/api\/papers\/p1(\/.*)$/);
		if (!m) return undefined;
		const rest = m[1]!;
		if (rest === '/analysis') return response(200, ANALYSIS);
		const prefix = u.searchParams.get('asset_prefix') ?? '';
		if (rest === '/export.md') {
			exports.push(u.searchParams);
			return response(200, { markdown: SAMPLE.markdown.replaceAll('![[F1.png]]', `![[${prefix}F1.png]]`), assets: SAMPLE.assets, title: SAMPLE.parts.title, filename: 'x.md' });
		}
		if (rest === '/export.parts') {
			exports.push(u.searchParams);
			const parts = JSON.parse(JSON.stringify(SAMPLE.parts).replaceAll('![[F1.png]]', `![[${prefix}F1.png]]`)) as ChapterParts;
			if (pageCount !== null) parts.paper.page_count = pageCount;
			return response(200, parts);
		}
		if (rest.startsWith('/assets/')) return response(200, 'PNG');
		return undefined;
	}]);
	return { http, exports };
}

const vaultPdf: PdfSource = { path: 'Papers/sample.pdf', name: 'sample.pdf', stamp: 's', read: async () => new ArrayBuffer(1) };

function setup(pdf: PdfSource = vaultPdf, envOver: Partial<NoteEnv> = {}, pageCount: number | null = null) {
	const be = backend(pageCount);
	const vault = new MemoryVault();
	const waits: number[] = [];
	const env: NoteEnv = {
		formatDate: (f) => (f === 'YYYY-MM-DD' ? '2026-10-26' : f),
		now: () => new Date(2026, 9, 26, 12, 0),
		wait: async (ms) => { waits.push(ms); },
		paperNote: () => null,
		template: async () => { throw new Error('no template'); },
		...envOver,
	};
	const run = new ChapterRun(new Paper2ChapterClient('http://h', be.http), vault, pdf, { get: () => undefined, set: async () => {} }, noSleep);
	run.paperId = 'p1';
	run.analysis = ANALYSIS; // as after prepare(): a generation always has it
	const note =(s: Partial<P2CSettings> = {}): P2CSettings => ({ ...DEFAULT_SETTINGS, ...s });
	const write = (s: Partial<P2CSettings> = {}) => run.write({ folder: 'ignored', attachments: 'ignored', solutions: true, note: note(s), env }, () => {});
	return { be, vault, run, env, waits, write };
}

test('the default settings write exactly the 0.1.1 note, where 0.1.1 wrote it', async () => {
	const a = setup();
	const old = await a.run.write({ folder: 'Paper chapters', attachments: 'attachments', solutions: true }, () => {});
	const b = setup();
	const now = await b.write();
	assert.equal(now.notePath, old.notePath);
	assert.equal(now.notePath, 'Paper chapters/Softmax Weighting for Robust Averaging.md');
	assert.equal(b.vault.text(now.notePath), a.vault.text(old.notePath));
	assert.deepEqual(now.assetPaths, old.assetPaths);
	assert.equal(b.be.exports[0]!.get('pdf_link'), 'Papers/sample.pdf');
	assert.equal(b.be.exports[0]!.get('page_link'), null, 'no page_link: the 0.1.1 request');
});

test('the Textbook layout builds the note from the parts, with the 0.1.1 properties', async () => {
	const t = setup();
	const res = await t.write({ layout: 'textbook' });
	const text = t.vault.text(res.notePath);
	assert.ok(t.be.exports[0]!.has('asset_prefix') && t.be.http.calls.some((c) => c.url.includes('/export.parts')));
	assert.ok(text.startsWith('---\ntitle: "Softmax-Weighted Averages"\npaper: "Softmax Weighting for Robust Averaging"\n'));
	assert.ok(text.includes('source_pdf: "[[Papers/sample.pdf]]"'));
	assert.ok(text.includes('\n---\n\n# Softmax-Weighted Averages\n\n> [!abstract] The chapter in one line\n'));
	assert.ok(text.includes('## Intuition first') && text.includes('## What it assumes') && text.includes('## Practice problems'));
	assert.ok(text.includes('![[Softmax Weighting for Robust Averaging - F1.png]]'));
	assert.ok(t.vault.files.has('Paper chapters/attachments/Softmax Weighting for Robust Averaging - F1.png'));
});

test('custom properties on the 0.1.1 layout: its body, the reader\'s frontmatter', async () => {
	const t = setup(vaultPdf, { paperNote: () => ({ linktext: 'Softmax card', folder: 'Reading/Papers' }) });
	const res = await t.write({ paperNoteKeys: 'source', propertiesMode: 'custom', propertyRows: [
		{ key: 'type', value: 'source-summary', type: 'text' },
		{ key: 'up', value: '{{paperNote}}', type: 'link' },
		{ key: 'year', value: '{{year}}', type: 'number' },
	] });
	const text = t.vault.text(res.notePath);
	assert.ok(text.startsWith('---\ntype: "source-summary"\nup: "[[Softmax card]]"\nyear: 2020\n---\n\n# Softmax-Weighted Averages\n'));
	assert.ok(!text.includes('generator: "paper2chapter"'));
});

test('folder and note-name templates, with the paper\'s own note', async () => {
	const t = setup(vaultPdf, { paperNote: () => ({ linktext: 'Softmax card', folder: 'Reading/Papers' }) });
	const res = await t.write({ paperNoteKeys: 'source', outputFolder: '{{paperNoteFolder}}/chapters/{{year}}', noteName: '{{paperNote}} - Chapter' });
	assert.equal(res.notePath, 'Reading/Papers/chapters/2020/Softmax card - Chapter.md');
});

test('pages from the paper\'s page count; a fallback name and title when the paper has no note', async () => {
	const t = setup(vaultPdf, {}, 14);
	const res = await t.write({ paperNoteKeys: 'source', noteName: '{{paperNote|paperTitle}} - Chapter', propertiesMode: 'custom',
		propertyRows: [
			{ key: 'up', value: '{{paperNote}}', type: 'link' },
			{ key: 'pages', value: '{{pages}}', type: 'text' },
			{ key: 'title', value: '{{paperNote|paperTitle}} - Chapter', type: 'text' },
		] });
	assert.equal(res.notePath, 'Paper chapters/Softmax Weighting for Robust Averaging - Chapter.md');
	assert.ok(t.vault.text(res.notePath).startsWith('---\npages: "1–14"\ntitle: "Softmax Weighting for Robust Averaging - Chapter"\n---\n'),
		'no up: the paper has no note of its own');
	const named = setup(vaultPdf, { paperNote: () => ({ linktext: 'Softmax card', folder: 'Reading/Papers' }) }, 14);
	const res2 = await named.write({ paperNoteKeys: 'source', noteName: '{{paperNote|paperTitle}} - Chapter' });
	assert.equal(res2.notePath, 'Paper chapters/Softmax card - Chapter.md');
});

test('a template note: its pieces, tokens and properties', async () => {
	const tpl = '```nav\n```\n\n# {{title}}\n\n> [!abstract] The chapter in one line\n> {{oneLine}}\n\n## Arc\n\n{{sections}}\n\n## Worked examples\n\n{{workedExamples}}\n';
	const t = setup(vaultPdf, { template: async (p) => { assert.equal(p, 'Templates/Chapter.md'); return tpl; } });
	const res = await t.write({ layout: 'template', templatePath: 'Templates/Chapter.md', headingLevel: 3,
		sectionHeading: '1.{{n}} {{title}}{{#page}} — p. {{page}}{{/page}}', examples: 'gathered' });
	const text = t.vault.text(res.notePath);
	assert.ok(text.includes('\n```nav\n```\n\n# Softmax-Weighted Averages\n'));
	assert.ok(/\n### 1\.1 .+ — p\. 1\n/.test(text));
	assert.ok(text.includes('## Worked examples\n\n> [!example] '));
});

test('a template note that is not there stops the write with its name', async () => {
	const t = setup(vaultPdf, { template: async () => { throw new Error('The template note Templates/X.md does not exist.'); } });
	await assert.rejects(t.write({ layout: 'template', templatePath: 'Templates/X.md' }), /Templates\/X\.md/);
});

test('page links: the vault PDF, Zotero, a file outside the vault, a custom template, or none', async () => {
	const zot: PdfSource = { path: 'zotero:ITEM0001', name: 'Diffusion.pdf', stamp: 'z', read: async () => new ArrayBuffer(1),
		kind: 'zotero', zotero: { itemKey: 'ITEM0001', pdfKey: 'PDF00001' }, absPath: 'C:/Zotero/storage/PDF00001/Diffusion.pdf' };
	const ext: PdfSource = { path: 'G:/My Papers/Lit/A (B).pdf', name: 'A (B).pdf', stamp: 'f', read: async () => new ArrayBuffer(1),
		kind: 'file', absPath: 'G:/My Papers/Lit/A (B).pdf' };
	const z = setup(zot);
	await z.write();
	assert.equal(z.be.exports[0]!.get('page_link'), 'zotero://open-pdf/library/items/PDF00001?page={page}');
	assert.equal(z.be.exports[0]!.get('pdf_link'), '', 'a PDF outside the vault is no wikilink');
	const f = setup(ext);
	await f.write();
	assert.equal(f.be.exports[0]!.get('page_link'), 'file:///G:/My%20Papers/Lit/A%20%28B%29.pdf#page={page}');
	const c = setup(zot);
	await c.write({ pageLinks: 'custom', pageLinkTemplate: 'zotero://open-pdf/library/items/{{zoteroPdfKey}}?page={page}&x=1' });
	assert.equal(c.be.exports[0]!.get('page_link'), 'zotero://open-pdf/library/items/PDF00001?page={page}&x=1');
	const bad = setup(zot);
	await bad.write({ pageLinks: 'custom', pageLinkTemplate: 'zotero://x/{{doi}}?page={page} broken' });
	assert.equal(bad.be.exports[0]!.get('page_link'), null, 'an unusable link falls back to plain page numbers');
	const p = setup();
	await p.write({ pageLinks: 'plain' });
	assert.equal(p.be.exports[0]!.get('pdf_link'), '');
	assert.equal(p.be.exports[0]!.get('page_link'), null);
});

test('quiet hours: a chapter that finishes inside them waits for their end', async () => {
	const t = setup(vaultPdf, { now: () => new Date(2026, 9, 26, 23, 58) });
	const seen: string[] = [];
	await t.run.write({ folder: '', attachments: '', solutions: true, note: { ...DEFAULT_SETTINGS, quietHours: '23:55-04:30' }, env: t.env }, (s) => seen.push(s.message));
	assert.deepEqual(t.waits, [(2 + 4 * 60 + 30) * 60_000]);
	assert.ok(seen.some((m) => m.includes('04:30')));
});

test('when the name is taken: a numbered note, or none', async () => {
	const t = setup();
	await t.write();
	const second = await t.write();
	assert.equal(second.notePath, 'Paper chapters/Softmax Weighting for Robust Averaging 2.md');
	const skipped = await t.write({ onExists: 'skip' });
	assert.equal(skipped.skipped, true);
	assert.equal(skipped.notePath, 'Paper chapters/Softmax Weighting for Robust Averaging.md');
	assert.equal([...t.vault.files.keys()].filter((k) => k.endsWith('.md')).length, 2);
});

test('figures: a fixed folder, or where Obsidian puts attachments', async () => {
	const t = setup();
	const res = await t.write({ figures: 'folder', figuresFolder: 'Assets/Figures' });
	assert.deepEqual(res.assetPaths, ['Assets/Figures/Softmax Weighting for Robust Averaging - F1.png']);
	const o = setup(vaultPdf, { attachmentPath: async (name, notePath) => {
		assert.equal(notePath, 'Paper chapters/Softmax Weighting for Robust Averaging.md');
		return `Files/${name.replace('.png', ' 1.png')}`; // Obsidian gave another name
	} });
	const r2 = await o.write({ figures: 'obsidian' });
	assert.deepEqual(r2.assetPaths, ['Files/Softmax Weighting for Robust Averaging - F1 1.png']);
	assert.ok(o.vault.text(r2.notePath).includes('![[Softmax Weighting for Robust Averaging - F1 1.png]]'), 'the embed follows the new name');
});

test('the preview is written by the same code, into memory, and sees a taken name', async () => {
	const { previewNote } = await import('../src/sampleBackend.ts');
	const env: NoteEnv = { formatDate: (f) => f, now: () => new Date(2026, 9, 26, 23, 58), wait: async () => { throw new Error('the preview never waits'); },
		paperNote: () => null, template: async () => '# {{title}}\n\n{{summary}}\n' };
	const classic = await previewNote({ ...DEFAULT_SETTINGS, quietHours: '23:55-04:30' }, env);
	assert.equal(classic.notePath, `Paper chapters/${SAMPLE.parts.paper.title}.md`);
	assert.equal(classic.markdown, SAMPLE.markdown.replaceAll('![[F1.png]]', `![[${SAMPLE.parts.paper.title} - F1.png]]`));
	const mine = await previewNote({ ...DEFAULT_SETTINGS, layout: 'template', templatePath: 'T.md', propertiesMode: 'custom', propertyRows: [] }, env);
	assert.equal(mine.markdown, `# ${SAMPLE.parts.title}\n\n${SAMPLE.parts.summary}\n`);
	const taken = await previewNote({ ...DEFAULT_SETTINGS, onExists: 'skip' }, env, (p) => p === `Paper chapters/${SAMPLE.parts.paper.title}.md`);
	assert.equal(taken.skipped, true);
});
