/*
 * End to end against the real backend: the plugin's BackendManager starts uvicorn from ../backend (mock provider,
 * temporary data folder), and a ChapterRun takes the test suite's sample paper to a note in a vault in memory.
 * Skipped when ../backend/.venv does not exist (create it as the README says).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Paper2ChapterClient, type Http } from '../src/api.ts';
import { BackendManager, findPython } from '../src/backend.ts';
import { ChapterRun, type PaperCacheEntry } from '../src/run.ts';
import { MemoryVault } from './helpers.ts';

const backendDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../backend');
const settings = { backendUrl: 'http://127.0.0.1:18765', backendDir, pythonPath: '', autoStart: true };
const python = findPython(settings, process.platform, existsSync);
const ready = existsSync(join(backendDir, '.venv'));

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 500)));

const http: Http = async (req) => {
	const res = await fetch(req.url, {
		method: req.method ?? 'GET',
		body: req.body,
		headers: req.contentType ? { 'Content-Type': req.contentType } : undefined,
	});
	const buf = await res.arrayBuffer();
	return { status: res.status, text: new TextDecoder().decode(buf), arrayBuffer: buf };
};

test('a PDF becomes a chapter note through the real backend', { skip: !ready && 'backend/.venv missing', timeout: 240_000 }, async () => {
	const data = mkdtempSync(join(tmpdir(), 'p2c-e2e-'));
	const pdfPath = join(data, 'sample.pdf');
	const made = spawnSync(python, ['-c', `import sys; sys.path.insert(0, 'tests'); from conftest import make_sample_pdf; from pathlib import Path; make_sample_pdf(Path(sys.argv[1]))`, pdfPath], { cwd: backendDir, env: { ...process.env, DATA_DIR: data } });
	assert.equal(made.status, 0, String(made.stderr));

	const client = new Paper2ChapterClient(settings.backendUrl, http);
	const backend = new BackendManager({
		spawn: (cmd, args, opts) => spawn(cmd, args, { cwd: opts.cwd, env: opts.env, windowsHide: true }),
		health: () => client.health(),
		exists: existsSync,
		platform: process.platform,
		env: { ...process.env, LLM_PROVIDER: 'mock', LLM_MODEL: 'mock', DATA_DIR: join(data, 'store'), SANDBOX_BACKEND: 'subprocess' },
		sleep,
		killTree: (pid) => {
			if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)]);
			else process.kill(pid);
		},
	});
	try {
		assert.equal(await backend.ensure(settings), 'started');
		const vault = new MemoryVault();
		const pdf = { path: 'Papers/sample.pdf', name: 'sample.pdf', stamp: '1', read: async () => new Uint8Array(readFileSync(pdfPath)).buffer };
		const cache = new Map<string, PaperCacheEntry>();
		const run = new ChapterRun(client, vault, pdf, { get: (p) => cache.get(p), set: async (p, e) => { cache.set(p, e); } }, sleep);
		const analysis = await run.prepare(() => {});
		assert.ok(analysis.prerequisites.length > 0);
		const res = await run.generate(
			{ audience: 'undergraduate', known_prerequisites: [analysis.prerequisites[0]!.id], focus: '', include_python: true },
			{ folder: 'Paper chapters', attachments: 'attachments', solutions: true }, () => {},
		);
		const md = vault.text(res.notePath);
		assert.ok(md.startsWith('---\ntitle: '));
		assert.ok(md.includes('source_pdf: "[[Papers/sample.pdf]]"'));
		assert.ok(md.includes('> [!question]') && md.includes('[!success]- Solution'));
		assert.equal(res.assetPaths.length, 1);
		const embed = res.assetPaths[0]!.split('/').pop()!;
		assert.ok(md.includes(`![[${embed}]]`), embed);
		assert.ok(vault.files.get(res.assetPaths[0]!) instanceof ArrayBuffer);
	} finally {
		backend.stop();
	}
});
