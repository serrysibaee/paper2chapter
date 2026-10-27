/*
 * The plugin's settings: their shape, the defaults (which reproduce the 0.1.1 note exactly), the migration of
 * saved settings from older versions, and settings profiles (export and import as JSON). Free of the obsidian
 * module, so it is unit-tested.
 */
import type { Audience } from './types.ts';

export const SETTINGS_VERSION = 3;

export type Layout = 'paper2chapter' | 'textbook' | 'template';
export type PageLinks = 'auto' | 'custom' | 'plain';
export type FiguresMode = 'subfolder' | 'obsidian' | 'folder';
export type OnExists = 'number' | 'skip';
export type PropertiesMode = 'chapter' | 'custom';
export type ExamplesMode = 'inline' | 'gathered';
export type PropertyType = 'text' | 'list' | 'link' | 'links' | 'number' | 'date' | 'checkbox';
export type FlashcardsMode = 'none' | 'spaced-repetition' | 'custom';
export type QueueStatus = 'waiting' | 'running' | 'done' | 'skipped' | 'failed';

/** A paper in the batch: enough to find its PDF again after a restart. */
export interface QueueItem {
	key: string; // the vault path, the path on this computer, or zotero:<item key>
	name: string;
	kind: 'vault' | 'file' | 'zotero';
	absPath?: string;
	zotero?: { itemKey: string };
	meta?: PaperCacheEntry['meta']; // what Zotero knows of the paper
	status: QueueStatus;
	message?: string;
	note?: string; // the chapter note it wrote, or found already there
	added: string; // ISO date
}

export interface PropertyRow {
	key: string;
	value: string;
	type: PropertyType;
}

export interface PaperCacheEntry {
	paperId: string;
	stamp: string;
	// a PDF outside the vault: enough to write its note again later ("Import a chapter generated earlier")
	kind?: 'file' | 'zotero';
	absPath?: string;
	zotero?: { itemKey: string; pdfKey: string };
	meta?: { title?: string; authors?: string[]; year?: string; doi?: string; arxiv?: string };
}

export interface P2CSettings {
	settingsVersion: number;
	// backend
	backendUrl: string;
	backendDir: string;
	pythonPath: string;
	autoStart: boolean;
	// sources
	vaultPdfs: boolean;
	pdfFolders: string; // folders outside the vault, one per line (desktop)
	zotero: boolean;
	zoteroUrl: string;
	paperNoteFolders: string; // one per line; empty: the whole vault
	paperNoteKeys: string; // properties tried in order, one per line; empty: off
	// reader
	audience: Audience;
	includePython: boolean;
	solutions: boolean;
	// output
	outputFolder: string; // a template
	noteName: string; // a template
	figures: FiguresMode;
	attachments: string; // the figures subfolder (figures: subfolder)
	figuresFolder: string; // a fixed folder (figures: folder)
	onExists: OnExists;
	quietHours: string; // "HH:MM-HH:MM", or empty
	openAfter: boolean;
	// format
	layout: Layout;
	templatePath: string;
	pageLinks: PageLinks;
	pageLinkTemplate: string;
	sectionHeading: string; // a template: {{n}}, {{title}}, {{page}}, {{pages}}
	headingLevel: number;
	examples: ExamplesMode;
	// properties
	propertiesMode: PropertiesMode;
	propertyRows: PropertyRow[];
	// prerequisites and concepts
	matchConcepts: boolean;
	conceptFolders: string; // one per line; empty: the whole vault
	conceptFilter: string; // rules, one per line, all of which a concept note holds
	knownRules: string; // rules, one per line, any of which marks a concept note as known
	teachesKey: string;
	prerequisitesKey: string;
	// integrations
	knowledgeOs: boolean;
	noteRelatives: boolean;
	dataview: boolean;
	dataviewSource: string;
	templater: boolean;
	flashcards: FlashcardsMode;
	flashcardTag: string;
	flashcardTemplate: string; // custom: {{question}}, {{answer}}, {{kind}}, {{difficulty}}
	afterCommands: string; // command ids, one per line
	// learning outputs
	manifest: boolean;
	manifestPath: string; // a template
	// state, not settings: PDFs already sent to the backend, the batch, and the one-time notice
	papers: Record<string, PaperCacheEntry>;
	queue: QueueItem[];
	queuePaused: boolean;
	introShown: boolean;
}

/** The 0.1.1 note's frontmatter, as rows: what "Properties: custom" starts from. */
export const CHAPTER_ROWS: PropertyRow[] = [
	{ key: 'title', value: '{{title}}', type: 'text' },
	{ key: 'paper', value: '{{paperTitle}}', type: 'text' },
	{ key: 'authors', value: '{{authors}}', type: 'list' },
	{ key: 'source_pdf', value: '{{pdfLink}}', type: 'link' },
	{ key: 'generated', value: '{{generated}}', type: 'text' },
	{ key: 'generator', value: 'paper2chapter', type: 'text' },
	{ key: 'model', value: '{{provider}}/{{model}}', type: 'text' },
	{ key: 'audience', value: '{{audience}}', type: 'text' },
	{ key: 'paper_id', value: '{{paperId}}', type: 'text' },
	{ key: 'tags', value: 'paper2chapter', type: 'list' },
];

export const DEFAULT_SETTINGS: P2CSettings = {
	settingsVersion: SETTINGS_VERSION,
	backendUrl: 'http://127.0.0.1:8000',
	backendDir: '',
	pythonPath: '',
	autoStart: true,
	vaultPdfs: true,
	pdfFolders: '',
	zotero: false,
	zoteroUrl: 'http://127.0.0.1:23119',
	paperNoteFolders: '',
	paperNoteKeys: '',
	audience: 'undergraduate',
	includePython: true,
	solutions: true,
	outputFolder: 'Paper chapters',
	noteName: '{{paperTitle}}',
	figures: 'subfolder',
	attachments: 'attachments',
	figuresFolder: '',
	onExists: 'number',
	quietHours: '',
	openAfter: true,
	layout: 'paper2chapter',
	templatePath: '',
	pageLinks: 'auto',
	pageLinkTemplate: '',
	sectionHeading: '{{n}}. {{title}}',
	headingLevel: 2,
	examples: 'inline',
	propertiesMode: 'chapter',
	propertyRows: CHAPTER_ROWS.map((r) => ({ ...r })),
	matchConcepts: false,
	conceptFolders: '',
	conceptFilter: '',
	knownRules: '',
	teachesKey: 'teaches',
	prerequisitesKey: 'prerequisites',
	knowledgeOs: false,
	noteRelatives: false,
	dataview: false,
	dataviewSource: '',
	templater: false,
	flashcards: 'none',
	flashcardTag: 'flashcards',
	flashcardTemplate: '{{question}}\n?\n{{answer}}',
	afterCommands: '',
	manifest: false,
	manifestPath: 'Paper chapters/manifests/{{paperSlug}}.json',
	papers: {},
	queue: [],
	queuePaused: false,
	introShown: false,
};

/** The two concept properties a chapter gains when concepts are matched: what it teaches, and what it assumes. */
export function conceptRows(s: P2CSettings): PropertyRow[] {
	return [
		{ key: s.teachesKey, value: '{{concepts}}', type: 'links' },
		{ key: s.prerequisitesKey, value: '{{assumedConcepts}}', type: 'links' },
	];
}

const CHOICES: Partial<Record<keyof P2CSettings, readonly string[]>> = {
	audience: ['high-school', 'undergraduate', 'graduate', 'practitioner'],
	figures: ['subfolder', 'obsidian', 'folder'],
	onExists: ['number', 'skip'],
	layout: ['paper2chapter', 'textbook', 'template'],
	pageLinks: ['auto', 'custom', 'plain'],
	examples: ['inline', 'gathered'],
	propertiesMode: ['chapter', 'custom'],
	flashcards: ['none', 'spaced-repetition', 'custom'],
};
const PROPERTY_TYPES: readonly string[] = ['text', 'list', 'link', 'links', 'number', 'date', 'checkbox'];
const QUEUE_STATUS: readonly string[] = ['waiting', 'running', 'done', 'skipped', 'failed'];

function fresh(): P2CSettings {
	return { ...DEFAULT_SETTINGS, propertyRows: DEFAULT_SETTINGS.propertyRows.map((r) => ({ ...r })), papers: {}, queue: [] };
}

/** The saved batch: items it cannot read are dropped, and a paper that was running when Obsidian closed waits again. */
function cleanQueue(v: unknown): QueueItem[] | null {
	if (!Array.isArray(v)) return null;
	const out: QueueItem[] = [];
	for (const x of v as unknown[]) {
		if (!x || typeof x !== 'object') continue;
		const o = x as Record<string, unknown>;
		if (typeof o.key !== 'string' || typeof o.name !== 'string' || !QUEUE_STATUS.includes(o.status as string)) continue;
		if (!['vault', 'file', 'zotero'].includes(o.kind as string)) continue;
		const item = { ...o } as unknown as QueueItem;
		if (item.status === 'running') item.status = 'waiting';
		out.push(item);
	}
	return out;
}

function cleanRows(v: unknown): PropertyRow[] | null {
	if (!Array.isArray(v)) return null;
	const rows: PropertyRow[] = [];
	for (const r of v as unknown[]) {
		if (!r || typeof r !== 'object') continue;
		const o = r as Record<string, unknown>;
		if (typeof o.key !== 'string' || typeof o.value !== 'string') continue;
		rows.push({ key: o.key, value: o.value, type: PROPERTY_TYPES.includes(o.type as string) ? o.type as PropertyType : 'text' });
	}
	return rows;
}

/**
 * Settings as saved by any version of the plugin, made current: missing keys take their defaults, a value of the
 * wrong type or outside its choices falls back to the default, and unknown keys are dropped.
 */
export function migrate(saved: unknown): P2CSettings {
	const out = fresh();
	if (!saved || typeof saved !== 'object') return out;
	const s = saved as Record<string, unknown>;
	const o = out as unknown as Record<string, unknown>;
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof P2CSettings)[]) {
		const v = s[key];
		if (v === undefined || key === 'settingsVersion') continue;
		if (key === 'propertyRows') {
			const rows = cleanRows(v);
			if (rows) out.propertyRows = rows;
		} else if (key === 'papers') {
			if (v && typeof v === 'object' && !Array.isArray(v)) out.papers = v as Record<string, PaperCacheEntry>;
		} else if (key === 'queue') {
			const q = cleanQueue(v);
			if (q) out.queue = q;
		} else if (typeof v === typeof DEFAULT_SETTINGS[key]) {
			const allowed = CHOICES[key];
			if (!allowed || allowed.includes(v as string)) o[key] = v;
		}
	}
	if (!Number.isInteger(out.headingLevel) || out.headingLevel < 1 || out.headingLevel > 5) out.headingLevel = 2;
	out.settingsVersion = SETTINGS_VERSION;
	return out;
}

/** Keys a profile leaves out: this computer's paths, the cache of PDFs already sent, and this vault's batch. */
export const MACHINE_KEYS: (keyof P2CSettings)[] = ['backendDir', 'pythonPath', 'papers', 'queue', 'queuePaused', 'introShown'];
export const PROFILE_MARK = 'paper2chapter-settings';

export function exportProfile(s: P2CSettings): string {
	const copy: Record<string, unknown> = { profile: PROFILE_MARK };
	for (const [k, v] of Object.entries(s)) {
		if (!MACHINE_KEYS.includes(k as keyof P2CSettings)) copy[k] = v;
	}
	return JSON.stringify(copy, null, '\t') + '\n';
}

/** A profile applied over the current settings; this computer's paths and the cache are kept. */
export function importProfile(text: string, current: P2CSettings): P2CSettings {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('This is not a settings profile: it is not valid JSON.');
	}
	if (!data || typeof data !== 'object' || (data as Record<string, unknown>).profile !== PROFILE_MARK) {
		throw new Error('This is not a paper2chapter settings profile.');
	}
	const next = migrate({ ...(data as Record<string, unknown>) });
	for (const k of MACHINE_KEYS) (next as unknown as Record<string, unknown>)[k] = current[k];
	return next;
}

/** One entry per line, trimmed, empty lines dropped. */
export function lines(text: string): string[] {
	return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * Do these settings write exactly the 0.1.1 note (the backend's export.md, unchanged)? Matching concepts adds two
 * properties, the two integrations add their blocks and flashcards a section; a manifest, commands after writing,
 * Dataview and Templater leave the note as it is.
 */
export function isClassicNote(s: P2CSettings): boolean {
	return s.layout === 'paper2chapter' && s.propertiesMode === 'chapter' && !s.matchConcepts && !s.noteRelatives
		&& !s.knowledgeOs && s.flashcards === 'none';
}
