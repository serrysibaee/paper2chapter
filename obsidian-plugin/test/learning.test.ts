/* What a chapter gives tools that track learning: flashcards from its exercises, and its manifest. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConceptNote, ReviewRow } from '../src/concepts.ts';
import { flashcards } from '../src/flashcards.ts';
import { renderProperties } from '../src/frontmatter.ts';
import { buildManifest, MANIFEST_MARK } from '../src/manifest.ts';
import { SAMPLE } from '../src/sample.ts';

const EXS = SAMPLE.parts.exercises!;

test('flashcards in Spaced Repetition syntax: the deck tag, then each card as its question, "?", its answer', () => {
	const md = flashcards(EXS, { mode: 'spaced-repetition', tag: '#flashcards', template: '' });
	assert.ok(md.startsWith('#flashcards\n\n'));
	const cards = md.slice('#flashcards\n\n'.length).trimEnd().split('\n\n');
	assert.equal(cards.length, EXS.length);
	for (const c of cards) {
		const lines = c.split('\n');
		assert.equal(lines.filter((l) => l === '?').length, 1, c);
		assert.ok(lines.every((l) => l.trim() !== ''), 'no blank line inside a card: it would end the card');
	}
	const mc = cards[2]!.split('\n?\n');
	assert.match(mc[0]!, /\nA\. .+\nB\. /, 'a multiple-choice question lists its options');
	assert.match(mc[1]!, /^\*\*B\.\*\* /, 'and its answer names the right one first');
});

test('flashcards from a line template, or none', () => {
	const p1 = EXS.find((e) => e.id === 'p1')!;
	assert.equal(flashcards([p1], { mode: 'custom', tag: '', template: 'Q: {{question}} ({{kind}})\nA: {{answer}}' }),
		`Q: ${p1.prompt} (conceptual)\nA: ${p1.answer}\n\n${p1.explanation}\n`);
	assert.equal(flashcards(EXS, { mode: 'none', tag: 'x', template: '' }), '');
	assert.equal(flashcards([], { mode: 'spaced-repetition', tag: 'x', template: '' }), '');
});

test('a "links" property is always a list of links, even with one value', () => {
	const fm = renderProperties([{ key: 'teaches', value: '{{concepts}}', type: 'links' }], { concepts: ['Softmax'] }, (f) => f);
	assert.equal(fm, '---\nteaches:\n  - "[[Softmax]]"\n---\n');
	assert.equal(renderProperties([{ key: 'teaches', value: '{{concepts}}', type: 'links' }], { concepts: [] }, (f) => f), '');
});

const note = (basename: string): ConceptNote => ({ path: `C/${basename}.md`, basename, linktext: basename, frontmatter: {}, tags: [] });

test('the manifest: the paper, each prerequisite with its match and why it was known, the concepts and every exercise', () => {
	const rows: ReviewRow[] = [
		{ id: 'exponential-function', name: 'The exponential function', level: 'foundational', why: 'w', candidates: [note('Exponential function')],
			note: note('Exponential function'), known: true, suggested: { by: 'rule', rule: 'axiom: true' } },
		{ id: 'weighted-averages', name: 'Weighted averages', level: 'foundational', why: 'w', candidates: [], note: null, known: false, suggested: null },
		{ id: 'vectors-dot-products', name: 'Vectors', level: 'foundational', why: 'w', candidates: [note('Dot product')],
			note: note('Dot product'), known: false, suggested: { by: 'knowledge-os', state: 'passed' } },
	];
	const m = buildManifest({
		note: 'Paper chapters/Softmax.md', written: '2026-10-27T12:00:00.000Z', parts: SAMPLE.parts, rows,
		teaches: [note('Softmax')],
		paper: { title: 'Softmax Weighting', authors: ['Jane Doe'], year: '2020', doi: '10.1/x', arxiv: '', paperId: 'p1',
			pdf: 'Papers/a.pdf', zotero: null, note: 'Reading/Papers/Softmax card.md' },
	});
	assert.equal(m.manifest, MANIFEST_MARK);
	assert.equal(m.version, 1);
	assert.equal(m.note, 'Paper chapters/Softmax.md');
	assert.deepEqual(m.paper.ids, { doi: '10.1/x', arxiv: null, paper_id: 'p1' });
	assert.equal(m.paper.note, 'Reading/Papers/Softmax card.md');
	assert.deepEqual(m.prerequisites.map((p) => [p.id, p.note, p.known, p.known_by, p.suggested, p.primed]), [
		['exponential-function', 'C/Exponential function.md', true, 'rule', true, false],
		['weighted-averages', null, false, null, false, true],
		['vectors-dot-products', 'C/Dot product.md', false, null, true, true], // the reader unticked the suggestion
	]);
	assert.equal(m.prerequisites[0]!.reason, 'known by the rule axiom: true');
	assert.deepEqual(m.teaches, ['C/Softmax.md']);
	assert.deepEqual(m.primers.map((p) => p.prerequisite_id), ['weighted-averages', 'vectors-dot-products']);
	assert.equal(m.exercises.length, EXS.length);
	assert.deepEqual(Object.keys(m.exercises[0]!).sort(), ['answer', 'check', 'choices', 'correct_choice', 'difficulty', 'explanation',
		'id', 'kind', 'prerequisite_id', 'prompt', 'section', 'where'].sort());
	assert.equal(m.model, `${SAMPLE.parts.provider}/${SAMPLE.parts.model}`);
});

test('a reader who ticks a prerequisite nothing suggested is recorded as the reason', () => {
	const rows: ReviewRow[] = [{ id: 'x', name: 'X', level: '', why: '', candidates: [], note: null, known: true, suggested: null }];
	const m = buildManifest({ note: 'n.md', written: 'w', parts: null, rows, teaches: [],
		paper: { title: 't', authors: [], year: '', doi: '', arxiv: '', paperId: 'p', pdf: '', zotero: null, note: null } });
	assert.deepEqual([m.prerequisites[0]!.known_by, m.prerequisites[0]!.reason], ['reader', 'ticked by you']);
	assert.deepEqual(m.exercises, []);
});
