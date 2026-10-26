/*
 * Writes a chapter into the vault: one note in the output folder and its figures in an attachments folder beside
 * it (or a fixed folder, or wherever Obsidian puts attachments). Never overwrites: a taken name gets " 2", " 3", ...,
 * or, if the reader chose so, the note is not written at all. The vault is behind a small interface so tests run
 * in Node.
 */

export interface VaultLike {
	exists(path: string): Promise<boolean>;
	createFolder(path: string): Promise<void>;
	createText(path: string, text: string): Promise<void>;
	createBinary(path: string, data: ArrayBuffer): Promise<void>;
}

export interface ChapterFiles {
	markdown: (assetPrefix: string) => Promise<{ markdown: string; assets: string[] }>;
	asset: (name: string) => Promise<ArrayBuffer>;
}

export interface WriteResult {
	notePath: string;
	assetPaths: string[];
	skipped?: boolean; // the name was taken and the reader chose not to write a second note
}

export interface WriteOptions {
	folder: string;
	attachments: string;
	title: string;
	figures?: 'subfolder' | 'obsidian' | 'folder';
	figuresFolder?: string;
	onExists?: 'number' | 'skip';
	/** Obsidian's own choice of path for an attachment (figures: 'obsidian'). */
	attachmentPath?: (filename: string, notePath: string) => Promise<string>;
}

/** A file name Obsidian, Windows, macOS and Linux all accept, and that a wikilink can name. */
export function safeName(title: string, max = 100): string {
	const cleaned = title
		.replace(/[\\/:*?"<>|#^[\]]/g, ' ')
		// eslint-disable-next-line no-control-regex -- control characters are exactly what this strips
		.replace(/[\u0000-\u001f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.replace(/[. ]+$/, '');
	return (cleaned.slice(0, max).trim() || 'Chapter');
}

export function normalizeFolder(folder: string): string {
	return folder.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').trim();
}

function join(folder: string, name: string): string {
	return folder ? `${folder}/${name}` : name;
}

async function ensureFolder(vault: VaultLike, folder: string): Promise<void> {
	if (!folder) return;
	let path = '';
	for (const part of folder.split('/')) {
		path = path ? `${path}/${part}` : part;
		if (!(await vault.exists(path))) await vault.createFolder(path);
	}
}

export async function uniquePath(vault: VaultLike, folder: string, base: string, ext: string): Promise<string> {
	for (let n = 1; n < 1000; n++) {
		const name = n === 1 ? `${base}.${ext}` : `${base} ${n}.${ext}`;
		const path = join(folder, name);
		if (!(await vault.exists(path))) return path;
	}
	throw new Error(`Could not find a free name for ${base}.${ext} in ${folder || 'the vault root'}.`);
}

/** Defuse Templater tags once more on the way in: Templater can run on every file created in the vault. */
export function defuse(text: string): string {
	return text.replace(/<%/g, '<⁠%');
}

export async function writeChapter(vault: VaultLike, files: ChapterFiles, opts: WriteOptions): Promise<WriteResult> {
	const folder = normalizeFolder(opts.folder);
	const base = safeName(opts.title);
	if (opts.onExists === 'skip' && await vault.exists(join(folder, `${base}.md`))) {
		return { notePath: join(folder, `${base}.md`), assetPaths: [], skipped: true };
	}
	await ensureFolder(vault, folder);
	const notePath = await uniquePath(vault, folder, base, 'md');
	const noteBase = notePath.split('/').pop()!.replace(/\.md$/, '');
	// The note's own (unique) name prefixes its figures, so two chapters never share an attachment name.
	// Letters, digits, space, dot, dash, underscore: what the backend accepts as an asset prefix.
	const prefix = safeName(noteBase, 60).replace(/[^\p{L}\p{N}_ .-]/gu, '_') + ' - ';
	const { markdown, assets } = await files.markdown(prefix);

	let text = markdown;
	const mode = opts.figures === 'folder' && !normalizeFolder(opts.figuresFolder ?? '') ? 'subfolder'
		: opts.figures === 'obsidian' && !opts.attachmentPath ? 'subfolder' : opts.figures ?? 'subfolder';
	const attFolder = mode === 'folder' ? normalizeFolder(opts.figuresFolder ?? '')
		: normalizeFolder(join(folder, opts.attachments || 'attachments'));
	const assetPaths: string[] = [];
	if (assets.length && mode !== 'obsidian') await ensureFolder(vault, attFolder);
	for (const name of assets) {
		let path: string;
		if (mode === 'obsidian') {
			path = normalizeFolder(await opts.attachmentPath!(prefix + name, notePath));
			await ensureFolder(vault, path.split('/').slice(0, -1).join('/'));
			const given = path.split('/').pop()!;
			if (given !== prefix + name) text = text.split(`![[${prefix}${name}]]`).join(`![[${given}]]`);
		} else {
			path = join(attFolder, prefix + name);
		}
		if (await vault.exists(path)) continue;
		await vault.createBinary(path, await files.asset(name));
		assetPaths.push(path);
	}
	await vault.createText(notePath, defuse(text));
	return { notePath, assetPaths };
}
