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
import { fill, LIST_TOKENS, tokenNames as namesIn, tokenValue, type FormatDate, type Tokens } from './tokens.ts';
import type { ChapterParts, SectionPart } from './types.ts';
import { defuse } from './writer.ts';

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
	progress: "the Knowledge OS's live block for the chapter's concepts (Integrations)",
	flashcards: 'the exercises as flashcards (Integrations)',
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

/**
 * Headings in the model's text, moved down so the shallowest is at `minLevel`: a section body's own "## …" would
 * otherwise sit beside the section's heading instead of under it. Code blocks are left alone; levels stop at six.
 */
export function demoteHeadings(md: string, minLevel: number): string {
	const lines = md.split('\n');
	const isHeading: boolean[] = [];
	let fence: string | null = null;
	let shallowest = 7;
	for (const line of lines) {
		const f = line.match(/^\s*(`{3,}|~{3,})/);
		if (fence) {
			if (f && f[1]!.startsWith(fence)) fence = null;
			isHeading.push(false);
			continue;
		}
		if (f) {
			fence = f[1]!;
			isHeading.push(false);
			continue;
		}
		const m = line.match(/^(#{1,6})\s/);
		isHeading.push(!!m);
		if (m) shallowest = Math.min(shallowest, m[1]!.length);
	}
	const shift = shallowest <= 6 ? Math.max(0, minLevel - shallowest) : 0;
	if (!shift) return md;
	return lines.map((l, i) => (isHeading[i] ? l.replace(/^(#{1,6})/, (m) => h(m.length + shift)) : l)).join('\n');
}

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
	parts.push(demoteHeadings(s.body, level + 1));
	for (const d of s.derivations) parts.push(`${h(level + 1)} Derivation: ${d.title}`, demoteHeadings(d.md, level + 2));
	if (opts.examples === 'inline') {
		for (const e of s.worked_examples) parts.push(callout('example', `Worked example: ${e.title}${MARK[e.check ?? ''] ?? ''}`, e.md));
	}
	if (s.check_questions.length) parts.push(`${h(level + 1)} Check your understanding`, ...s.check_questions);
	return `${h(level)} ${heading}` + (joinParts(parts) ? '\n\n' + joinParts(parts) : '');
}

/** Pieces that come from the integrations rather than from the parts. */
export interface ExtraPieces {
	progress?: string;
	flashcards?: string;
}

export type Fragments = Record<Exclude<keyof typeof FRAGMENT_HELP, keyof ExtraPieces>, string>;

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
		// a piece sits under a heading of the section level at most: its own headings go one below
		intuition: demoteHeadings(p.intuition, level + 1),
		prerequisites: prereq.join('\n'),
		primers: joinParts(p.primers.map((x) => `${h(level + 1)} ${x.title}` + (x.md ? '\n\n' + demoteHeadings(x.md, level + 2) : ''))),
		notation: p.notation,
		sections: joinParts(p.sections.map((s) => renderSection(s, opts, tokens, formatDate))),
		workedExamples: joinParts(gathered),
		summary: demoteHeadings(p.summary, level + 1),
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

/** The item of a section over a list (N13). */
const DOT = '{{.}}';
const MARKER = /^[ \t]*\{\{([#/])([A-Za-z]+)\}\}[ \t]*$/;
/**
 * Where a value written for `{{.}}` waits until the line's tokens are filled, so the value is never filled itself: a
 * number between two private-use characters, which no template holds.
 */
const SLOT_MARK = '';
const SLOT = /(\d+)/g;

/** The line of the `{{/name}}` that closes the section opened at `at`, or the end. */
function closing(lines: string[], at: number, name: string): number {
	let depth = 0;
	for (let i = at + 1; i < lines.length; i++) {
		const m = lines[i]!.match(MARKER);
		if (!m || m[2] !== name) continue;
		if (m[1] === '#') depth++;
		else if (depth === 0) return i;
		else depth--;
	}
	return lines.length;
}

/**
 * The note's body: the template with its pieces placed and its tokens filled. Every piece is defused once more as
 * it goes in (the backend made it inert already); the template's own text is left as written, for Templater. A
 * section over a list token whose text uses `{{.}}` is written once per value (N13); any other section shows or
 * hides.
 */
export function renderBody(template: string, p: ChapterParts, opts: FormatOptions, tokens: Tokens, formatDate: FormatDate,
	extra: ExtraPieces = {}): string {
	const raw: Record<string, string> = { ...fragments(p, opts, tokens, formatDate), progress: extra.progress ?? '', flashcards: extra.flashcards ?? '' };
	const pieces = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, defuse(v)]));
	const has = (name: string) => (name in pieces ? pieces[name] !== '' : tokenValue(tokens, name).length > 0);
	const isList = (name: string) => !(name in pieces) && Array.isArray(tokens[name]);
	const values: string[] = [];
	const slot = (v: string) => `${SLOT_MARK}${values.push(v) - 1}${SLOT_MARK}`;
	/** `{{#name}}…{{.}}…{{/name}}` within a line, over a list: its text once per value. */
	const inlineLists = (line: string) => line.replace(/\{\{#([A-Za-z]+)\}\}([^\n]*?)\{\{\/\1\}\}/g, (whole, name: string, inner: string) =>
		(isList(name) && inner.includes(DOT) ? tokenValue(tokens, name).map((v) => inner.split(DOT).join(slot(v))).join('') : whole));
	const items: Item[] = [];

	const walk = (lines: string[], dot: string | null) => {
		const stack: { name: string; keep: boolean }[] = [];
		const keeping = () => stack.every((s) => s.keep);
		for (let i = 0; i < lines.length; i++) {
			const raw = lines[i]!;
			const marker = raw.match(MARKER);
			if (marker) {
				const name = marker[2]!;
				if (marker[1] === '#') {
					if (keeping() && isList(name)) {
						const end = closing(lines, i, name);
						const body = lines.slice(i + 1, end);
						if (body.some((l) => l.includes(DOT))) {
							for (const v of tokenValue(tokens, name)) walk(body, slot(v));
							i = end; // the closing marker is taken with its section
							continue;
						}
					}
					stack.push({ name, keep: keeping() && has(name) });
				} else if (stack.length && stack[stack.length - 1]!.name === name) stack.pop();
				continue;
			}
			if (!keeping()) continue;
			let line = inlineLists(raw);
			if (dot !== null) line = line.split(DOT).join(dot);
			line = inlineBlocks(line, has);
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
			items.push({ text: text.replace(SLOT, (_m, n: string) => values[Number(n)] ?? ''), fromTemplate: true });
		}
	};
	walk(stripFrontmatter(template.replace(/\r\n/g, '\n')).body.split('\n'), null);

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

{{progress}}

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
{{#flashcards}}
## Flashcards

{{flashcards}}

{{/flashcards}}
{{#warnings}}
> [!warning] Generation notes
> {{warnings}}
{{/warnings}}
`;

/** Names a template uses that are neither pieces nor tokens, and blocks left open: shown as warnings. */
export function templateProblems(template: string, tokenNames: readonly string[]): string[] {
	const problems: string[] = [];
	const known = new Set([...FRAGMENTS, ...tokenNames, ...SECTION_TOKENS, 'date']);
	const unknown = namesIn(template).filter((n) => !known.has(n));
	if (unknown.length) problems.push(`Unknown names: ${unknown.map((n) => `{{${n}}}`).join(', ')}.`);
	const open: string[] = [];
	let dotOutside = false;
	for (const m of template.matchAll(/\{\{(?:([#/])([A-Za-z]+)|(\.))\}\}/g)) {
		if (m[3]) {
			if (!LIST_TOKENS.includes(open[open.length - 1] ?? '')) dotOutside = true;
			continue;
		}
		if (m[1] === '#') open.push(m[2]!);
		else if (open[open.length - 1] === m[2]) open.pop();
		else problems.push(`{{/${m[2]}}} closes a block that is not open.`);
	}
	if (open.length) problems.push(`Not closed: ${open.map((n) => `{{#${n}}}`).join(', ')}.`);
	if (dotOutside) problems.push(`{{.}} is filled only inside a section over a list, such as {{#concepts}} … {{/concepts}}: ${LIST_TOKENS.join(', ')}.`);
	if (stripFrontmatter(template).had) problems.push("The template's frontmatter is not used: set the note's properties under Properties.");
	return problems;
}
