/*
 * The note a vault already keeps for a paper (a literature note, a reference card), found by its properties: the
 * PDF's path, a Zotero key, a DOI, an arXiv id or the title. The keys are tried in the order the reader set; the
 * first that names exactly one note wins, so a title shared by two notes never picks one at random.
 */

export interface NoteMeta {
	path: string; // vault path, with .md
	basename: string;
	frontmatter: Record<string, unknown>;
}

export interface PaperIdentity {
	pdfPath?: string; // vault path, or an absolute path on this computer
	zoteroKey?: string; // the item's key (or its PDF attachment's)
	zoteroKeys?: string[];
	doi?: string | null;
	arxiv?: string | null;
	title?: string;
}

export function normDoi(v: string): string {
	return v.trim().toLowerCase().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/, '').replace(/[.,;]+$/, '');
}

export function normArxiv(v: string): string {
	return v.trim().toLowerCase()
		.replace(/^(https?:\/\/arxiv\.org\/(abs|pdf)\/|arxiv:\s*)/, '')
		.replace(/\.pdf$/, '').replace(/v\d+$/, '');
}

export function normPath(v: string): string {
	let p = v.trim().replace(/^\[\[|\]\]$/g, '').replace(/\|.*$/, '');
	if (/^file:\/\//i.test(p)) {
		p = p.replace(/^file:\/\/\/?/i, '');
		try { p = decodeURIComponent(p); } catch { /* keep as written */ }
	}
	return p.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

export function normTitle(v: string): string {
	return v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function zoteroKeyOf(v: string): string {
	const m = v.match(/(?:items\/|^)([A-Z0-9]{8})(?:[?/#]|$)/);
	return m ? m[1]! : '';
}

function propValues(fm: Record<string, unknown>, key: string): string[] {
	const v = fm[key];
	if (typeof v === 'string' || typeof v === 'number') return [String(v)];
	if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' || typeof x === 'number').map(String);
	return [];
}

function matches(value: string, who: PaperIdentity): boolean {
	if (!value.trim()) return false;
	if (who.doi && normDoi(value) === normDoi(who.doi)) return true;
	if (who.arxiv && normArxiv(value) === normArxiv(who.arxiv)) return true;
	const zk = zoteroKeyOf(value.trim());
	if (zk && [who.zoteroKey, ...(who.zoteroKeys ?? [])].includes(zk)) return true;
	if (who.pdfPath && /\.pdf(\]\])?$/i.test(value.trim()) && normPath(value) === normPath(who.pdfPath)) return true;
	if (who.title && normTitle(value).length >= 8 && normTitle(value) === normTitle(who.title)) return true;
	return false;
}

export function inFolders(path: string, folders: string[]): boolean {
	if (!folders.length) return true;
	return folders.some((f) => {
		const d = f.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
		return d === '' || path === d || path.startsWith(d + '/');
	});
}

/** `file.name` is the note's own name (for vaults that name a paper's note after its title). */
export const NOTE_NAME_KEY = 'file.name';

export function findPaperNote(notes: NoteMeta[], who: PaperIdentity, keys: string[], folders: string[] = []): NoteMeta | null {
	const pool = notes.filter((n) => inFolders(n.path, folders));
	for (const key of keys) {
		const hits = pool.filter((n) => (key === NOTE_NAME_KEY ? [n.basename] : propValues(n.frontmatter, key)).some((v) => matches(v, who)));
		if (hits.length === 1) return hits[0]!;
	}
	return null;
}
