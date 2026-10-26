import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE } from '../src/sample.ts';
import {
	fragments, quote, renderBody, renderSection, stripFrontmatter, templateProblems, TEXTBOOK_TEMPLATE, type FormatOptions,
} from '../src/template.ts';
import { buildTokens, TOKEN_NAMES } from '../src/tokens.ts';
import type { ChapterParts } from '../src/types.ts';

const fd = (f: string) => `<${f}>`;
const OPTS: FormatOptions = { headingLevel: 2, sectionHeading: '{{n}}. {{title}}', examples: 'inline' };
const P = SAMPLE.parts;
const tokens = buildTokens({ chapterTitle: P.title, paperTitle: P.paper.title, authors: P.paper.authors, year: '2020' });

test('a section rebuilt from its pieces is the section the backend writes', () => {
	for (const s of P.sections) {
		assert.equal(renderSection(s, OPTS, tokens, fd), `## ${s.number}. ${s.title}\n\n${s.md}`);
	}
});

test('the default layout\'s pieces are the backend note\'s own text', () => {
	const f = fragments(P, OPTS, tokens, fd);
	for (const s of P.sections) assert.ok(SAMPLE.markdown.includes(`## ${s.number}. ${s.title}\n\n${s.md}`));
	assert.ok(SAMPLE.markdown.includes('## Practice problems\n\n' + f.practice));
	assert.ok(SAMPLE.markdown.includes('## Prerequisites\n\n' + f.primers));
	assert.ok(SAMPLE.markdown.includes('## Notation\n\n' + f.notation));
});

test('heading level, the heading template and gathered examples', () => {
	const s = P.sections[0]!;
	const out = renderSection(s, { headingLevel: 3, sectionHeading: '1.{{n}} {{title}}{{#page}} — p. {{page}}{{/page}}', examples: 'gathered' }, tokens, fd);
	assert.ok(out.startsWith(`### 1.1 ${s.title} — p. ${s.pages[0]}\n\n`));
	assert.ok(out.includes('#### Derivation: ') && out.includes('#### Check your understanding'));
	assert.ok(!out.includes('[!example]'), 'gathered: the examples leave their section');
	const f = fragments(P, { ...OPTS, examples: 'gathered' }, tokens, fd);
	assert.ok(f.workedExamples.includes('[!example]') && f.workedExamples.includes(`*From section 1, ${s.title}*`));
	assert.equal(fragments(P, OPTS, tokens, fd).workedExamples, '');
	const noPage = { ...s, pages: [] };
	assert.ok(renderSection(noPage, { ...OPTS, sectionHeading: '{{title}}{{#page}} — p. {{page}}{{/page}}' }, tokens, fd).startsWith(`## ${s.title}\n`));
});

test('a piece alone on a line brings its lines with the line\'s callout prefix; an empty one takes its line', () => {
	const out = renderBody('# {{title}}\n\n> [!abstract] Objectives\n> {{objectives}}\n\n> [!warning] Notes\n> {{warnings}}\n\nEnd\n', P, OPTS, tokens, fd);
	assert.ok(out.startsWith(`# ${P.title}\n\n> [!abstract] Objectives\n${quote(P.objectives)}\n`));
	assert.ok(out.includes('> [!warning] Notes\n\nEnd'), 'the empty warnings line is gone');
});

test('blocks keep what they enclose only when it is not empty', () => {
	const t = '{{#warnings}}\n## Notes\n\n{{warnings}}\n{{/warnings}}\n{{#summary}}\n## Summary\n\n{{summary}}\n{{/summary}}\nA{{#doi}} doi:{{doi}}{{/doi}} B\n';
	const out = renderBody(t, P, OPTS, tokens, fd);
	assert.ok(!out.includes('## Notes'));
	assert.ok(out.startsWith('## Summary\n\n' + P.summary));
	assert.ok(out.endsWith('\nA B\n'));
	const withDoi = renderBody(t, P, OPTS, { ...tokens, doi: '10.1/x' }, fd);
	assert.ok(withDoi.endsWith('\nA doi:10.1/x B\n'));
});

test('tokens fill the template, never the text of a piece', () => {
	const evil: ChapterParts = { ...P, summary: 'Use {{title}} and {{date:YYYY}} here.' };
	const out = renderBody('# {{title}} ({{year}}, {{date:YYYY-MM-DD}})\n\n{{summary}}\n', evil, OPTS, tokens, fd);
	assert.ok(out.startsWith(`# ${P.title} (2020, <YYYY-MM-DD>)`));
	assert.ok(out.includes('Use {{title}} and {{date:YYYY}} here.'));
});

test('blank lines: at most one in a row, none at either end; a template\'s frontmatter is not used', () => {
	const out = renderBody('---\ntitle: x\n---\n\n\n# T\n\n\n\n{{warnings}}\n\n\n{{summary}}\n\n\n', P, OPTS, tokens, fd);
	assert.ok(out.startsWith('# T\n\n' + P.summary.split('\n')[0]));
	assert.ok(!out.includes('\n\n\n') && out.endsWith('\n') && !out.endsWith('\n\n'));
	assert.deepEqual(stripFrontmatter('---\na: 1\n---\nbody'), { body: 'body', had: true });
});

test('the Textbook layout uses every piece it has and leaves no placeholder', () => {
	const out = renderBody(TEXTBOOK_TEMPLATE, P, OPTS, tokens, fd);
	assert.ok(!/\{\{/.test(out.replace(/```[\s\S]*?```/g, '')));
	for (const h of ['# ', '> [!abstract] The chapter in one line', '> [!info] About this chapter', '## Intuition first',
		'## What it assumes', '## Notation', '## 1. ', '## Summary', '### Key takeaways', '## Practice problems', '## References (from the paper)']) {
		assert.ok(out.includes(h), h);
	}
	assert.ok(!out.includes('Generation notes'), 'no warnings, no callout');
	assert.equal(templateProblems(TEXTBOOK_TEMPLATE, TOKEN_NAMES).length, 0);
});

test('template problems are named', () => {
	const p = templateProblems('---\na: 1\n---\n{{titel}} {{#summary}} {{/oops}}', TOKEN_NAMES);
	assert.ok(p.some((x) => x.includes('{{titel}}')));
	assert.ok(p.some((x) => x.includes('{{/oops}}')));
	assert.ok(p.some((x) => x.includes('{{#summary}}')));
	assert.ok(p.some((x) => x.includes('frontmatter')));
});
