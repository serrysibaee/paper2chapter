/*
 * Tokens: the `{{name}}` values that folder, note-name, heading, page-link and property templates may use. A token
 * may hold one value or several (authors); `{{date:FORMAT}}` formats today's date. A token the template names but
 * the paper has no value for becomes empty; a name that is no token is left as written, so a typo shows.
 * `{{a|b}}` is the first of its tokens that has a value (docs/PLAN-note-settings.md, N15).
 */

export type TokenValue = string | string[] | undefined;
export type Tokens = Record<string, TokenValue>;
export type FormatDate = (format: string) => string;

/** Every token, with what it holds: shown in the settings, and used to check templates. */
export const TOKEN_HELP: Record<string, string> = {
	title: "the chapter's title",
	paperTitle: "the paper's title",
	authors: "the paper's authors",
	firstAuthor: "the first author's family name",
	year: 'the year of the paper',
	field: "the paper's field",
	doi: 'its DOI',
	arxiv: 'its arXiv id',
	zoteroKey: 'its Zotero item key',
	zoteroPdfKey: 'the Zotero key of its PDF (for zotero://open-pdf links)',
	pdf: "the PDF's path (in the vault, or on this computer)",
	pdfLink: 'the PDF in the vault, as a link target',
	paperNote: "the paper's own note, as a link target",
	paperNoteFolder: "the folder of the paper's own note",
	paperSlug: "the paper's title in lower case, with hyphens",
	paperId: "the backend's id for the paper",
	provider: 'the model provider',
	model: 'the model',
	audience: 'the audience',
	generated: 'when the chapter was generated (ISO time)',
	pages: "the paper's pages, 1–N, from its page count",
	pageCount: "the paper's number of pages",
	concepts: 'the concept notes the chapter teaches, as link targets (when concepts are matched)',
	primedConcepts: 'the matched prerequisites the chapter teaches in a primer',
	assumedConcepts: 'every prerequisite matched to a concept note: what the chapter assumes',
	knownConcepts: 'the matched prerequisites you knew',
	'date:FORMAT': "today's date, e.g. {{date:YYYY-MM-DD}}",
};

export const TOKEN_NAMES = Object.keys(TOKEN_HELP).filter((k) => !k.includes(':'));

/** The tokens that hold a list: a section over one with `{{.}}` is written once per value (N13). */
export const LIST_TOKENS: readonly string[] = ['authors', 'concepts', 'primedConcepts', 'assumedConcepts', 'knownConcepts'];

/** `{{name}}`, `{{a|b}}` (the first with a value) and `{{date:FORMAT}}`. */
const TOKEN_RE = /\{\{([A-Za-z]+(?:\|[A-Za-z]+)*)(?::([^}]*))?\}\}/g;
const NAMES_RE = /\{\{[#/^]?([A-Za-z]+(?:\|[A-Za-z]+)*)(?::[^}]*)?\}\}/g;

/** Every name a template uses, in order, once each: tokens, the names of a fallback, sections, pieces, `date`. */
export function tokenNames(template: string): string[] {
	const out: string[] = [];
	for (const m of template.matchAll(NAMES_RE)) for (const n of m[1]!.split('|')) if (!out.includes(n)) out.push(n);
	return out;
}

export function tokenValue(tokens: Tokens, name: string): string[] {
	const v = tokens[name];
	if (v === undefined) return [];
	return (Array.isArray(v) ? v : [v]).filter((x) => x !== '');
}

/** Fill a template's tokens; several values are joined with `join`; `{{a|b}}` takes the first token with a value. */
export function fill(template: string, tokens: Tokens, formatDate: FormatDate, join = ', '): string {
	return template.replace(TOKEN_RE, (whole, group: string, arg: string | undefined) => {
		if (group === 'date') return arg ? formatDate(arg) : formatDate('YYYY-MM-DD');
		const known = group.split('|').filter((n) => n in tokens || TOKEN_NAMES.includes(n));
		if (!known.length) return whole;
		for (const n of known) {
			const vals = tokenValue(tokens, n);
			if (vals.length) return vals.join(join);
		}
		return '';
	});
}

/** Names a template uses that are not tokens (nor in `extra`): shown as a warning. */
export function unknownTokens(template: string, extra: readonly string[] = []): string[] {
	return tokenNames(template).filter((n) => n !== 'date' && !TOKEN_NAMES.includes(n) && !extra.includes(n));
}

export function slug(text: string, max = 60): string {
	return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
}

export function familyName(author: string): string {
	const a = author.replace(/\(.*?\)/g, '').trim();
	if (a.includes(',')) return a.split(',')[0]!.trim();
	const parts = a.split(/\s+/).filter(Boolean);
	return parts[parts.length - 1] ?? '';
}

export interface TokenSources {
	chapterTitle?: string;
	paperTitle?: string;
	authors?: string[];
	year?: string | null;
	field?: string | null;
	doi?: string | null;
	arxiv?: string | null;
	zoteroKey?: string;
	zoteroPdfKey?: string;
	pdf?: string;
	pdfLink?: string;
	paperNote?: { linktext: string; folder: string } | null;
	paperId?: string;
	provider?: string;
	model?: string;
	audience?: string;
	generated?: string;
	pageCount?: number | null;
	concepts?: { teaches: string[]; primed: string[]; assumed: string[]; known: string[] } | null;
}

export function buildTokens(s: TokenSources): Tokens {
	const authors = (s.authors ?? []).filter(Boolean);
	const paperTitle = s.paperTitle ?? '';
	return {
		title: s.chapterTitle ?? paperTitle,
		paperTitle,
		authors,
		firstAuthor: authors[0] ? familyName(authors[0]) : '',
		year: s.year ?? '',
		field: s.field ?? '',
		doi: s.doi ?? '',
		arxiv: s.arxiv ?? '',
		zoteroKey: s.zoteroKey ?? '',
		zoteroPdfKey: s.zoteroPdfKey ?? '',
		pdf: s.pdf ?? '',
		pdfLink: s.pdfLink ?? '',
		paperNote: s.paperNote?.linktext ?? '',
		paperNoteFolder: s.paperNote?.folder ?? '',
		paperSlug: slug(paperTitle),
		paperId: s.paperId ?? '',
		provider: s.provider ?? '',
		model: s.model ?? '',
		audience: s.audience ?? '',
		generated: s.generated ?? '',
		pages: s.pageCount ? (s.pageCount === 1 ? '1' : `1–${s.pageCount}`) : '',
		pageCount: s.pageCount ? String(s.pageCount) : '',
		concepts: s.concepts?.teaches ?? [],
		primedConcepts: s.concepts?.primed ?? [],
		assumedConcepts: s.concepts?.assumed ?? [],
		knownConcepts: s.concepts?.known ?? [],
	};
}
