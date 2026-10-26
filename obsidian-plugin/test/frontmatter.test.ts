import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTER_ROWS, type PropertyRow } from '../src/config.ts';
import { renderProperties, withoutFrontmatter } from '../src/frontmatter.ts';
import { SAMPLE } from '../src/sample.ts';
import { buildTokens } from '../src/tokens.ts';

const fd = (f: string) => (f === 'YYYY-MM-DD' ? '2026-10-26' : f);

/** A tiny reader for the frontmatter both sides write: key: "value", key: n, and lists of "items". */
function read(yaml: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	let list: string[] | null = null;
	for (const line of yaml.replace(/^---\n|\n---\n$/g, '').split('\n')) {
		const item = line.match(/^ {2}- (.*)$/);
		if (item && list) { list.push(JSON.parse(item[1]!.startsWith('"') ? item[1]! : JSON.stringify(item[1]!)) as string); continue; }
		const m = line.match(/^([^:]+): ?(.*)$/)!;
		if (m[2] === '') { list = []; out[m[1]!] = list; } else { list = null; out[m[1]!] = JSON.parse(m[2]!); }
	}
	return out;
}

test('the 0.1.1 rows give the same properties as the backend\'s note', () => {
	const p = SAMPLE.parts;
	const tokens = buildTokens({ chapterTitle: p.title, paperTitle: p.paper.title, authors: p.paper.authors, paperId: p.paper_id,
		provider: p.provider, model: p.model, audience: p.audience, generated: p.generated_at });
	const ours = renderProperties(CHAPTER_ROWS, tokens, fd);
	const theirs = SAMPLE.markdown.match(/^---\n[\s\S]*?\n---\n/)![0];
	assert.deepEqual(read(ours), read(theirs));
});

test('types: text, list, link, number, date, checkbox; empty rows are left out', () => {
	const rows: PropertyRow[] = [
		{ key: 'title', value: 'Chapter: "{{title}}"', type: 'text' },
		{ key: 'authors', value: '{{authors}}', type: 'list' },
		{ key: 'up', value: '{{paperNote}}', type: 'link' },
		{ key: 'year', value: '{{year}}', type: 'number' },
		{ key: 'created', value: '{{date:YYYY-MM-DD}}', type: 'date' },
		{ key: 'read', value: 'no', type: 'checkbox' },
		{ key: 'doi', value: '{{doi}}', type: 'text' },
		{ key: 'tags', value: 'paper2chapter\n{{field}}', type: 'list' },
		{ key: 'title', value: 'a second title row is ignored', type: 'text' },
	];
	const tokens = buildTokens({ chapterTitle: 'Weights', authors: ['A. One', 'B. Two'], paperNote: { linktext: 'Papers/Card', folder: 'Papers' }, year: '2023', field: 'ml' });
	assert.equal(renderProperties(rows, tokens, fd), [
		'---',
		'title: "Chapter: \\"Weights\\""',
		'authors:', '  - "A. One"', '  - "B. Two"',
		'up: "[[Papers/Card]]"',
		'year: 2023',
		'created: "2026-10-26"',
		'read: false',
		'tags:', '  - "paper2chapter"', '  - "ml"',
		'---', '',
	].join('\n'));
});

test('no rows with a value, no frontmatter; the backend\'s frontmatter comes off cleanly', () => {
	assert.equal(renderProperties([{ key: 'doi', value: '{{doi}}', type: 'text' }], buildTokens({}), fd), '');
	assert.ok(withoutFrontmatter(SAMPLE.markdown).startsWith('\n# '), 'the blank line after the frontmatter stays');
	assert.equal(withoutFrontmatter('# no frontmatter'), '# no frontmatter');
});
