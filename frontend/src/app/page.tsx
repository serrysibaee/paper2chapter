"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { PaperRecord } from "@/lib/types";

const STATUS_LABEL: Record<PaperRecord["status"], string> = {
  uploaded: "uploaded",
  extracting: "extracting…",
  extracted: "ready to analyze",
  analyzing: "analyzing…",
  analyzed: "ready to generate",
  generating: "generating…",
  ready: "chapter ready",
  failed: "failed",
};

export default function Library() {
  const router = useRouter();
  const [papers, setPapers] = useState<PaperRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.listPapers().then(setPapers).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please choose a PDF file.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const rec = await api.upload(file);
      router.push(`/papers/${rec.id}`);
    } catch (e) {
      setError((e as Error).message);
      setUploading(false);
    }
  }

  async function remove(p: PaperRecord) {
    if (!confirm(`Delete "${p.title || p.filename}" and its chapter?`)) return;
    try {
      await api.deletePaper(p.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div style={{ maxWidth: "48rem", margin: "0 auto" }}>
      <h1>Turn a research paper into a textbook chapter</h1>
      <p className="muted">
        Upload a paper. We extract its text, figures and references, identify the background you need,
        and write a chapter with intuition, derivations, worked examples and checked exercises.
      </p>

      <div
        className={`dropzone ${drag ? "active" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
      >
        {uploading ? <span><span className="spinner" /> Uploading…</span> : <><strong>Drop a PDF here</strong> or click to choose a file</>}
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </div>
      {error && <div className="alert error">{error}</div>}

      <h2>Library</h2>
      {papers === null && !error && <p className="muted"><span className="spinner" /> Loading…</p>}
      {papers?.length === 0 && <p className="muted">No papers yet.</p>}
      <ul className="paper-list">
        {papers?.map((p) => (
          <li key={p.id}>
            <div>
              <Link href={p.has_chapter ? `/papers/${p.id}/chapter` : `/papers/${p.id}`}>{p.title || p.filename}</Link>
              <div className="muted small">
                {p.page_count ? `${p.page_count} pages · ` : ""}{new Date(p.created_at).toLocaleDateString()}
                {p.usage.cost_usd ? ` · $${p.usage.cost_usd.toFixed(3)} spent` : ""}
              </div>
            </div>
            <div className="row">
              <span className={`status ${p.status}`}>{STATUS_LABEL[p.status]}</span>
              <Link className="btn small ghost" href={`/papers/${p.id}`}>Open</Link>
              <button className="btn small danger" onClick={() => remove(p)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
