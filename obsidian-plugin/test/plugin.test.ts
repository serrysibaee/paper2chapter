/* The plugin as Obsidian loads it: bundled, with the `obsidian` module stubbed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import * as stub from './obsidian-stub.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(here + '.build', { recursive: true });
esbuild.buildSync({
	entryPoints: [here + '../src/main.ts'], bundle: true, format: 'cjs', target: 'es2021',
	external: ['obsidian'], outfile: here + '.build/main.cjs', logLevel: 'error',
});
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const load = mod._load;
mod._load = function (request: string, ...rest: unknown[]): unknown {
	return request === 'obsidian' ? stub : load.call(this, request, ...rest);
};
const require = createRequire(import.meta.url);

interface Loaded extends stub.Plugin {
	onload(): Promise<void>;
	onunload(): void;
	settings: { backendUrl: string; outputFolder: string; papers: object; settingsVersion: number; layout: string; headingLevel: number };
	ensureBackend(): Promise<string>;
}

interface Def {
	type?: string; heading?: string; name?: string; items?: Def[];
	control?: { type: string; key: string; validate?: (v: unknown) => string | void | Promise<string | void> };
}
interface Tab {
	getSettingDefinitions(): Def[];
	getControlValue(key: string): unknown;
	setControlValue(key: string, v: unknown): Promise<void>;
}

function walk(defs: Def[], out: Def[] = []): Def[] {
	for (const d of defs) {
		out.push(d);
		if (d.items) walk(d.items, out);
	}
	return out;
}
const PluginClass = (require('./.build/main.cjs') as { default: new (app: unknown, m: unknown) => Loaded }).default;

const app = { workspace: { getActiveFile: () => null, on: () => ({}), onLayoutReady: (f: () => void) => f() }, vault: { getFiles: () => [] } };

test('the plugin loads, registers its commands, and keeps saved settings', async () => {
	const p = new PluginClass(app, { id: 'paper2chapter' });
	p.data = { outputFolder: 'Reading/Chapters' };
	await p.onload();
	assert.deepEqual(p.commands.map((c) => c.id).sort(), [
		'batch-add-folder', 'batch-add-this-pdf', 'batch-add-zotero-collection', 'batch-show',
		'generate-from-active-pdf', 'generate-from-pdf', 'import-chapter', 'preview-note', 'start-backend', 'stop-backend',
	]);
	assert.equal(p.tabs.length, 1);
	assert.equal(p.events.length, 1); // the PDF file menu
	assert.equal(p.settings.outputFolder, 'Reading/Chapters');
	assert.equal(p.settings.backendUrl, 'http://127.0.0.1:8000');
	assert.deepEqual(p.settings.papers, {});
	p.onunload();
});

test('without a running backend, the error says what to set', async () => {
	const p = new PluginClass(app, { id: 'paper2chapter' });
	await p.onload();
	await assert.rejects(p.ensureBackend(), /Backend folder/);
});

test('settings saved by 0.1.1 are migrated on load, and still write the 0.1.1 note', async () => {
	const p = new PluginClass(app, { id: 'paper2chapter' });
	p.data = { outputFolder: 'Reading/Chapters', attachments: 'img', audience: 'graduate' };
	await p.onload();
	assert.equal(p.settings.settingsVersion, 3);
	assert.equal(p.settings.layout, 'paper2chapter');
	assert.equal(p.settings.outputFolder, 'Reading/Chapters');
});

test('every setting in the tab is a real setting, and its checks reject bad values', async () => {
	const p = new PluginClass(app, { id: 'paper2chapter' });
	await p.onload();
	const tab = p.tabs[0] as Tab;
	const defs = walk(tab.getSettingDefinitions());
	const headings = defs.filter((d) => d.heading || d.type === 'page').map((d) => d.heading ?? d.name);
	for (const h of ['Backend', 'Model', 'Sources', 'Prerequisites and concepts', 'Chapters', 'Note format', 'Properties',
		'Integrations', 'Learning outputs', 'Batch', 'Settings profile']) assert.ok(headings.includes(h), h);
	const names = defs.map((d) => d.name);
	for (const n of ['Knowledge OS', 'Note Relatives', 'Dataview', 'Templater', 'Spaced Repetition']) assert.ok(names.includes(n), `a row for ${n}`);
	const controls = defs.filter((d) => d.control).map((d) => d.control!);
	const keys = new Set(Object.keys(p.settings));
	for (const c of controls) assert.ok(keys.has(c.key), `${c.key} is a setting`);
	const bad: Record<string, unknown> = {
		outputFolder: '{{yaer}}', noteName: ' ', quietHours: 'late', pageLinkTemplate: 'zotero://x', pdfFolders: 'relative',
		zoteroUrl: 'localhost', sectionHeading: '{{nope}}', knownRules: 'status mastered', conceptFilter: 'oops',
		teachesKey: 'bad name!', prerequisitesKey: '', manifestPath: '{{slugg}}.json', flashcardTag: 'my cards',
		flashcardTemplate: '{{question}}', afterCommands: 'no:such-command',
	};
	for (const [key, value] of Object.entries(bad)) {
		const c = controls.find((x) => x.key === key);
		const check = c?.validate;
		assert.ok(check, `${key} has a check`);
		assert.ok(await check(value), `${key} rejects ${JSON.stringify(value)}`);
	}
	await tab.setControlValue('headingLevel', '3');
	assert.equal(p.settings.headingLevel, 3, 'a level chosen from a dropdown is kept as a number');
});

test('the optional plugins are named once, in a notice that does not come back', async () => {
	stub.notices.length = 0;
	const p = new PluginClass(app, { id: 'paper2chapter' });
	await p.onload();
	assert.equal(stub.notices.length, 1);
	assert.match(stub.notices[0]!, /Knowledge OS, Note Relatives, Dataview, Templater and Spaced Repetition/);
	assert.match(stub.notices[0]!, /none is needed/);
	const again = new PluginClass(app, { id: 'paper2chapter' });
	again.data = p.data;
	await again.onload();
	assert.equal(stub.notices.length, 1, 'shown once, ever');
});
