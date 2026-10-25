import type {
  AppSettings, Chapter, Estimate, ExtractionSummary, GenerationOptions, PaperAnalysis, PaperRecord,
  ProviderCheck,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init });
  } catch {
    throw new ApiError(0, `Cannot reach the backend at ${API_URL}. Is it running?`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  listPapers: () => request<PaperRecord[]>("/api/papers"),
  getPaper: (id: string) => request<PaperRecord>(`/api/papers/${id}`),
  deletePaper: (id: string) => request<{ ok: boolean }>(`/api/papers/${id}`, { method: "DELETE" }),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<PaperRecord>("/api/papers", { method: "POST", body: form });
  },
  extraction: (id: string) => request<ExtractionSummary>(`/api/papers/${id}/extraction`),
  reExtract: (id: string) => request<PaperRecord>(`/api/papers/${id}/extract`, { method: "POST" }),
  analyze: (id: string) => request<PaperRecord>(`/api/papers/${id}/analyze`, { method: "POST" }),
  analysis: (id: string) => request<PaperAnalysis>(`/api/papers/${id}/analysis`),
  estimate: (id: string) => request<Estimate>(`/api/papers/${id}/estimate`),
  generate: (id: string, options: GenerationOptions) =>
    request<PaperRecord>(`/api/papers/${id}/generate`, json("POST", options)),
  chapter: (id: string) => request<Chapter>(`/api/papers/${id}/chapter`),
  settings: () => request<AppSettings>("/api/settings"),
  saveSettings: (s: AppSettings["selection"]) => request<AppSettings>("/api/settings", json("PUT", s)),
  checkProvider: (id: string) => request<ProviderCheck>(`/api/providers/${id}/check`),
};

export const assetUrl = (paperId: string, file: string) => `${API_URL}/api/papers/${paperId}/assets/${file}`;
export const pdfUrl = (paperId: string, page?: number) =>
  `${API_URL}/api/papers/${paperId}/pdf${page ? `#page=${page}` : ""}`;
export const exportUrl = (paperId: string, solutions = true) =>
  `${API_URL}/api/papers/${paperId}/export.html?solutions=${solutions}`;
