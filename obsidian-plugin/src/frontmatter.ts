/*
 * A note's properties from rows of key, value template and type. Written as YAML in the note itself (one write, no
 * second pass over the file), every string double-quoted, so a title with a colon or a quote stays one value.
 *
 * A row's value is a template (tokens.ts). A list row gives one item per value of a token with several values, and
 * one per line of its template; a link row wraps each value in [[…]]; a row whose value comes out empty is left out.
 */
import type { PropertyRow } from './config.ts';
import { fill, type FormatDate, type Tokens } from './tokens.ts';

/** A key Obsidian and YAML accept without quoting it. */
export const KEY_RE = /^[A-Za-z_][\w\- .]*$/;

function q(s: string): string {
	return JSON.stringify(s); // a valid YAML double-quoted scalar
}

function asLink(v: string): string {
	return /^\[\[.*\]\]$/.test(v) ? v : `[[${v}]]`;
}

/** The row's values: one per line of its template, a token with several values giving one each. */
function values(row: PropertyRow, tokens: Tokens, formatDate: FormatDate): string[] {
	return row.value.split(/\r?\n/)
		.flatMap((line) => fill(line, tokens, formatDate, '\u0000').split('\u0000'))
		.map((v) => v.trim())
		.filter(Boolean);
}

export function renderProperties(rows: PropertyRow[], tokens: Tokens, formatDate: FormatDate): string {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		const key = row.key.trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		const k = KEY_RE.test(key) ? key : q(key);
		const vals = values(row, tokens, formatDate);
		if (!vals.length) continue;
		switch (row.type) {
			case 'list':
				out.push(`${k}:`, ...vals.map((v) => `  - ${q(v)}`));
				break;
			case 'link':
				if (vals.length === 1) out.push(`${k}: ${q(asLink(vals[0]!))}`);
				else out.push(`${k}:`, ...vals.map((v) => `  - ${q(asLink(v))}`));
				break;
			case 'number': {
				const n = Number(vals.join(' ').replace(/,/g, ''));
				if (Number.isFinite(n)) out.push(`${k}: ${n}`);
				break;
			}
			case 'checkbox':
				out.push(`${k}: ${/^(true|yes|1|on)$/i.test(vals[0]!) ? 'true' : 'false'}`);
				break;
			default: // text, date
				out.push(`${k}: ${q(vals.join(', '))}`);
		}
	}
	return out.length ? `---\n${out.join('\n')}\n---\n` : '';
}

/** A note's text without the frontmatter block it starts with (as the backend writes it). */
export function withoutFrontmatter(markdown: string): string {
	const m = markdown.match(/^---\n[\s\S]*?\n---\n/);
	return m ? markdown.slice(m[0].length) : markdown;
}
