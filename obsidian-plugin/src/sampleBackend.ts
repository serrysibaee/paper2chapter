/*
 * The preview's backend: the bundled sample chapter, answered the way the real backend answers, so the preview is
 * written by exactly the code that writes a real note, into a vault in memory. No model is asked, nothing is written.
 */
import { Paper2ChapterClient, type Http, type HttpResponse } from './api.ts';
import type { P2CSettings } from './config.ts';
import { ChapterRun, type NoteEnv } from './run.ts';
import { SAMPLE } from './sample.ts';
import type { PaperAnalysis } from './types.ts';
import type { VaultLike } from './writer.ts';

const json = (body: unknown): HttpResponse => {
	const text = JSON.stringify(body);
	return { status: 200, text, arrayBuffer: new TextEncoder().encode(text).buffer };
};

export const SAMPLE_ANALYSIS: PaperAnalysis = {
	title: SAMPLE.parts.paper.title,
	authors: SAMPLE.parts.paper.authors,
	year: SAMPLE.parts.paper.year,
	field: SAMPLE.parts.paper.field ?? '',
	one_sentence_summary: SAMPLE.parts.one_line,
	difficulty: 'intermediate',
	prerequisites: [],
};

export const sampleHttp: Http = async (req) => {
	const u = new URL(req.url);
	const prefix = u.searchParams.get('asset_prefix') ?? '';
	const prefixed = (s: string) => SAMPLE.assets.reduce((t, a) => t.split(`![[${a}]]`).join(`![[${prefix}${a}]]`), s);
	if (u.pathname.endsWith('/analysis')) return json(SAMPLE_ANALYSIS);
	if (u.pathname.endsWith('/export.md')) {
		return json({ markdown: prefixed(SAMPLE.markdown), assets: SAMPLE.assets, title: SAMPLE.parts.title, filename: 'sample.md' });
	}
	if (u.pathname.endsWith('/export.parts')) return json(JSON.parse(prefixed(JSON.stringify(SAMPLE.parts))));
	if (u.pathname.includes('/assets/')) return { status: 200, text: '', arrayBuffer: new ArrayBuffer(0) };
	return { status: 404, text: '{"detail":"Not found"}', arrayBuffer: new ArrayBuffer(0) };
};

class MemoryVault implements VaultLike {
	files = new Map<string, string | ArrayBuffer>();
	folders = new Set<string>();
	private real?: (path: string) => boolean;
	constructor(real?: (path: string) => boolean) {
		this.real = real;
	}
	async exists(path: string): Promise<boolean> {
		return this.folders.has(path) || this.files.has(path) || (this.real?.(path) ?? false);
	}
	async createFolder(path: string): Promise<void> { this.folders.add(path); }
	async createText(path: string, text: string): Promise<void> { this.files.set(path, text); }
	async createBinary(path: string, data: ArrayBuffer): Promise<void> { this.files.set(path, data); }
}

export interface Preview {
	notePath: string;
	markdown: string;
	figures: string[];
	skipped: boolean;
}

/** The note these settings write for the sample chapter. `exists` sees the real vault, so a taken name shows. */
export async function previewNote(settings: P2CSettings, env: NoteEnv, exists?: (path: string) => boolean): Promise<Preview> {
	const vault = new MemoryVault(exists);
	const pdf = { path: 'Sample paper.pdf', name: 'Sample paper.pdf', stamp: '', read: async () => new ArrayBuffer(0) };
	const run = new ChapterRun(new Paper2ChapterClient('http://sample', sampleHttp), vault, pdf, { get: () => undefined, set: async () => {} });
	run.paperId = 'sample';
	run.analysis = SAMPLE_ANALYSIS;
	const res = await run.write({
		folder: '', attachments: '', solutions: settings.solutions,
		note: { ...settings, quietHours: '' },
		env: { ...env, wait: async () => {}, attachmentPath: env.attachmentPath ? async (name) => name : undefined },
	}, () => {});
	const text = vault.files.get(res.notePath);
	return { notePath: res.notePath, markdown: typeof text === 'string' ? text : '', figures: res.assetPaths, skipped: !!res.skipped };
}
