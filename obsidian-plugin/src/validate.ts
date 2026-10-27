/*
 * Checks for what a reader types in the settings. Each returns '' when the value is fine, else one sentence to show
 * beside the setting. The settings tab shows them as the value is typed; the writer runs them again before use.
 */
import { parseRules } from './concepts.ts';
import type { PropertyRow } from './config.ts';
import { KEY_RE } from './frontmatter.ts';
import { parseQuiet } from './output.ts';
import { SECTION_TOKENS, templateProblems } from './template.ts';
import { TOKEN_NAMES, unknownTokens } from './tokens.ts';

/** The backend's rule for `page_link` (app/main.py), after the tokens are filled. */
const PAGE_LINK_RE = /^(?:zotero|file|https?|obsidian):\/\/[^\s()<>[\]{}|"'`\\]+$/;

export function checkFolderTemplate(t: string): string {
	const bad = unknownTokens(t);
	if (bad.length) return `Unknown tokens: ${bad.map((n) => `{{${n}}}`).join(', ')}.`;
	if (/(^|\/)\.\.(\/|$)/.test(t.replace(/\\/g, '/'))) return 'A folder cannot go above the vault.';
	return '';
}

export function checkNameTemplate(t: string): string {
	if (!t.trim()) return 'A note needs a name: use {{paperTitle}}, for example.';
	const bad = unknownTokens(t);
	return bad.length ? `Unknown tokens: ${bad.map((n) => `{{${n}}}`).join(', ')}.` : '';
}

export function checkSectionHeading(t: string): string {
	const bad = unknownTokens(t, SECTION_TOKENS);
	return bad.length ? `Unknown tokens: ${bad.map((n) => `{{${n}}}`).join(', ')}.` : '';
}

/** A page-link template before its tokens are filled: `{page}` once, and a URL the backend accepts. */
export function checkPageLinkTemplate(t: string): string {
	if (!t.trim()) return 'Type a URL with {page}, for example zotero://open-pdf/library/items/{{zoteroPdfKey}}?page={page}.';
	if ((t.match(/\{page\}/g) ?? []).length !== 1) return 'Put {page} in the URL exactly once.';
	const bad = unknownTokens(t);
	if (bad.length) return `Unknown tokens: ${bad.map((n) => `{{${n}}}`).join(', ')}.`;
	const sample = t.replace(/\{\{[^}]*\}\}/g, 'X').replace('{page}', '1');
	if (sample.length > 500) return 'At most 500 characters.';
	if (!PAGE_LINK_RE.test(sample)) return 'Use a zotero://, file://, http(s):// or obsidian:// URL, with spaces and brackets percent-encoded.';
	return '';
}

/** A filled page-link URL the backend will accept, or '' to fall back to plain page numbers. */
export function usablePageLink(url: string): string {
	if (!url || (url.match(/\{page\}/g) ?? []).length !== 1 || url.length > 500) return '';
	return PAGE_LINK_RE.test(url.replace('{page}', '1')) ? url : '';
}

export function checkQuietHours(spec: string): string {
	if (!spec.trim()) return '';
	return parseQuiet(spec) ? '' : 'Write two times, for example 23:00-06:00.';
}

export function checkFolders(text: string): string {
	for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
		if (!/^([A-Za-z]:[\\/]|\/|\\\\)/.test(line)) return `Not an absolute path: ${line}`;
	}
	return '';
}

export function checkUrl(url: string): string {
	return /^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(url.trim()) ? '' : 'An address such as http://127.0.0.1:23119.';
}

export function checkRows(rows: PropertyRow[]): string {
	const seen = new Set<string>();
	for (const r of rows) {
		const k = r.key.trim();
		if (!k) return 'Every property needs a name.';
		if (!KEY_RE.test(k)) return `"${k}": a property name is letters, digits, spaces, dots, hyphens and underscores, and starts with a letter.`;
		if (seen.has(k)) return `"${k}" is there twice.`;
		seen.add(k);
		const bad = unknownTokens(r.value);
		if (bad.length) return `"${k}": unknown tokens ${bad.map((n) => `{{${n}}}`).join(', ')}.`;
	}
	return '';
}

export function checkTemplateText(text: string): string {
	return templateProblems(text, TOKEN_NAMES).join(' ');
}

export function checkRulesText(text: string): string {
	return parseRules(text).problems.join(' ');
}

export function checkPropertyName(v: string): string {
	const k = v.trim();
	if (!k) return 'A property needs a name.';
	return KEY_RE.test(k) ? '' : 'A property name is letters, digits, spaces, dots, hyphens and underscores, and starts with a letter.';
}

export function checkManifestPath(t: string): string {
	if (!t.trim()) return 'Type a path for the manifest, for example Paper chapters/manifests/{{paperSlug}}.json.';
	const bad = unknownTokens(t);
	if (bad.length) return `Unknown tokens: ${bad.map((n) => `{{${n}}}`).join(', ')}.`;
	if (/(^|\/)\.\.(\/|$)/.test(t.replace(/\\/g, '/'))) return 'A manifest cannot go above the vault.';
	return '';
}

export function checkFlashcardTag(t: string): string {
	if (!t.trim()) return '';
	return /^#?[^\s#]+$/.test(t.trim()) ? '' : 'A tag has no spaces: flashcards, or flashcards/papers.';
}

export function checkFlashcardTemplate(t: string): string {
	const missing = ['question', 'answer'].filter((n) => !t.includes(`{{${n}}}`));
	return missing.length ? `A card needs ${missing.map((n) => `{{${n}}}`).join(' and ')}.` : '';
}

/** Command ids, one per line, each one Obsidian knows (`known`). */
export function checkCommands(text: string, known: (id: string) => boolean): string {
	const bad = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !known(l));
	if (!bad.length) return '';
	return bad.length === 1 ? `No command with the id ${bad[0]}.` : `No commands with the ids ${bad.join(', ')}.`;
}
