"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AppSettings, ModelOption, ProviderCheck, ProviderOption } from "@/lib/types";

const price = (m: ModelOption) =>
  m.tier === "subscription" ? "your plan"
    : m.input_price === null || m.output_price === null ? "-" : m.input_price === 0 && m.output_price === 0 ? "$0" : `$${m.input_price} / $${m.output_price}`;
const chapterCost = (m: ModelOption) => {
  const v = m.typical_chapter_cost_usd;
  if (m.tier === "subscription") return "included";
  return v === null ? "-" : v === 0 ? "free" : v < 0.01 ? "< $0.01" : `~$${v.toFixed(2)}`;
};
const TIER_LABEL = { free: "free", "free-tier": "free tier", paid: "paid", local: "local", subscription: "subscription" } as const;
const notReady = (p: ProviderOption) => (p.kind === "cli" ? "CLI not found" : `set ${p.api_key_env}`);

export default function SettingsPage() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<"low" | "medium" | "high">("medium");
  const [msg, setMsg] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [checks, setChecks] = useState<Record<string, ProviderCheck | "checking">>({});

  async function check(id: string) {
    setChecks((c) => ({ ...c, [id]: "checking" }));
    try {
      const r = await api.checkProvider(id);
      setChecks((c) => ({ ...c, [id]: r }));
    } catch (e) {
      setChecks((c) => ({ ...c, [id]: { installed: null, version: null, signed_in: null, message: (e as Error).message } }));
    }
  }

  useEffect(() => {
    api.settings().then((d) => {
      setS(d);
      setProvider(d.selection.provider);
      setModel(d.selection.model);
      setEffort(d.selection.effort);
    }).catch((e) => setMsg({ kind: "error", text: e.message }));
  }, []);

  if (!s) return msg ? <div className="alert error">{msg.text}</div> : <p className="muted"><span className="spinner" /> Loading…</p>;
  const current = s.providers.find((p) => p.id === provider);

  async function save() {
    try {
      const d = await api.saveSettings({ provider, model, effort });
      setS(d);
      setMsg({ kind: "info", text: `Saved. New jobs will use ${provider} / ${model}.` });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  return (
    <div style={{ maxWidth: "56rem", margin: "0 auto" }}>
      <h1>Model provider</h1>
      <p className="muted">
        API keys are read from environment variables on the backend (see <code>.env.example</code>) and are never stored by the app.
        A Claude or ChatGPT subscription needs no key: sign in once with the Claude Code or Codex CLI on this machine.
        Prices are USD per 1M input / output tokens (researched October 2026; check the provider before budgeting).
        Chapter cost is a rough estimate for a ~15-page paper.
      </p>

      {s.providers.map((p) => (
        <label key={p.id} className={`provider ${provider === p.id ? "selected" : ""}`}>
          <div className="row between">
            <span>
              <input
                type="radio"
                name="provider"
                checked={provider === p.id}
                onChange={() => { setProvider(p.id); setModel(p.models[0]?.id ?? ""); }}
              />{" "}
              <strong>{p.label}</strong>
              {p.supports_pdf && <span className="level">reads PDFs natively</span>}
            </span>
            {p.configured ? <span className="status ready">ready</span> : <span className="status failed">{notReady(p)}</span>}
          </div>
          {p.free_note && <div className="small" style={{ marginTop: "0.3rem" }}>{p.free_note}</div>}
          {p.kind === "cli" && provider === p.id && (
            <div className="row small" style={{ marginTop: "0.3rem" }}>
              <button type="button" className="btn ghost small" onClick={(e) => { e.preventDefault(); check(p.id); }}>Check CLI</button>
              {checks[p.id] === "checking" && <span className="muted"><span className="spinner" /> Checking…</span>}
              {checks[p.id] && checks[p.id] !== "checking" && (() => {
                const c = checks[p.id] as ProviderCheck;
                const ok = c.installed && c.signed_in !== false;
                return <span className={ok ? "muted" : "bad"}>{c.version ? `${c.version}: ` : ""}{c.message}</span>;
              })()}
            </div>
          )}
          {!p.configured && p.setup_hint && <div className="small bad">{p.setup_hint}</div>}
          {p.pricing_note && <div className="small muted">{p.pricing_note}</div>}
          {provider === p.id && (
            <table className="models" style={{ marginTop: "0.6rem" }}>
              <thead><tr><th></th><th>Model</th><th>Tier</th><th>Price in / out</th><th>Per chapter</th><th>Notes</th></tr></thead>
              <tbody>
                {p.models.map((m) => (
                  <tr key={m.id}>
                    <td><input type="radio" name="model" checked={model === m.id} onChange={() => setModel(m.id)} /></td>
                    <td><code>{m.id}</code></td>
                    <td><span className={`tier ${m.tier}`}>{TIER_LABEL[m.tier]}</span></td>
                    <td>{price(m)}</td>
                    <td>{chapterCost(m)}</td>
                    <td className="muted">{m.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </label>
      ))}

      <div className="card">
        <div className="grid2">
          <label>
            <div className="small muted">Model id (pick above or type any id the provider supports)</div>
            <input className="input" style={{ width: "100%" }} value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          <label>
            <div className="small muted">Reasoning effort (for models that support it)</div>
            <select value={effort} onChange={(e) => setEffort(e.target.value as typeof effort)}>
              <option value="low">Low: cheaper, faster</option>
              <option value="medium">Medium (default)</option>
              <option value="high">High: best derivations, more output tokens</option>
            </select>
          </label>
        </div>
        <div className="row">
          <button className="btn" onClick={save} disabled={!model}>Save</button>
          {current && !current.configured && (
            <span className="bad small">
              {current.kind === "cli" ? current.setup_hint : `Set ${current.api_key_env} in the backend environment and restart it.`}
            </span>
          )}
        </div>
        {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}
      </div>

      <h2>Verification</h2>
      <p>
        Server-side Python sandbox: <strong>{s.sandbox.backend}</strong>{" "}
        {s.sandbox.isolated ? "(isolated container)" : s.sandbox.backend === "subprocess"
          ? "- a local subprocess with limits and an import allowlist; fine for single-user local use but not an isolation boundary. Use the Docker sandbox for shared deployments."
          : ""}
      </p>
      <p className="muted small">Learner code in the reader always runs in the browser (Pyodide), never on the server.</p>
    </div>
  );
}
