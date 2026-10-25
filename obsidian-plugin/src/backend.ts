/*
 * Starts the paper2chapter backend (uvicorn) when it is not already running, and stops it when the plugin unloads,
 * but only if the plugin started it. Process spawning is injected so this runs in Node tests.
 */

export interface ChildLike {
	pid?: number;
	exitCode: number | null;
	stdout?: { on(event: 'data', cb: (chunk: unknown) => void): unknown } | null;
	stderr?: { on(event: 'data', cb: (chunk: unknown) => void): unknown } | null;
	on(event: 'exit', cb: (code: number | null) => void): unknown;
	kill(): boolean;
}

export type SpawnFn = (cmd: string, args: string[], opts: { cwd: string; env: Record<string, string | undefined> }) => ChildLike;

export interface BackendSettings {
	backendUrl: string;
	backendDir: string;
	pythonPath: string;
	autoStart: boolean;
}

export interface BackendDeps {
	spawn: SpawnFn;
	health: () => Promise<boolean>;
	exists: (path: string) => boolean;
	platform: string;
	env: Record<string, string | undefined>;
	killTree?: (pid: number) => void;
	sleep?: (ms: number) => Promise<void>;
}

export function localPort(url: string): number | null {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return null;
	}
	if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null;
	return u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
}

function joinPath(platform: string, ...parts: string[]): string {
	const sep = platform === 'win32' ? '\\' : '/';
	return parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, ''))).join(sep);
}

/** The Python to run: the setting, else the backend's own virtualenv, else the one on PATH. */
export function findPython(s: BackendSettings, platform: string, exists: (p: string) => boolean): string {
	if (s.pythonPath.trim()) return s.pythonPath.trim();
	const venv = platform === 'win32'
		? joinPath(platform, s.backendDir, '.venv', 'Scripts', 'python.exe')
		: joinPath(platform, s.backendDir, '.venv', 'bin', 'python');
	if (exists(venv)) return venv;
	return platform === 'win32' ? 'python' : 'python3';
}

export class BackendManager {
	readonly log: string[] = [];
	private child: ChildLike | null = null;
	private deps: BackendDeps;

	constructor(deps: BackendDeps) {
		this.deps = deps;
	}

	get ownsProcess(): boolean {
		return this.child !== null && this.child.exitCode === null;
	}

	private push(line: string): void {
		for (const l of line.split(/\r?\n/)) if (l.trim()) this.log.push(l);
		if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
	}

	/** Make sure the backend answers; start it if allowed. Resolves to what happened. */
	async ensure(s: BackendSettings, timeoutMs = 90_000): Promise<'running' | 'started'> {
		if (await this.deps.health()) return 'running';
		if (!s.autoStart) {
			throw new Error(`The paper2chapter backend is not running at ${s.backendUrl}. Start it, or turn on "Start the backend automatically" in the plugin settings.`);
		}
		const port = localPort(s.backendUrl);
		if (port === null) throw new Error(`Only a local backend can be started by the plugin; ${s.backendUrl} is not on this machine.`);
		if (!s.backendDir.trim() || !this.deps.exists(joinPath(this.deps.platform, s.backendDir, 'app', 'main.py'))) {
			throw new Error('Set "Backend folder" in the plugin settings to the backend/ folder of your paper2chapter checkout.');
		}
		if (!this.ownsProcess) this.start(s, port);
		const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => window.setTimeout(r, ms)));
		const t0 = Date.now();
		while (Date.now() - t0 < timeoutMs) {
			await sleep(700);
			if (await this.deps.health()) return 'started';
			if (this.child && this.child.exitCode !== null) {
				const tail = this.log.slice(-8).join('\n');
				this.child = null;
				throw new Error(`The backend exited while starting.${tail ? '\n' + tail : ''}`);
			}
		}
		throw new Error('The backend did not start within 90 s. See the backend log in the plugin settings.');
	}

	private start(s: BackendSettings, port: number): void {
		const python = findPython(s, this.deps.platform, this.deps.exists);
		const args = ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)];
		this.push(`$ ${python} ${args.join(' ')}`);
		const child = this.deps.spawn(python, args, {
			cwd: s.backendDir,
			env: { ...this.deps.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
		});
		child.stdout?.on('data', (c) => this.push(String(c)));
		child.stderr?.on('data', (c) => this.push(String(c)));
		child.on('exit', (code) => this.push(`backend exited (${code ?? 'signal'})`));
		this.child = child;
	}

	/** Stop the backend if this plugin started it. */
	stop(): void {
		const child = this.child;
		this.child = null;
		if (!child || child.exitCode !== null) return;
		if (child.pid && this.deps.killTree) this.deps.killTree(child.pid);
		else child.kill();
	}
}
