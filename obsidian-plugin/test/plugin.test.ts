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
	settings: { backendUrl: string; outputFolder: string; papers: object };
	ensureBackend(): Promise<string>;
}
const PluginClass = (require('./.build/main.cjs') as { default: new (app: unknown, m: unknown) => Loaded }).default;

const app = { workspace: { getActiveFile: () => null, on: () => ({}) }, vault: { getFiles: () => [] } };

test('the plugin loads, registers its commands, and keeps saved settings', async () => {
	const p = new PluginClass(app, { id: 'paper2chapter' });
	p.data = { outputFolder: 'Reading/Chapters' };
	await p.onload();
	assert.deepEqual(p.commands.map((c) => c.id).sort(), [
		'generate-from-active-pdf', 'generate-from-pdf', 'import-chapter', 'start-backend', 'stop-backend',
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
