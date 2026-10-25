"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { JobStatus } from "@/components/JobStatus";
import { Markdown, TeX } from "@/components/Markdown";
import { api, assetUrl, pdfUrl } from "@/lib/api";
import type { AppSettings, Audience, Estimate, ExtractionSummary, PaperAnalysis, PaperRecord } from "@/lib/types";

const RUNNING = new Set(["extracting", "analyzing", "generating"]);

const money = (v: number | null | undefined) =>
  v === null || v === undefined ? "unknown" : v === 0 ? "free" : v < 0.01 ? "< $0.01" : `$${v.toFixed(2)}`;

export default function PaperPage() {
  const { id } = useParams<{ id: string }>();
  const [rec, setRec] = useState<PaperRecord | null>(null);
  const [extraction, setExtraction] = useState<ExtractionSummary | null>(null);
  const [analysis, setAnalysis] = useState<PaperAnalysis | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [known, setKnown] = useState<Set<string>>(new Set());
  const [audience, setAudience] = useState<Audience>("undergraduate");
  const [focus, setFocus] = useState("");
  const [includePython, setIncludePython] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.getPaper(id);
      setRec(r);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [id]);

  // poll while a job runs
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      const r = await refresh();
      if (!stopped && r && RUNNING.has(r.status)) timer = setTimeout(tick, 1500);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [refresh, busy]);

  const status = rec?.status;
  useEffect(() => {
    if (!rec || RUNNING.has(rec.status) || rec.status === "uploaded") return;
    api.extraction(id).then(setExtraction).catch(() => setExtraction(null));
    api.settings().then(setSettings).catch(() => {});
    api.estimate(id).then(setEstimate).catch(() => setEstimate(null));
    if (rec.has_analysis) api.analysis(id).then(setAnalysis).catch(() => {});
  }, [id, status, rec?.has_analysis]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!rec) return error ? <div className="alert error">{error}</div> : <p className="muted"><span className="spinner" /> Loading…</p>;

  const running = RUNNING.has(rec.status);
  const sel = settings?.selection;
  const toggle = (pid: string) => setKnown((s) => { const n = new Set(s); if (n.has(pid)) n.delete(pid); else n.add(pid); return n; });
  const toTeach = analysis ? analysis.prerequisites.filter((p) => !known.has(p.id)).length : 0;

  return (
    <div style={{ maxWidth: "52rem", margin: "0 auto" }}>
      <div className="row between">
        <Link href="/" className="small">← Library</Link>
        <a className="small" href={pdfUrl(id)} target="_blank" rel="noreferrer">Open original PDF</a>
      </div>
      <h1>{analysis?.title || rec.title || rec.filename}</h1>
      {analysis && <p className="muted">{analysis.authors.join(", ")}{analysis.year ? ` · ${analysis.year}` : ""} · {analysis.field}</p>}

      <JobStatus job={rec.job} />
      {error && <div className="alert error">{error}</div>}
      {rec.has_chapter && !running && (
        <div className="alert info row between">
          <span>The chapter is ready.</span>
          <Link className="btn small" href={`/papers/${id}/chapter`}>Read chapter</Link>
        </div>
      )}

      {/* ---------------- step 1: extraction ---------------- */}
      {extraction && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>1. Extracted content</h2>
          <p>
            {extraction.page_count} pages · ~{extraction.text_tokens.toLocaleString()} tokens · {extraction.figures.length} figures ·{" "}
            {extraction.tables.length} tables · {extraction.equations.length} equation regions · {extraction.references.length} references
          </p>
          {extraction.warnings.map((w) => <div key={w} className="alert warn small">{w}</div>)}
          {extraction.figures.length > 0 && (
            <div className="thumbs">
              {extraction.figures.slice(0, 12).map((f) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={f.id} src={assetUrl(id, f.image_file)} alt={f.caption || f.id} title={`${f.id}: ${f.caption}`} />
              ))}
            </div>
          )}
          {!rec.has_analysis && (
            <div className="row" style={{ marginTop: "1rem" }}>
              <button className="btn" disabled={running || busy} onClick={() => act(() => api.analyze(id))}>
                Analyze paper
              </button>
              {sel && <span className="muted small">with {sel.provider} / {sel.model} (<Link href="/settings">change</Link>)</span>}
            </div>
          )}
          {estimate && !rec.has_chapter && (
            <p className="muted small">
              Estimated cost for analysis + one chapter: <strong>{money(estimate.cost_with_cache_usd ?? estimate.cost_usd)}</strong>{" "}
              (~{Math.round(estimate.input_tokens / 1000)}K input, ~{Math.round(estimate.output_tokens / 1000)}K output tokens, ~{estimate.requests} requests).
            </p>
          )}
          {rec.status === "failed" && rec.job?.kind === "extract" && (
            <button className="btn ghost small" onClick={() => act(() => api.reExtract(id))}>Retry extraction</button>
          )}
        </section>
      )}

      {/* ---------------- step 2: analysis + prerequisites ---------------- */}
      {analysis && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>2. What the paper does</h2>
          <p><strong><Markdown text={analysis.one_sentence_summary} inline /></strong></p>
          <div className="grid2">
            <div>
              <h3>Problem</h3>
              <Markdown text={analysis.problem} />
              <h3>Contributions</h3>
              <ul>{analysis.key_contributions.map((c) => <li key={c}><Markdown text={c} inline /></li>)}</ul>
            </div>
            <div>
              <h3>Key equations</h3>
              {analysis.key_equations.slice(0, 6).map((e) => (
                <div key={e.id} style={{ marginBottom: "0.6rem" }}>
                  <TeX latex={e.latex} />
                  <div className="muted small">{e.id}{e.page ? ` (p. ${e.page})` : ""}: {e.meaning}</div>
                </div>
              ))}
            </div>
          </div>

          <h2>3. Your background</h2>
          <p className="muted">
            Tick what you already know. Everything else is taught in short primers before the chapter
            ({toTeach > 6 ? "the first 6 of " : ""}{toTeach} selected for teaching).
          </p>
          {analysis.prerequisites.map((p) => (
            <label key={p.id} className="prereq">
              <input type="checkbox" checked={known.has(p.id)} onChange={() => toggle(p.id)} />
              <span>
                <strong>{p.name}</strong><span className="level">{p.level}</span>
                <div className="muted small">{p.why_needed}</div>
              </span>
            </label>
          ))}

          <div className="grid2" style={{ marginTop: "1rem" }}>
            <label>
              <div className="small muted">Reader level</div>
              <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
                <option value="high-school">High school</option>
                <option value="undergraduate">Undergraduate</option>
                <option value="graduate">Graduate</option>
                <option value="practitioner">Practitioner / engineer</option>
              </select>
            </label>
            <label>
              <div className="small muted">Focus (optional)</div>
              <input className="input" style={{ width: "100%" }} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. emphasise the training objective" maxLength={300} />
            </label>
          </div>
          <label className="row small">
            <input type="checkbox" checked={includePython} onChange={(e) => setIncludePython(e.target.checked)} />
            Include Python programming exercises
          </label>
          <div className="row">
            <button
              className="btn"
              disabled={running || busy}
              onClick={() => act(() => api.generate(id, { audience, known_prerequisites: [...known], focus, include_python: includePython }))}
            >
              {rec.has_chapter ? "Regenerate chapter" : "Generate chapter"}
            </button>
            {sel && <span className="muted small">with {sel.provider} / {sel.model}</span>}
          </div>
        </section>
      )}

      {rec.usage.calls > 0 && (
        <p className="muted small">
          LLM usage so far: {rec.usage.calls} requests, {rec.usage.input_tokens.toLocaleString()} input +{" "}
          {rec.usage.cache_read_tokens.toLocaleString()} cached + {rec.usage.output_tokens.toLocaleString()} output tokens
          {rec.usage.cost_usd !== null ? ` · estimated ${money(rec.usage.cost_usd)}` : ""}.
        </p>
      )}
      {rec.job && rec.job.log.length > 0 && (
        <details className="small muted">
          <summary>Job log</summary>
          <pre>{rec.job.log.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}
