/*
 * Where papers come from besides the vault: folders on this computer, and Zotero through its local API (Zotero 7 and
 * later: Settings → Advanced → "Allow other applications on this computer to communicate with Zotero"). The local
 * API is read-only here: items and their attachments are listed, and a PDF attachment's file is located through
 * `…/items/<key>/file/view/url`, then read from disk. Nothing in Zotero is changed.
 */
import type { Http, HttpResponse } from './api.ts';

export interface PaperMeta {
	title?: string;
	authors?: string[];
	year?: string;
	doi?: string;
	arxiv?: string;
}

export interface ZoteroItem extends PaperMeta {
	key: string;
	title: string;
	itemType: string;
}

export interface ZoteroAttachment {
	key: string;
	title: string;
	linkMode: string;
	stamp: string;
}

export class SourceError extends Error {}

function str(v: unknown): string {
	return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

const ARXIV_RE = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*|10\.48550\/arxiv\.)(\d{4}\.\d{4,5}|[a-z][a-z-]*(?:\.[a-z]{2})?\/\d{7})/i;

export function zoteroItem(raw: unknown): ZoteroItem | null {
	const r = raw as { key?: string; data?: Record<string, unknown> };
	const d = r?.data;
	if (!r?.key || !d) return null;
	const creators = Array.isArray(d.creators) ? (d.creators as Record<string, string>[]) : [];
	const authors = creators
		.filter((c) => !c.creatorType || c.creatorType === 'author')
		.map((c) => (c.name ?? [c.firstName, c.lastName].filter(Boolean).join(' ')).trim())
		.filter(Boolean);
	const date = typeof d.date === 'string' ? d.date : '';
	const doi = typeof d.DOI === 'string' ? d.DOI : '';
	const arxiv = [d.url, d.extra, doi, d.archiveID].filter((x): x is string => typeof x === 'string')
		.map((s) => s.match(ARXIV_RE)?.[1]).find(Boolean) ?? '';
	return {
		key: r.key,
		title: typeof d.title === 'string' ? d.title : '',
		itemType: typeof d.itemType === 'string' ? d.itemType : '',
		authors,
		year: date.match(/\b(1[89]|20)\d{2}\b/)?.[0] ?? '',
		doi,
		arxiv,
	};
}

export class ZoteroClient {
	readonly base: string;
	private http: Http;

	constructor(baseUrl: string, http: Http) {
		this.base = baseUrl.replace(/\/+$/, '');
		this.http = http;
	}

	private async get(path: string): Promise<HttpResponse> {
		let res: HttpResponse;
		try {
			res = await this.http({ url: this.base + path });
		} catch {
			throw new SourceError(`Zotero is not answering at ${this.base}. Is Zotero running?`);
		}
		if (res.status === 403) {
			throw new SourceError("Zotero's local API is off. In Zotero: Settings → Advanced → Allow other applications on this computer to communicate with Zotero.");
		}
		if (res.status >= 400) throw new SourceError(`Zotero answered ${res.status}: ${res.text.slice(0, 200)}`);
		return res;
	}

	/** Is Zotero there, with its local API on? */
	async check(): Promise<string> {
		await this.get('/api/users/0/items/top?limit=1&format=json');
		return 'Zotero answers, and its local API is on.';
	}

	/** Items (not attachments or notes) whose title, creators or year match `q`. */
	async search(q: string, limit = 30): Promise<ZoteroItem[]> {
		// top-level items only; standalone attachments and notes are dropped here rather than by a filter the
		// local API may not take
		const params = new URLSearchParams({ q, qmode: 'titleCreatorYear', limit: String(limit), format: 'json' });
		const res = await this.get(`/api/users/0/items/top?${params.toString()}`);
		const rows = JSON.parse(res.text) as unknown[];
		return rows.map(zoteroItem).filter((x): x is ZoteroItem => !!x && x.itemType !== 'note' && x.itemType !== 'attachment');
	}

	/** The item's first PDF attachment that is a file (stored or linked), or null. */
	async pdf(itemKey: string): Promise<ZoteroAttachment | null> {
		const res = await this.get(`/api/users/0/items/${encodeURIComponent(itemKey)}/children?format=json`);
		for (const raw of JSON.parse(res.text) as { key?: string; version?: number; data?: Record<string, unknown> }[]) {
			const d = raw.data ?? {};
			if (d.itemType !== 'attachment' || d.contentType !== 'application/pdf') continue;
			if (!['imported_file', 'imported_url', 'linked_file'].includes(str(d.linkMode))) continue;
			return {
				key: str(raw.key), title: str(d.title), linkMode: str(d.linkMode),
				stamp: `${str(d.md5)}:${str(d.mtime ?? raw.version)}`,
			};
		}
		return null;
	}

	/** The attachment's file on this computer. */
	async filePath(attachmentKey: string, platform: string): Promise<string> {
		const res = await this.get(`/api/users/0/items/${encodeURIComponent(attachmentKey)}/file/view/url`);
		const url = res.text.trim();
		if (!/^file:\/\//i.test(url)) throw new SourceError(`Zotero gave no file for ${attachmentKey}.`);
		return fileUrlToPath(url, platform);
	}
}

/** What a Zotero picker shows for a query: the items, or one sentence in their place saying why there are none. */
export async function zoteroSuggestions(z: ZoteroClient, query: string): Promise<{ items: ZoteroItem[]; empty: string }> {
	if (query.trim().length < 2) return { items: [], empty: 'Type two letters or more.' };
	try {
		const items = await z.search(query.trim());
		return { items, empty: items.length ? '' : 'No item in Zotero matches.' };
	} catch (e) {
		return { items: [], empty: (e as Error).message };
	}
}

export function fileUrlToPath(url: string, platform: string): string {
	let p = url.replace(/^file:\/\//i, '');
	try { p = decodeURIComponent(p); } catch { /* keep as written */ }
	if (platform === 'win32') {
		p = p.replace(/^\/([A-Za-z]:)/, '$1'); // file:///C:/… → C:/…
		if (!/^[A-Za-z]:/.test(p) && !p.startsWith('//')) p = '//' + p.replace(/^\/+/, ''); // a network share
	}
	return p;
}

/** A `file:///` URL a Markdown link can hold: every segment percent-encoded, brackets and quotes too. */
export function pathToFileUrl(path: string): string {
	const p = path.replace(/\\/g, '/');
	const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
	const drive = p.match(/^([A-Za-z]:)(\/.*)?$/);
	if (drive) return `file:///${drive[1]}${(drive[2] ?? '/').split('/').map(enc).join('/')}`;
	if (p.startsWith('//')) return `file:${p.split('/').map((s, i) => (i < 2 ? s : enc(s))).join('/')}`;
	return `file://${p.split('/').map(enc).join('/')}`;
}

export interface DirEntry {
	name: string;
	dir: boolean;
}

export interface FsLike {
	readdir(dir: string): DirEntry[];
}

/** PDFs under the folders, recursively, hidden folders skipped, at most `max`. */
export function listPdfs(folders: string[], fs: FsLike, max = 20000): string[] {
	const out: string[] = [];
	const walk = (dir: string, depth: number) => {
		if (out.length >= max || depth > 12) return;
		let entries: DirEntry[];
		try {
			entries = fs.readdir(dir);
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name.startsWith('.')) continue;
			const p = `${dir.replace(/[\\/]+$/, '')}/${e.name}`;
			if (e.dir) walk(p, depth + 1);
			else if (/\.pdf$/i.test(e.name) && out.length < max) out.push(p);
		}
	};
	for (const f of folders) walk(f.replace(/\\/g, '/').replace(/(.)\/+$/, '$1'), 0);
	return out.sort((a, b) => a.localeCompare(b));
}
