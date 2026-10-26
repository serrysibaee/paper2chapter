/*
 * A chapter note from the backend's parts (`export.parts`) and a template.
 *
 * A template is Markdown with two kinds of `{{…}}`:
 *  - pieces of the chapter (`{{intuition}}`, `{{sections}}`, `{{practice}}`, … see FRAGMENTS), already made inert by
 *    the backend. A piece alone on its line (also after `> `, inside a callout) brings its lines with that line's
 *    prefix; an empty piece removes its line.
 *  - tokens (`{{title}}`, `{{year}}`, `{{date:YYYY-MM-DD}}`, … see tokens.ts), filled in the template's own text only:
 *    never inside a piece, so text from a paper cannot pull in a token.
 * `{{#name}} … {{/name}}` keeps what it encloses only when that piece or token is not empty, on lines of their own
 * or within a line. A template's own frontmatter is not used: a note's properties come from the Properties settings.
 */
import { fill, tokenValue, type FormatDate, type Tokens } from './tokens.ts';
import type { ChapterParts, SectionPart } from './types.ts';

export const FRAGMENT_HELP = {
	about: 'what the chapter is based on, and its model',
	oneLine: "the paper's one-sentence summary",
	newOrSurprising: "the paper's contributions, as a list",
	objectives: 'the learning objectives, as a list',
	intuition: 'the big-picture intuition',
	prerequisites: "the paper's prerequisites, each with whether you knew it",
	primers: 'a primer for each prerequisite you did not know',
	notation: 'the notation table',
	sections: 'the sections, each with its heading',
	workedExamples: 'the worked examples, when they are gathered in one place',
	summary: 'the summary',
	takeaways: 'the key takeaways, as a list',
	misconceptions: 'the common misconceptions, as a list',
	practice: 'the practice problems, solutions folded',
	furtherReading: 'further reading',
	references: "the paper's references",
	warnings: 'notes from the generation, if any',
};
export const FRAGMENTS = Object.keys(FRAGMENT_HELP);

/** Per-section tokens a section heading template may use. */
export const SECTION_TOKENS = ['n', 'page', 'pages'];

export interface FormatOptions {
	headingLevel: number;
	sectionHeading: string;
	examples: 'inline' | 'gathered';
}

const MARK: Record<string, string> = { verified: ' ✅', failed: ' ❌', error: ' ➖', skipped: ' ⏸' };

/** Each line prefixed, trailing spaces trimmed: how the backend quotes a callout. */
export function quote(text: string, prefix = '> '): string {
	return text.split('\n').map((l) => (prefix + l).replace(/\s+$/, '')).join('\n');
}

function callout(kind: string, title: string, body: string): string {
	return quote(`[!${kind}] ${title}`.replace(/\s+$/, '') + '\n' + body);
}

const h = (level: number) => '#'.repeat(Math.max(1, Math.min(6, level)));

function joinParts(parts: string[]): string {
	return parts.filter((x) => x).join('\n\n');
}

/** Inline blocks: `{{#name}}…{{/name}}` within one line. */
function inlineBlocks(text: string, has: (name: string) => boolean): string {
	let prev: string;
	do {
		prev = text;
		text = text.replace(/\{\{#([A-Za-z]+)\}\}([^\n]*?)\{\{\/\1\}\}/g, (_m, name: string, inner: string) => (has(name) ? inner : ''));
	} while (text !== prev);
	return text;
}

export function renderSection(s: SectionPart, opts: FormatOptions, tokens: Tokens, formatDate: FormatDate): string {
	const level = opts.headingLevel;
	const local: Tokens = {
		...tokens, n: String(s.number), title: s.title, page: s.pages[0] !== undefined ? String(s.pages[0]) : '',
		pages: s.pages.map(String),
	};
	const has = (name: string) => tokenValue(local, name).length > 0;
	const heading = fill(inlineBlocks(opts.sectionHeading, has), local, formatDate).trim() || s.title;
	const parts: string[] = [];
	if (s.intuition) parts.push(callout('tip', 'Intuition', s.intuition));
	parts.push(s.body);
	for (const d of s.derivations) parts.push(`${h(level + 1)} Derivation: ${d.title}`, d.md);
	if (opts.examples === 'inline') {
		for (const e of s.worked_examples) parts.push(callout('example', `Worked example: ${e.title}${MARK[e.check ?? ''] ?? ''}`, e.md));
	}
	if (s.check_questions.length) parts.push(`${h(level + 1)} Check your understanding`, ...s.check_questions);
	return `${h(level)} ${heading}` + (joinParts(parts) ? '\n\n' + joinParts(parts) : '');
}

export type Fragments = Record<keyof typeof FRAGMENT_HELP, string>;

/** The pieces a template can place, from the parts and the format settings. */
export function fragments(p: ChapterParts, opts: FormatOptions, tokens: Tokens, formatDate: FormatDate): Fragments {
	const level = opts.headingLevel;
	const prereq = p.prerequisites.map((x) => {
		const why = x.why_needed ? `: ${x.why_needed}` : '';
		const state = x.known ? ' · you know it' : x.primed ? ' · taught in a primer' : '';
		return `- **${x.name}**${x.level ? ` (${x.level})` : ''}${why}${state}`;
	});
	const gathered = opts.examples === 'gathered'
		? p.sections.flatMap((s) => s.worked_examples.map((e) => callout(
			'example', `${e.title}${MARK[e.check ?? ''] ?? ''}`, `*From section ${s.number}, ${s.title}*\n\n${e.md}`)))
		: [];
	return {
		about: p.about,
		oneLine: p.one_line,
		newOrSurprising: p.new_or_surprising,
		objectives: p.objectives,
		intuition: p.intuition,
		prerequisites: prereq.join('\n'),
		primers: joinParts(p.primers.map((x) => `${h(level + 1)} ${x.title}` + (x.md ? '\n\n' + x.md : ''))),
		notation: p.notation,
		sections: joinParts(p.sections.map((s) => renderSection(s, opts, tokens, formatDate))),
		workedExamples: joinParts(gathered),
		summary: p.summary,
		takeaways: p.takeaways,
		misconceptions: p.misconceptions,
		practice: joinParts(p.practice),
		furtherReading: p.further_reading,
		references: p.references,
		warnings: p.warnings,
	};
}

/** A template without its frontmatter, and whether it had one. */
export function stripFrontmatter(template: string): { body: string; had: boolean } {
	const m = template.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
	return m ? { body: template.slice(m[0].length), had: true } : { body: template, had: false };
}

type Item = { text: string; fromTemplate: boolean } | { piece: string; prefix: string };

/** The note's body: the template with its pieces placed and its tokens filled. */
export function renderBody(template: string, p: ChapterParts, opts: FormatOptions, tokens: Tokens, formatDate: FormatDate): string {
	const pieces: Record<string, string> = fragments(p, opts, tokens, formatDate);
	const has = (name: string) => (name in pieces ? pieces[name] !== '' : tokenValue(tokens, name).length > 0);
	const items: Item[] = [];
	const stack: { name: string; keep: boolean }[] = [];
	const keeping = () => stack.every((s) => s.keep);
	const src = stripFrontmatter(template.replace(/\r\n/g, '\n')).body;
	for (const raw of src.split('\n')) {
		const marker = raw.match(/^[ \t]*\{\{([#/])([A-Za-z]+)\}\}[ \t]*$/);
		if (marker) {
			if (marker[1] === '#') stack.push({ name: marker[2]!, keep: keeping() && has(marker[2]!) });
			else if (stack.length && stack[stack.length - 1]!.name === marker[2]) stack.pop();
			continue;
		}
		if (!keeping()) continue;
		const line = inlineBlocks(raw, has);
		const alone = line.match(/^((?:>[ \t]?)*)[ \t]*\{\{([A-Za-z]+)\}\}[ \t]*$/);
		if (alone && alone[2]! in pieces) {
			if (pieces[alone[2]!]) items.push({ piece: pieces[alone[2]!]!, prefix: alone[1]! });
			continue; // an empty piece takes its line with it
		}
		// pieces within a line of text; tokens are filled in the template's own text only
		const text = line.split(/(\{\{[A-Za-z]+\}\})/).map((seg) => {
			const name = seg.match(/^\{\{([A-Za-z]+)\}\}$/)?.[1];
			if (name && name in pieces) return pieces[name]!;
			return fill(seg, tokens, formatDate);
		}).join('');
		items.push({ text, fromTemplate: true });
	}
	// the template's own blank lines: at most one in a row, none at the start or the end
	const out: string[] = [];
	let blank = true;
	for (const it of items) {
		if ('piece' in it) {
			out.push(it.prefix ? quote(it.piece, it.prefix.endsWith(' ') ? it.prefix : it.prefix + ' ') : it.piece);
			blank = false;
		} else if (it.text.trim() === '') {
			if (!blank) out.push('');
			blank = true;
		} else {
			out.push(it.text);
			blank = false;
		}
	}
	while (out.length && out[out.length - 1] === '') out.pop();
	return out.join('\n') + '\n';
}

/** The built-in "Textbook" layout. */
export const TEXTBOOK_TEMPLATE = `# {{title}}

{{#oneLine}}
> [!abstract] The chapter in one line
> {{oneLine}}

{{/oneLine}}
> [!info] About this chapter
> {{about}}

{{#newOrSurprising}}
> [!tip] What the paper adds
> {{newOrSurprising}}

{{/newOrSurprising}}
{{#objectives}}
> [!abstract] Learning objectives
> {{objectives}}

{{/objectives}}
## Intuition first

{{intuition}}

{{#prerequisites}}
## What it assumes

{{prerequisites}}

{{primers}}

{{/prerequisites}}
{{#notation}}
## Notation

{{notation}}

{{/notation}}
{{sections}}

{{#workedExamples}}
## Worked examples

{{workedExamples}}

{{/workedExamples}}
## Summary

{{summary}}

{{#takeaways}}
### Key takeaways

{{takeaways}}

{{/takeaways}}
{{#misconceptions}}
### Common misconceptions

{{misconceptions}}

{{/misconceptions}}
{{#practice}}
## Practice problems

{{practice}}

{{/practice}}
{{#furtherReading}}
## Further reading

{{furtherReading}}

{{/furtherReading}}
{{#references}}
## References (from the paper)

{{references}}

{{/references}}
{{#warnings}}
> [!warning] Generation notes
> {{warnings}}
{{/warnings}}
`;

/** Names a template uses that are neither pieces nor tokens, and blocks left open: shown as warnings. */
export function templateProblems(template: string, tokenNames: readonly string[]): string[] {
	const problems: string[] = [];
	const known = new Set([...FRAGMENTS, ...tokenNames, ...SECTION_TOKENS, 'date']);
	const unknown = new Set<string>();
	for (const m of template.matchAll(/\{\{[#/]?([A-Za-z]+)(?::[^}]*)?\}\}/g)) {
		if (!known.has(m[1]!)) unknown.add(m[1]!);
	}
	if (unknown.size) problems.push(`Unknown names: ${[...unknown].map((n) => `{{${n}}}`).join(', ')}.`);
	const open: string[] = [];
	for (const m of template.matchAll(/\{\{([#/])([A-Za-z]+)\}\}/g)) {
		if (m[1] === '#') open.push(m[2]!);
		else if (open[open.length - 1] === m[2]) open.pop();
		else problems.push(`{{/${m[2]}}} closes a block that is not open.`);
	}
	if (open.length) problems.push(`Not closed: ${open.map((n) => `{{#${n}}}`).join(', ')}.`);
	if (stripFrontmatter(template).had) problems.push("The template's frontmatter is not used: set the note's properties under Properties.");
	return problems;
}
