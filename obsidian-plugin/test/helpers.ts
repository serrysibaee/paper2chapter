/* Test doubles: an in-memory vault and a scripted HTTP transport. */
import type { Http, HttpRequest, HttpResponse } from '../src/api.ts';
import type { VaultLike } from '../src/writer.ts';

export class MemoryVault implements VaultLike {
	folders = new Set<string>();
	files = new Map<string, string | ArrayBuffer>();
	async exists(path: string): Promise<boolean> {
		return this.folders.has(path) || this.files.has(path);
	}
	async createFolder(path: string): Promise<void> {
		if (this.folders.has(path)) throw new Error('Folder already exists.');
		this.folders.add(path);
	}
	async createText(path: string, text: string): Promise<void> {
		if (this.files.has(path)) throw new Error('File already exists.');
		this.files.set(path, text);
	}
	async createBinary(path: string, data: ArrayBuffer): Promise<void> {
		if (this.files.has(path)) throw new Error('File already exists.');
		this.files.set(path, data);
	}
	text(path: string): string {
		const v = this.files.get(path);
		if (typeof v !== 'string') throw new Error(`no text file ${path}`);
		return v;
	}
}

export function response(status: number, body: unknown): HttpResponse {
	const text = typeof body === 'string' ? body : JSON.stringify(body);
	return { status, text, arrayBuffer: new TextEncoder().encode(text).buffer };
}

export type Route = (req: HttpRequest, url: URL) => HttpResponse | Promise<HttpResponse> | undefined;

/** An Http that answers from routes and records every request. */
export function scripted(routes: Route[]): Http & { calls: HttpRequest[] } {
	const calls: HttpRequest[] = [];
	const http = (async (req: HttpRequest) => {
		calls.push(req);
		const url = new URL(req.url);
		for (const r of routes) {
			const res = await r(req, url);
			if (res) return res;
		}
		return response(404, { detail: 'Not found' });
	}) as Http & { calls: HttpRequest[] };
	http.calls = calls;
	return http;
}

export const noSleep = async (): Promise<void> => {};
