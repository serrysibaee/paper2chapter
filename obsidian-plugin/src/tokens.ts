/*
 * Tokens: the `{{name}}` values that folder, note-name, heading, page-link and property templates may use. A token
 * may hold one value or several (authors); `{{date:FORMAT}}` formats today's date. A token the template names but
 * the paper has no value for becomes empty; a name that is no token is left as written, so a typo shows.
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
	'date:FORMAT': "today's date, e.g. {{date:YYYY-MM-DD}}",
};

export const TOKEN_NAMES = Object.keys(TOKEN_HELP).filter((k) => !k.includes(':'));

const TOKEN_RE = /\{\{([A-Za-z]+)(?::([^}]*))?\}\}/g;

export function tokenValue(tokens: Tokens, name: string): string[] {
	const v = tokens[name];
	if (v === undefined) return [];
	return (Array.isArray(v) ? v : [v]).filter((x) => x !== '');
}

/** Fill a template's tokens; several values are joined with `join`. */
export function fill(template: string, tokens: Tokens, formatDate: FormatDate, join = ', '): string {
	return template.replace(TOKEN_RE, (whole, name: string, arg: string | undefined) => {
		if (name === 'date') return arg ? formatDate(arg) : formatDate('YYYY-MM-DD');
		if (!(name in tokens) && !TOKEN_NAMES.includes(name)) return whole;
		return tokenValue(tokens, name).join(join);
	});
}

/** Names a template uses that are not tokens (nor in `extra`): shown as a warning. */
export function unknownTokens(template: string, extra: readonly string[] = []): string[] {
	const out = new Set<string>();
	for (const m of template.matchAll(/\{\{[#/^]?([A-Za-z]+)(?::[^}]*)?\}\}/g)) {
		const name = m[1]!;
		if (name !== 'date' && !TOKEN_NAMES.includes(name) && !extra.includes(name)) out.add(name);
	}
	return [...out];
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
	};
}
