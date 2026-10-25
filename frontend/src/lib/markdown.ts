import type { Figure, Reference, Table } from "./types";

export interface MarkdownContext {
  paperId: string;
  references: Reference[];
  figures: Figure[];
  tables: Table[];
}

const CITE_RE = /\[@([^\]]+)\]/g;
const PLACEHOLDER_RE = /\{\{(fig|table):([A-Za-z0-9]+)\}\}/g;

/** Strip characters that would break markdown link/image syntax. */
const safeText = (s: string) => s.replace(/[[\]\n]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Turn chapter conventions into plain markdown that react-markdown can render:
 *   [@R12]  -> link to the reference list       ([12](#ref-R12))
 *   [@p4]   -> link to page 4 of the source PDF  ([p. 4](cite:p4))
 *   [@?X]   -> flagged unresolved citation        ([?X](cite:unresolved))
 *   {{fig:F2}} / {{table:T1}} -> image / table markdown with a caption
 */
export function preprocess(md: string, ctx: MarkdownContext): string {
  const refNumber = new Map(ctx.references.map((r, i) => [r.id, r.number ?? i + 1]));
  const figures = new Map(ctx.figures.map((f) => [f.id, f]));
  const tables = new Map(ctx.tables.map((t) => [t.id, t]));

  let out = md.replace(CITE_RE, (_m, body: string) => {
    const parts = body
      .split(/[;,]/)
      .map((k) => k.trim().replace(/^@/, ""))
      .filter(Boolean)
      .map((key) => {
        if (key.startsWith("?")) return `[?${safeText(key.slice(1))}](cite:unresolved)`;
        const page = /^p(\d+)$/.exec(key);
        if (page) return `[p. ${page[1]}](cite:p${page[1]})`;
        const n = refNumber.get(key);
        return n !== undefined ? `[${n}](#ref-${key})` : `[?${safeText(key)}](cite:unresolved)`;
      });
    return `\\[${parts.join(", ")}\\]`;
  });

  out = out.replace(PLACEHOLDER_RE, (_m, kind: string, id: string) => {
    if (kind === "fig") {
      const f = figures.get(id);
      return f ? `\n\n![${safeText(f.caption || id)}](figure:${f.id})\n\n` : "";
    }
    const t = tables.get(id);
    return t ? `\n\n${t.markdown}\n\n*${safeText(t.caption || id)} (paper p. ${t.page})*\n\n` : "";
  });
  return out;
}
