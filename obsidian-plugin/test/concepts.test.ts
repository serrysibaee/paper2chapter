/* Concept notes, known-concept rules, and the prerequisite review: what the reader confirms before a chapter. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	ConceptIndex, conceptKey, conceptLinks, isConceptNote, knownFor, parseRules, suggestReview, teachSuggestions,
	type ConceptNote,
} from '../src/concepts.ts';
import type { Prerequisite } from '../src/types.ts';

const note = (path: string, frontmatter: Record<string, unknown> = {}, tags: string[] = []): ConceptNote => {
	const basename = path.split('/').pop()!.replace(/\.md$/, '');
	return { path, basename, linktext: basename, frontmatter, tags };
};

const NOTES = [
	note('Concepts/Markov decision process.md', { type: 'concept', aliases: ['MDP'], status: 'mastered' }),
	note('Concepts/Dot product.md', { type: 'concept', axiom: true }),
	note('Concepts/Softmax.md', { type: 'concept', status: 'seed' }),
	note('Concepts/Diffusion Policy.md', { type: 'concept' }),
	note('Concepts/Gradient descent.md', { type: 'concept' }, ['known']),
	note('Sources/Gradient descent.md', { type: 'source-summary' }),
	note('Concepts/Attention.md', { type: 'concept' }),
	note('Concepts/Attention (machine learning).md', { type: 'concept', title: 'Attention' }),
];

const prereq = (id: string, name: string): Prerequisite => ({ id, name, why_needed: `${name} is used`, level: 'foundational' });

test('rules: a folder, a tag, a property with accepted values; problems named by line', () => {
	const { rules, problems } = parseRules('folder: Concepts\n#known\ntag: topics/ml\nstatus: mastered, evergreen\naxiom: true\n\nnonsense');
	assert.deepEqual(rules.map((r) => r.kind), ['folder', 'tag', 'tag', 'property', 'property']);
	assert.deepEqual(problems, ['Line 7: write folder: …, tag: …, or a property and its values (status: mastered, evergreen).']);
	assert.deepEqual(parseRules('').rules, []);
});

test('concept notes: in their folders and holding every filter rule', () => {
	const filter = parseRules('type: concept').rules;
	assert.equal(isConceptNote(NOTES[0]!, ['Concepts'], filter), true);
	assert.equal(isConceptNote(NOTES[5]!, ['Concepts'], filter), false, 'another folder');
	assert.equal(isConceptNote(NOTES[5]!, [], filter), false, 'not a concept');
	assert.equal(isConceptNote(NOTES[5]!, [], []), true, 'no folders and no filter: every note');
});

test('names match by the note\'s name, its title and its aliases; case, accents, punctuation and plurals aside', () => {
	assert.equal(conceptKey('Markov Decision Processes (MDPs)'), conceptKey('markov decision process'));
	assert.equal(conceptKey('Dot products'), conceptKey('dot-product'));
	assert.equal(conceptKey('Señal'), conceptKey('senal'));
	assert.equal(conceptKey('The exponential function'), conceptKey('Exponential function'), 'a leading article');
	assert.equal(conceptKey('A'), 'a', 'a name that is only an article stays');
	const idx = new ConceptIndex(NOTES.slice(0, 5));
	assert.deepEqual(idx.find('Markov decision processes').map((n) => n.basename), ['Markov decision process']);
	assert.deepEqual(idx.find('MDP').map((n) => n.basename), ['Markov decision process'], 'an alias');
	assert.deepEqual(idx.find('Matrix multiplication'), [], 'no guessing beyond the name');
	const two = new ConceptIndex(NOTES.slice(6));
	assert.deepEqual(two.find('attention').map((n) => n.basename).sort(), ['Attention', 'Attention (machine learning)'], 'both, for the reader to choose');
});

test('known: the Knowledge OS decides what it knows, then Dataview, then the rules; else not known', () => {
	const rules = parseRules('axiom: true\nstatus: known, mastered, evergreen\n#known').rules;
	const [mdp, dot, softmax, , gd] = NOTES;
	assert.deepEqual(knownFor(mdp!, 'MDP', { rules }), { by: 'rule', rule: 'status: known, mastered, evergreen' });
	assert.deepEqual(knownFor(dot!, 'Dot product', { rules }), { by: 'rule', rule: 'axiom: true' });
	assert.deepEqual(knownFor(gd!, 'Gradient descent', { rules }), { by: 'rule', rule: 'tag: known' });
	assert.equal(knownFor(softmax!, 'Softmax', { rules }), null);
	assert.equal(knownFor(null, 'Softmax', { rules }), null, 'no note, no rule to apply');
	const kos = { 'Markov decision process': { state: 'ready', stands: false }, Softmax: { state: 'mastered', stands: true } };
	assert.equal(knownFor(mdp!, 'MDP', { rules, kos }), null, 'the Knowledge OS knows it, and says it does not stand');
	assert.deepEqual(knownFor(softmax!, 'Softmax', { rules, kos }), { by: 'knowledge-os', state: 'mastered' });
	assert.deepEqual(knownFor(dot!, 'Dot product', { rules, kos }), { by: 'rule', rule: 'axiom: true' }, 'not in the Knowledge OS: the rules');
	assert.deepEqual(knownFor(softmax!, 'Softmax', { rules, dataview: new Set([softmax!.path]) }), { by: 'dataview' });
});

test('the review: each prerequisite with its match and why it is pre-ticked; nothing ticked without a reason', async () => {
	const prereqs = [prereq('mdp', 'Markov decision processes'), prereq('dot', 'Dot products'), prereq('soft', 'Softmax'),
		prereq('att', 'Attention'), prereq('mm', 'Matrix multiplication')];
	const rows = await suggestReview(prereqs, {
		notes: () => [...NOTES.slice(0, 4), ...NOTES.slice(6)],
		rules: parseRules('axiom: true\nstatus: known, mastered, evergreen').rules,
		knowledge: async (names) => { assert.ok(names.includes('Markov decision process') && names.includes('Matrix multiplication')); return null; },
	});
	assert.deepEqual(rows.map((r) => [r.id, r.note?.basename ?? null, r.known, r.suggested?.by ?? null]), [
		['mdp', 'Markov decision process', true, 'rule'],
		['dot', 'Dot product', true, 'rule'],
		['soft', 'Softmax', false, null],
		['att', null, false, null], // two candidates: the reader picks one
		['mm', null, false, null],
	]);
	assert.equal(rows[3]!.candidates.length, 2);
});

test('the review without concept notes: the Knowledge OS by name, or nothing pre-ticked', async () => {
	const rows = await suggestReview([prereq('soft', 'Softmax')], {
		notes: () => [], rules: [], knowledge: async () => ({ Softmax: { state: 'passed', stands: true } }),
	});
	assert.deepEqual([rows[0]!.note, rows[0]!.known, rows[0]!.suggested], [null, true, { by: 'knowledge-os', state: 'passed' }]);
});

test('what it teaches: the concept the paper is named for, in its title or before its colon', () => {
	const idx = new ConceptIndex(NOTES);
	assert.deepEqual(teachSuggestions('Diffusion Policy: Visuomotor Policy Learning via Action Diffusion', idx).map((n) => n.basename), ['Diffusion Policy']);
	assert.deepEqual(teachSuggestions('Softmax', idx).map((n) => n.basename), ['Softmax']);
	assert.deepEqual(teachSuggestions('Something else entirely', idx), []);
});

test('the chapter\'s concept links: taught, primed, assumed and known, each note once', () => {
	const [mdp, dot, softmax, dp] = NOTES;
	const rows = [
		{ id: 'mdp', name: 'MDP', level: '', why: '', candidates: [mdp!], note: mdp!, known: true, suggested: null },
		{ id: 'dot', name: 'Dot', level: '', why: '', candidates: [dot!], note: dot!, known: false, suggested: null },
		{ id: 'soft', name: 'Softmax', level: '', why: '', candidates: [softmax!], note: softmax!, known: false, suggested: null },
		{ id: 'x', name: 'X', level: '', why: '', candidates: [], note: null, known: false, suggested: null },
	];
	const primed = new Set(['dot']);
	const links = conceptLinks(rows, [dp!, softmax!], primed);
	assert.deepEqual(links, {
		teaches: ['Diffusion Policy', 'Softmax'], primed: ['Dot product'],
		assumed: ['Markov decision process', 'Dot product', 'Softmax'], known: ['Markov decision process'],
	});
});
