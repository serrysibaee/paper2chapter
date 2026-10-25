import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackendManager, findPython, localPort, type BackendDeps, type ChildLike } from '../src/backend.ts';
import { noSleep } from './helpers.ts';

class FakeChild implements ChildLike {
	pid = 4242;
	exitCode: number | null = null;
	killed = false;
	private exits: ((c: number | null) => void)[] = [];
	private outs: ((c: unknown) => void)[] = [];
	stdout = { on: (_e: 'data', cb: (c: unknown) => void) => this.outs.push(cb) };
	stderr = { on: (_e: 'data', cb: (c: unknown) => void) => this.outs.push(cb) };
	on(_e: 'exit', cb: (c: number | null) => void) { this.exits.push(cb); }
	kill() { this.killed = true; this.exit(null); return true; }
	say(text: string) { for (const cb of this.outs) cb(text); }
	exit(code: number | null) { this.exitCode = code ?? 1; for (const cb of this.exits) cb(code); }
}

const settings = { backendUrl: 'http://127.0.0.1:8123', backendDir: '/code/p2c/backend', pythonPath: '', autoStart: true };

function deps(over: Partial<BackendDeps> & { healthy?: boolean[] } = {}) {
	const healthy = over.healthy ?? [false, true];
	const spawned: { cmd: string; args: string[]; cwd: string; env: Record<string, string | undefined> }[] = [];
	const child = new FakeChild();
	const killed: number[] = [];
	const d: BackendDeps = {
		spawn: (cmd, args, opts) => { spawned.push({ cmd, args, ...opts }); return child; },
		health: async () => healthy.length > 1 ? healthy.shift()! : healthy[0]!,
		exists: (p) => p.endsWith('main.py') || p.includes('.venv'),
		platform: 'linux',
		env: { PATH: '/bin' },
		killTree: (pid) => { killed.push(pid); child.exit(0); },
		sleep: noSleep,
		parentPid: 777,
		...over,
	};
	return { d, spawned, child, killed };
}

test('localPort accepts only this machine', () => {
	assert.equal(localPort('http://127.0.0.1:8123'), 8123);
	assert.equal(localPort('http://localhost'), 80);
	assert.equal(localPort('https://example.com:8000'), null);
	assert.equal(localPort('not a url'), null);
});

test('findPython prefers the setting, then the backend venv, then PATH', () => {
	assert.equal(findPython({ ...settings, pythonPath: ' /usr/bin/python3.12 ' }, 'linux', () => true), '/usr/bin/python3.12');
	assert.equal(findPython(settings, 'linux', () => true), '/code/p2c/backend/.venv/bin/python');
	assert.equal(findPython({ ...settings, backendDir: 'C:\\p2c\\backend\\' }, 'win32', () => true), 'C:\\p2c\\backend\\.venv\\Scripts\\python.exe');
	assert.equal(findPython(settings, 'win32', () => false), 'python');
});

test('a running backend is used as it is', async () => {
	const { d, spawned } = deps({ healthy: [true] });
	assert.equal(await new BackendManager(d).ensure(settings), 'running');
	assert.equal(spawned.length, 0);
});

test('a stopped backend is started with uvicorn on the configured port, and stopped on unload', async () => {
	const { d, spawned, killed } = deps();
	const m = new BackendManager(d);
	assert.equal(await m.ensure(settings), 'started');
	assert.equal(spawned[0]!.cmd, '/code/p2c/backend/.venv/bin/python');
	assert.deepEqual(spawned[0]!.args, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8123']);
	assert.equal(spawned[0]!.cwd, '/code/p2c/backend');
	assert.equal(spawned[0]!.env.PYTHONUTF8, '1');
	assert.equal(spawned[0]!.env.P2C_PARENT_PID, '777');
	assert.ok(m.ownsProcess);
	m.stop();
	assert.deepEqual(killed, [4242]);
	assert.ok(!m.ownsProcess);
});

test('the plugin never stops a backend it did not start', () => {
	const { d, killed } = deps({ healthy: [true] });
	new BackendManager(d).stop();
	assert.equal(killed.length, 0);
});

test('clear errors: auto-start off, no backend folder, remote URL, early exit', async () => {
	await assert.rejects(new BackendManager(deps().d).ensure({ ...settings, autoStart: false }), /not running at/);
	await assert.rejects(new BackendManager(deps({ exists: () => false }).d).ensure(settings), /Backend folder/);
	await assert.rejects(new BackendManager(deps().d).ensure({ ...settings, backendUrl: 'http://10.0.0.5:8000' }), /Only a local backend/);
	const tick = () => new Promise<void>((r) => setImmediate(r));
	const crash = deps({ healthy: [false], sleep: tick });
	const spawn = crash.d.spawn;
	crash.d.spawn = (cmd, args, opts) => {
		const c = spawn(cmd, args, opts);
		setImmediate(() => { crash.child.say('ModuleNotFoundError: No module named uvicorn\n'); crash.child.exit(1); });
		return c;
	};
	await assert.rejects(new BackendManager(crash.d).ensure(settings), /exited while starting[\s\S]*No module named uvicorn/);
});
