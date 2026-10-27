/*
 * Other plugins paper2chapter can work with. Each is optional and detected: its settings row says whether it is on,
 * installed but turned off, or not installed, what it adds, and where to get it. Nothing is installed for the reader,
 * and another plugin's settings are only read, never written.
 *
 * Two of them, Knowledge OS and Note Relatives, are written by the author of this integration code; they are listed
 * with the same wording as the others (docs/PLAN-note-settings.md, N6).
 *
 * The Knowledge OS is used only through the API its plugin publishes (version 1, docs/OBSIDIAN.md):
 *   app.plugins.plugins['knowledge-os'].api = {
 *     version: 1,
 *     status(names: string[]): Promise<Record<string, { state: string; stands: boolean; note?: string }>>,
 *     open?(action: 'check' | 'teach' | 'place' | 'explore', concept: string): void,
 *   }
 * and its `knowledge-os` code block with `progress`, which draws a chapter's concepts with their live state. Without
 * that API (older versions), nothing is asked of it and no block is written.
 */

export interface PluginInfo {
	installed: boolean;
	enabled: boolean;
	instance?: unknown; // the plugin object, when it is loaded
}
export type PluginLookup = (id: string) => PluginInfo;

export interface IntegrationSpec {
	id: string; // the plugin's id
	name: string;
	adds: string; // what it adds to paper2chapter, in a sentence or two
	needs?: string;
	community: boolean; // in Obsidian's community directory
	repo?: string; // owner/repo, for BRAT
	page: string;
}

export const INTEGRATIONS = {
	knowledgeOs: {
		id: 'knowledge-os', name: 'Knowledge OS',
		adds: 'Decides which prerequisites you know from your learning road, and draws each chapter concept with its live state: passed, mastered, ready or locked, with buttons to check it or be taught it.',
		needs: 'Desktop, Python, and a vault with a learning road.',
		community: false, repo: 'asmbatati/knowledge-os', page: 'https://github.com/asmbatati/knowledge-os',
	},
	noteRelatives: {
		id: 'note-relatives', name: 'Note Relatives',
		adds: 'Shows a chapter\'s paper, what it teaches and what it assumes as links under its title, and the chapter on each concept\'s note.',
		community: false, repo: 'asmbatati/note-relatives', page: 'https://github.com/asmbatati/note-relatives',
	},
	dataview: {
		id: 'dataview', name: 'Dataview',
		adds: 'Lets a Dataview source (a folder, a tag, or both) say which concept notes you know, beside the rules.',
		community: true, page: 'https://github.com/blacksmithgu/obsidian-dataview',
	},
	templater: {
		id: 'templater-obsidian', name: 'Templater',
		adds: 'Runs the Templater tags of your own template note when a chapter is written. Text from the paper and the model is never run.',
		community: true, page: 'https://github.com/SilentVoid13/Templater',
	},
	spacedRepetition: {
		id: 'obsidian-spaced-repetition', name: 'Spaced Repetition',
		adds: 'Reviews the chapter\'s exercises as flashcards, written in its card syntax under the deck tag you choose.',
		community: true, page: 'https://github.com/st3v3nmw/obsidian-spaced-repetition',
	},
} satisfies Record<string, IntegrationSpec>;

export const BRAT_ID = 'obsidian42-brat';

/** Where "Get it" goes: the community page when listed, else BRAT when it is installed, else the project page. */
export function getItUrl(spec: IntegrationSpec, lookup: PluginLookup): string {
	if (spec.community) return `obsidian://show-plugin?id=${encodeURIComponent(spec.id)}`;
	if (spec.repo && lookup(BRAT_ID).enabled) return `obsidian://brat?plugin=${spec.repo}`;
	return spec.page;
}

export interface IntegrationState {
	kind: 'ready' | 'disabled' | 'missing' | 'outdated';
	text: string;
}

export function integrationState(spec: IntegrationSpec, lookup: PluginLookup): IntegrationState {
	const info = lookup(spec.id);
	if (!info.installed) return { kind: 'missing', text: `${spec.name} is not installed.` };
	if (!info.enabled) return { kind: 'disabled', text: `${spec.name} is installed but turned off (Settings → Community plugins).` };
	if (spec.id === INTEGRATIONS.knowledgeOs.id && !kosApi(lookup)) {
		return { kind: 'outdated', text: `This version of ${spec.name} has no API for other plugins yet: it needs 1.1 or later.` };
	}
	return { kind: 'ready', text: `${spec.name} is on.` };
}

// ---------------------------------------------------------------- Knowledge OS

export interface KosApi {
	version: number;
	status(names: string[]): Promise<Record<string, { state: string; stands: boolean; note?: string }>>;
	open?(action: string, concept: string): void;
}

export function kosApi(lookup: PluginLookup): KosApi | null {
	const info = lookup(INTEGRATIONS.knowledgeOs.id);
	if (!info.enabled) return null;
	const api = (info.instance as { api?: Partial<KosApi> } | undefined)?.api;
	if (!api || typeof api.version !== 'number' || api.version < 1 || typeof api.status !== 'function') return null;
	return api as KosApi;
}

/** The live block: the Knowledge OS reads the two properties it names from the note and draws their concepts. */
export function kosBlock(teachesKey: string, prerequisitesKey: string): string {
	return '```knowledge-os\nprogress\n' + `teaches: ${teachesKey}\nassumes: ${prerequisitesKey}\n` + '```';
}

// ---------------------------------------------------------------- Note Relatives

export interface NrSettings {
	blockName?: string;
	parentKey?: string;
	forward?: { key: string }[];
	inverse?: { key: string }[];
}

export function nrSettings(lookup: PluginLookup): NrSettings | null {
	const info = lookup(INTEGRATIONS.noteRelatives.id);
	if (!info.enabled) return null;
	const s = (info.instance as { settings?: NrSettings } | undefined)?.settings;
	return s && typeof s === 'object' ? s : null;
}

export function nrBlock(nr: NrSettings): string {
	const name = (nr.blockName ?? '').trim() || 'nav';
	return '```' + name + '\n```';
}

/** The properties Note Relatives draws nothing for: no forward or inverse row, and not its parent key. */
export function nrMissing(nr: NrSettings, keys: string[]): string[] {
	const drawn = new Set([nr.parentKey ?? 'up', ...(nr.forward ?? []).map((r) => r.key), ...(nr.inverse ?? []).map((r) => r.key)]);
	return [...new Set(keys.filter((k) => k && !drawn.has(k)))];
}

// ---------------------------------------------------------------- blocks in a note

/** Blocks right after the frontmatter, each only once: a template that already has one keeps it. */
export function withBlocks(markdown: string, blocks: string[]): string {
	const m = markdown.match(/^---\n[\s\S]*?\n---\n/);
	const head = m ? m[0] : '';
	const body = markdown.slice(head.length);
	const add = blocks.filter((b) => !body.includes(b.split('\n')[0] + '\n'));
	if (!add.length) return markdown;
	return head + add.join('\n\n') + '\n\n' + body.replace(/^\n+/, '');
}
