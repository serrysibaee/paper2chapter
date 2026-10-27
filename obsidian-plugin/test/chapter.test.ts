/*
 * Writing a chapter with the reader settings and the integrations: the concept properties, the reviewed matches, the
 * two blocks, flashcards, the manifest and Templater. Every integration both present and absent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Paper2ChapterClient } from '../src/api.ts';
import type { ConceptNote, ReviewEnv } from '../src/concepts.ts';
import { parseRules } from '../src/concepts.ts';
import { DEFAULT_SETTINGS, type P2CSettings } from '../src/config.ts';
import type { PluginLookup } from '../src/integrations.ts';
import type { Manifest } from '../src/manifest.ts';
import { ChapterRun, type NoteEnv, type PdfSource } from '../src/run.ts';
import { SAMPLE } from '../src/sample.ts';
import type { PaperAnalysis } from '../src/types.ts';
import { MemoryVault, noSleep, response, scripted } from './helpers.ts';

const ANALYSIS: PaperAnalysis = { title: 'Softmax Weighting for Robust Averaging', authors: ['Jane Doe'], year: '2020', field: 'ML',
	one_sentence_summary: 's', difficulty: 'intermediate', prerequisites: [] };

const concept = (basename: string, fm: Record<string, unknown> = {}): ConceptNote =>
	({ path: `Concepts/${basename}.md`, basename, linktext: basename, frontmatter: { type: 'concept', ...fm }, tags: [] });
const NOTES = [concept('Exponential function', { axiom: true }), concept('Weighted average'),
	concept('Softmax Weighting', { aliases: ['Softmax Weighting for Robust Averaging'] })];

function backend(parts = SAMPLE.parts) {
	const http = scripted([(_r, u) => {
		const rest = u.pathname.match(/^\/api\/papers\/p1(\/.*)$/)?.[1];
		if (!rest) return undefined;
		const prefix = u.searchParams.get('asset_prefix') ?? '';
		if (rest === '/analysis') return response(200, ANALYSIS);
		if (rest === '/export.md') {
			return response(200, { markdown: SAMPLE.markdown.replaceAll('![[F1.png]]', `![[${prefix}F1.png]]`), assets: SAMPLE.assets, title: SAMPLE.parts.title, filename: 'x.md' });
		}
		if (rest === '/export.parts') return response(200, JSON.parse(JSON.stringify(parts).replaceAll('![[F1.png]]', `![[${prefix}F1.png]]`)));
		if (rest.startsWith('/assets/')) return response(200, 'PNG');
		return undefined;
	}]);
	return http;
}

const plugins = (p: Record<string, unknown>): PluginLookup => (id) =>
	(id in p ? { installed: true, enabled: true, instance: p[id] } : { installed: false, enabled: false });

const KOS = { api: { version: 1, status: async () => ({}) } };
const NR = { settings: { blockName: 'nav', parentKey: 'up', inverse: [{ key: 'teaches' }] } };

function setup(over: { env?: Partial<NoteEnv>; parts?: typeof SAMPLE.parts; pdf?: PdfSource } = {}) {
	const vault = new MemoryVault();
	const review: ReviewEnv = { notes: () => NOTES, rules: parseRules('axiom: true').rules };
	const env: NoteEnv = {
		formatDate: (f) => f, now: () => new Date(2026, 9, 27, 12, 0), wait: async () => {}, paperNote: () => null,
		template: async () => { throw new Error('no template'); }, review, plugins: plugins({}), ...over.env,
	};
	const pdf = over.pdf ?? { path: 'Papers/sample.pdf', name: 'sample.pdf', stamp: 's', read: async () => new ArrayBuffer(1) };
	const run = new ChapterRun(new Paper2ChapterClient('http://h', backend(over.parts)), vault, pdf, { get: () => undefined, set: async () => {} }, noSleep);
	run.paperId = 'p1';
	run.analysis = ANALYSIS;
	const write = (s: Partial<P2CSettings> = {}) => run.write({ folder: '', attachments: '', solutions: true, note: { ...DEFAULT_SETTINGS, ...s }, env }, () => {});
	return { vault, run, env, write };
}

test('matching concepts adds what the chapter teaches and assumes to the 0.1.1 properties; the body stays the backend\'s', async () => {
	const t = setup();
	const res = await t.write({ matchConcepts: true });
	const text = t.vault.text(res.notePath);
	const classic = SAMPLE.markdown.replaceAll('![[F1.png]]', `![[${SAMPLE.parts.paper.title} - F1.png]]`);
	assert.ok(text.startsWith('---\ntitle: "Softmax-Weighted Averages"\npaper: '), 'the 0.1.1 rows first');
	assert.ok(text.includes('\ntags:\n  - "paper2chapter"\nteaches:\n  - "[[Softmax Weighting]]"\nprerequisites:\n  - "[[Exponential function]]"\n  - "[[Weighted average]]"\n---\n'));
	assert.ok(text.endsWith(classic.slice(classic.indexOf('\n---\n') + 5)), 'the body is the backend\'s note');
});

test('the reader\'s review from the generation decides the links; the prerequisites property can be renamed', async () => {
	const t = setup();
	const other = concept('Vector');
	t.run.review = {
		rows: [{ id: 'vectors-dot-products', name: 'Vectors and dot products', level: '', why: '', candidates: [], note: other, known: false, suggested: null }],
		teaches: [concept('Softmax')],
	};
	const res = await t.write({ matchConcepts: true, prerequisitesKey: 'assumes', propertiesMode: 'custom', propertyRows: [
		{ key: 'teaches', value: '{{concepts}}\n{{primedConcepts}}', type: 'links' },
		{ key: 'assumes', value: '{{assumedConcepts}}', type: 'links' },
		{ key: 'known', value: '{{knownConcepts}}', type: 'links' },
	] });
	assert.ok(t.vault.text(res.notePath).startsWith('---\nteaches:\n  - "[[Softmax]]"\n  - "[[Vector]]"\nassumes:\n  - "[[Vector]]"\n---\n'));
});

test('Note Relatives on: its block after the frontmatter; not installed: no block', async () => {
	const on = setup({ env: { plugins: plugins({ 'note-relatives': NR }) } });
	const a = on.vault.text((await on.write({ noteRelatives: true })).notePath);
	assert.match(a, /\n---\n```nav\n```\n\n# /);
	const off = setup();
	const b = off.vault.text((await off.write({ noteRelatives: true })).notePath);
	assert.ok(!b.includes('```nav'), 'a vault without the plugin never shows a raw code block');
});

test('the Knowledge OS on: the live block, only with its API and concept matching', async () => {
	const t = setup({ env: { plugins: plugins({ 'knowledge-os': KOS }) } });
	const a = t.vault.text((await t.write({ knowledgeOs: true, matchConcepts: true, prerequisitesKey: 'assumes' })).notePath);
	assert.ok(a.includes('```knowledge-os\nprogress\nteaches: teaches\nassumes: assumes\n```'));
	const old = setup({ env: { plugins: plugins({ 'knowledge-os': {} }) } });
	assert.ok(!old.vault.text((await old.write({ knowledgeOs: true, matchConcepts: true })).notePath).includes('knowledge-os'), 'no API: no block');
	const nomatch = setup({ env: { plugins: plugins({ 'knowledge-os': KOS }) } });
	assert.ok(!nomatch.vault.text((await nomatch.write({ knowledgeOs: true })).notePath).includes('knowledge-os'), 'no concept properties to draw');
});

test('a template places both blocks where it says, once', async () => {
	const tpl = '```nav\n```\n\n# {{title}}\n\n## What it assumes\n\n{{progress}}\n\n{{primers}}\n';
	const t = setup({ env: { template: async () => tpl, plugins: plugins({ 'knowledge-os': KOS, 'note-relatives': NR }) } });
	const text = t.vault.text((await t.write({ layout: 'template', templatePath: 'T.md', matchConcepts: true, knowledgeOs: true, noteRelatives: true })).notePath);
	assert.equal(text.split('```nav').length, 2);
	assert.equal(text.split('```knowledge-os').length, 2);
	assert.ok(text.indexOf('## What it assumes') < text.indexOf('```knowledge-os'));
});

test('flashcards: a section at the end of the note, or where a template puts them', async () => {
	const t = setup();
	const a = t.vault.text((await t.write({ flashcards: 'spaced-repetition', flashcardTag: 'cards/softmax' })).notePath);
	assert.match(a, /\n## Flashcards\n\n#cards\/softmax\n\n[^\n]+\n[\s\S]*?\n\?\n/);
	assert.ok(a.trimEnd().endsWith(SAMPLE.parts.exercises!.at(-1)!.explanation.split('\n').filter((l) => l.trim()).at(-1)!));
	const tpl = setup({ env: { template: async () => '# {{title}}\n\n{{#flashcards}}\n## Cards\n\n{{flashcards}}\n{{/flashcards}}\n\nEnd\n' } });
	const b = tpl.vault.text((await tpl.write({ layout: 'template', templatePath: 'T.md', flashcards: 'spaced-repetition' })).notePath);
	assert.ok(b.includes('## Cards\n\n#flashcards\n\n') && b.trimEnd().endsWith('End') && !b.includes('## Flashcards'));
	const old = setup({ parts: { ...SAMPLE.parts, exercises: undefined } });
	assert.ok(!old.vault.text((await old.write({ flashcards: 'spaced-repetition' })).notePath).includes('Flashcards'), 'an older backend: no cards');
});

test('the manifest is written beside the note\'s choices, never over another, and not for a note not written', async () => {
	const t = setup();
	const res = await t.write({ manifest: true, manifestPath: 'Data/{{paperSlug}}.json', matchConcepts: true });
	assert.equal(res.manifestPath, 'Data/softmax-weighting-for-robust-averaging.json');
	const m = JSON.parse(t.vault.text(res.manifestPath)) as Manifest;
	assert.equal(m.note, res.notePath);
	assert.deepEqual(m.prerequisites.map((p) => [p.id, p.note, p.known]), [
		['exponential-function', 'Concepts/Exponential function.md', true],
		['weighted-averages', 'Concepts/Weighted average.md', false],
		['vectors-dot-products', null, false]]);
	assert.equal((await t.write({ manifest: true, manifestPath: 'Data/{{paperSlug}}.json' })).manifestPath, 'Data/softmax-weighting-for-robust-averaging 2.json');
	const skip = await t.write({ manifest: true, manifestPath: 'Data/{{paperSlug}}.json', onExists: 'skip' });
	assert.equal(skip.skipped, true);
	assert.equal(skip.manifestPath, undefined);
});

test('a chapter written without a review (an import) says what was known when it was generated, not why today', async () => {
	const t = setup();
	const res = await t.write({ matchConcepts: true, manifest: true, manifestPath: 'Data/{{paperSlug}}.json' });
	const m = JSON.parse(t.vault.text(res.manifestPath!)) as Manifest;
	const exp = m.prerequisites.find((p) => p.id === 'exponential-function')!;
	assert.deepEqual([exp.known, exp.known_by, exp.reason, exp.suggested], [true, 'generation', 'known when the chapter was generated', false]);
	const other = m.prerequisites.find((p) => p.id === 'weighted-averages')!;
	assert.deepEqual([other.known, other.known_by, other.suggested], [false, null, false]);
	const off = setup();
	const res2 = await off.write({ manifest: true, manifestPath: 'Data/{{paperSlug}}.json' });
	const m2 = JSON.parse(off.vault.text(res2.manifestPath!)) as Manifest;
	assert.equal(m2.prerequisites.find((p) => p.id === 'exponential-function')!.known_by, 'generation', 'without matching too');
});

test('a chapter written from the reader\'s review keeps its reasons', async () => {
	const t = setup();
	t.run.review = { rows: [{ id: 'exponential-function', name: 'The exponential function', level: '', why: '', candidates: [],
		note: NOTES[0]!, known: true, suggested: { by: 'rule', rule: 'axiom: true' } }], teaches: [] };
	const res = await t.write({ matchConcepts: true, manifest: true, manifestPath: 'Data/{{paperSlug}}.json' });
	const m = JSON.parse(t.vault.text(res.manifestPath!)) as Manifest;
	assert.deepEqual([m.prerequisites[0]!.known_by, m.prerequisites[0]!.reason], ['rule', 'known by the rule axiom: true']);
});

test('Templater: off, the template\'s own tags are defused; on, they stay, and text from the paper is still defused', async () => {
	const tpl = '# {{title}}\n\nMade <% tp.date.now() %>\n\n{{summary}}\n';
	const parts = { ...SAMPLE.parts, summary: 'Model text <% tp.file.delete() %>' };
	const off = setup({ parts, env: { template: async () => tpl } });
	const a = off.vault.text((await off.write({ layout: 'template', templatePath: 'T.md' })).notePath);
	assert.ok(!a.includes('<%'));
	const on = setup({ parts, env: { template: async () => tpl } });
	const b = on.vault.text((await on.write({ layout: 'template', templatePath: 'T.md', templater: true })).notePath);
	assert.ok(b.includes('Made <% tp.date.now() %>'), 'the template\'s own tag, for Templater to run');
	assert.ok(b.includes('Model text <⁠% tp.file.delete() %>'), 'never the model\'s');
});
