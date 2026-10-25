/* A client for the paper2chapter backend. The transport is injected, so the client runs in Node tests too. */
import { buildMultipart } from './multipart.ts';
import type {
	AppSettings, Estimate, GenerationOptions, MarkdownExport, PaperAnalysis, PaperRecord, PaperStatus, ProviderCheck,
	Selection,
} from './types.ts';

export interface HttpRequest {
	url: string;
	method?: string;
	body?: string | ArrayBuffer;
	contentType?: string;
}

export interface HttpResponse {
	status: number;
	text: string;
	arrayBuffer: ArrayBuffer;
}

export type Http = (req: HttpRequest) => Promise<HttpResponse>;

export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export type ProgressFn = (rec: PaperRecord) => void;

export interface WaitOptions {
	onProgress?: ProgressFn;
	signal?: { aborted: boolean };
	intervalMs?: number;
	timeoutMs?: number;
	sleep?: (ms: number) => Promise<void>;
}

const RUNNING: PaperStatus[] = ['uploaded', 'extracting', 'analyzing', 'generating'];

export class Paper2ChapterClient {
	readonly base: string;
	private http: Http;

	constructor(baseUrl: string, http: Http) {
		this.base = baseUrl.replace(/\/+$/, '');
		this.http = http;
	}

	private async call(path: string, init: Omit<HttpRequest, 'url'> = {}): Promise<HttpResponse> {
		let res: HttpResponse;
		try {
			res = await this.http({ url: this.base + path, ...init });
		} catch (e) {
			throw new ApiError(0, `Cannot reach the paper2chapter backend at ${this.base}. Is it running? (${(e as Error).message})`);
		}
		if (res.status >= 400) {
			let detail = `Request failed (${res.status})`;
			try {
				const body = JSON.parse(res.text) as { detail?: unknown };
				if (body.detail !== undefined) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
			} catch {
				if (res.text) detail = res.text.slice(0, 300);
			}
			throw new ApiError(res.status, detail);
		}
		return res;
	}

	private async json<T>(path: string, init: Omit<HttpRequest, 'url'> = {}): Promise<T> {
		const res = await this.call(path, init);
		return JSON.parse(res.text) as T;
	}

	private send<T>(path: string, method: string, body?: unknown): Promise<T> {
		return this.json<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body), contentType: 'application/json' });
	}

	async health(): Promise<boolean> {
		try {
			const res = await this.http({ url: this.base + '/api/health' });
			return res.status === 200;
		} catch {
			return false;
		}
	}

	settings = () => this.json<AppSettings>('/api/settings');
	saveSettings = (s: Selection) => this.send<AppSettings>('/api/settings', 'PUT', s);
	checkProvider = (id: string) => this.json<ProviderCheck>(`/api/providers/${encodeURIComponent(id)}/check`);
	listPapers = () => this.json<PaperRecord[]>('/api/papers');
	paper = (id: string) => this.json<PaperRecord>(`/api/papers/${id}`);
	analyze = (id: string) => this.send<PaperRecord>(`/api/papers/${id}/analyze`, 'POST');
	analysis = (id: string) => this.json<PaperAnalysis>(`/api/papers/${id}/analysis`);
	estimate = (id: string) => this.json<Estimate>(`/api/papers/${id}/estimate`);
	generate = (id: string, options: GenerationOptions) => this.send<PaperRecord>(`/api/papers/${id}/generate`, 'POST', options);

	upload(filename: string, data: ArrayBuffer): Promise<PaperRecord> {
		const mp = buildMultipart('file', filename, data, 'application/pdf');
		return this.json<PaperRecord>('/api/papers', { method: 'POST', body: mp.body, contentType: mp.contentType });
	}

	exportMarkdown(id: string, opts: { solutions: boolean; assetPrefix: string; pdfLink: string }): Promise<MarkdownExport> {
		const q = new URLSearchParams({
			solutions: String(opts.solutions), flavor: 'obsidian', asset_prefix: opts.assetPrefix, pdf_link: opts.pdfLink,
		});
		return this.json<MarkdownExport>(`/api/papers/${id}/export.md?${q.toString()}`);
	}

	async asset(id: string, name: string): Promise<ArrayBuffer> {
		return (await this.call(`/api/papers/${id}/assets/${encodeURIComponent(name)}`)).arrayBuffer;
	}

	/** Poll a paper until its status is one of `want`; a failed job throws its error. */
	async waitFor(id: string, want: PaperStatus[], opts: WaitOptions = {}): Promise<PaperRecord> {
		const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => window.setTimeout(r, ms)));
		const start = Date.now();
		let delay = opts.intervalMs ?? 1000;
		for (;;) {
			if (opts.signal?.aborted) throw new ApiError(0, 'Cancelled.');
			const rec = await this.paper(id);
			opts.onProgress?.(rec);
			if (want.includes(rec.status)) return rec;
			if (rec.status === 'failed' || rec.job?.status === 'failed') {
				throw new ApiError(409, rec.job?.error || `The ${rec.job?.kind ?? ''} step failed.`);
			}
			if (!RUNNING.includes(rec.status) && rec.job?.status !== 'running') {
				throw new ApiError(409, `Unexpected paper status '${rec.status}'.`);
			}
			if (opts.timeoutMs && Date.now() - start > opts.timeoutMs) throw new ApiError(0, 'Timed out waiting for the backend.');
			await sleep(delay);
			delay = Math.min(delay * 1.3, 4000);
		}
	}
}
