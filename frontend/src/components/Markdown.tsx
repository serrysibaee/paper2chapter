"use client";

import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { assetUrl, pdfUrl } from "@/lib/api";
import { preprocess, type MarkdownContext } from "@/lib/markdown";

// Our internal link schemes survive; everything else goes through the safe default.
const urlTransform = (url: string) =>
  url.startsWith("cite:") || url.startsWith("figure:") ? url : defaultUrlTransform(url);

export function Markdown({ text, ctx, inline = false }: { text: string; ctx?: MarkdownContext; inline?: boolean }) {
  const source = ctx ? preprocess(text, ctx) : text;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]}
      urlTransform={urlTransform}
      components={{
        // react-markdown treats an explicit `undefined` as an element type, so only add `p` when inline
        ...(inline ? { p: ({ children }: { children?: React.ReactNode }) => <>{children}</> } : {}),
        a: ({ href = "", children }) => {
          if (href === "cite:unresolved")
            return <span className="cite-bad" title="This citation is not in the paper's reference list">[{children}]</span>;
          if (href.startsWith("cite:p") && ctx)
            return <a className="cite" href={pdfUrl(ctx.paperId, Number(href.slice(6)))} target="_blank" rel="noreferrer" title="Open the source PDF at this page">{children}</a>;
          if (href.startsWith("#ref-"))
            return <a className="cite" href={href}>{children}</a>;
          return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
        },
        img: ({ src, alt }) => {
          const s = typeof src === "string" ? src : "";
          if (s.startsWith("figure:") && ctx) {
            const fig = ctx.figures.find((f) => f.id === s.slice(7));
            if (!fig) return null;
            return (
              <span className="figure">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetUrl(ctx.paperId, fig.image_file)} alt={alt ?? fig.caption} loading="lazy" />
                <span className="figcaption">{fig.caption || fig.id} <span className="muted">(paper p.&nbsp;{fig.page})</span></span>
              </span>
            );
          }
          return null; // no external images from model output
        },
      }}
    >
      {source}
    </ReactMarkdown>
  );
}

export const TeX = ({ latex, display = true }: { latex: string; display?: boolean }) => (
  <Markdown text={display ? `$$\n${latex}\n$$` : `$${latex}$`} inline={!display} />
);
