"""Standalone HTML export of a chapter.

The file is self-contained except for KaTeX (loaded from a CDN to render math). Figures are
inlined as data URIs, solutions are collapsed in <details> blocks, and the page has a print
stylesheet, so "Print -> Save as PDF" in any browser produces a clean PDF.

Raw HTML in model output is never passed through (markdown-it runs with html=False).
"""

import base64
import html
import re
from pathlib import Path

from markdown_it import MarkdownIt
from mdit_py_plugins.dollarmath import dollarmath_plugin

from .models import Chapter, Exercise, VerificationResult

KATEX = "https://cdn.jsdelivr.net/npm/katex@0.19.0/dist"


def _math_renderer(content: str, options: dict) -> str:
    body = html.escape(content)
    if options.get("display_mode"):
        return f'<div class="math display">\\[{body}\\]</div>'
    return f'<span class="math">\\({body}\\)</span>'


_md = MarkdownIt("commonmark", {"html": False, "linkify": False}).enable("table")
dollarmath_plugin(_md, double_inline=True, renderer=_math_renderer)

_CITE_RE = re.compile(r"\[@([^\]]+)\]")
_PLACEHOLDER_RE = re.compile(r"<p>\s*\{\{(fig|table):([A-Za-z0-9]+)\}\}\s*</p>|\{\{(fig|table):([A-Za-z0-9]+)\}\}")


class _Renderer:
    def __init__(self, chapter: Chapter, assets_dir: Path):
        self.ch = chapter
        self.assets_dir = assets_dir
        self.ref_numbers = {r.id: (r.number or i + 1) for i, r in enumerate(chapter.references)}
        self.figures = {f.id: f for f in chapter.figures}
        self.tables = {t.id: t for t in chapter.tables}

    def md(self, text: str, inline: bool = False) -> str:
        out = _md.renderInline(text) if inline else _md.render(text)
        out = _CITE_RE.sub(self._cite, out)
        return _PLACEHOLDER_RE.sub(self._placeholder, out)

    def _cite(self, m: re.Match) -> str:
        parts = []
        for key in [k.strip().lstrip("@") for k in re.split(r"[;,]", m.group(1)) if k.strip()]:
            if key.startswith("?"):
                parts.append(f'<span class="cite-bad" title="unresolved citation">?{html.escape(key[1:])}</span>')
            elif re.fullmatch(r"p\d+", key):
                parts.append(f"p.&nbsp;{key[1:]}")
            elif key in self.ref_numbers:
                parts.append(f'<a href="#ref-{key}">{self.ref_numbers[key]}</a>')
        return f'<span class="cite">[{", ".join(parts)}]</span>'

    def _placeholder(self, m: re.Match) -> str:
        kind, ident = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        if kind == "fig" and ident in self.figures:
            f = self.figures[ident]
            path = self.assets_dir / f.image_file
            if not path.is_file():
                return ""
            data = base64.b64encode(path.read_bytes()).decode("ascii")
            return (f'<figure><img alt="{html.escape(f.caption)}" src="data:image/png;base64,{data}">'
                    f"<figcaption>{html.escape(f.caption or ident)} (paper p.&nbsp;{f.page})</figcaption></figure>")
        if kind == "table" and ident in self.tables:
            t = self.tables[ident]
            return (f'<figure class="table">{_md.render(t.markdown)}'
                    f"<figcaption>{html.escape(t.caption or ident)} (paper p.&nbsp;{t.page})</figcaption></figure>")
        return ""

    def badge(self, key: str) -> str:
        v: VerificationResult | None = self.ch.verification.get(key)
        if v is None:
            return ""
        label = {"verified": "verified", "failed": "check failed", "error": "not checkable", "skipped": "not run"}[v.status]
        return f'<span class="badge {v.status}" title="{html.escape(v.method)}: {html.escape(v.detail)}">{label}</span>'

    def exercise(self, ex: Exercise) -> str:
        parts = [f'<div class="exercise"><div class="ex-head">{ex.kind.replace("_", " ")} · {ex.difficulty} {self.badge("ex:" + ex.id)}</div>',
                 self.md(ex.prompt_md)]
        if ex.kind == "multiple_choice" and ex.choices:
            parts.append("<ol type='A'>" + "".join(f"<li>{self.md(c, inline=True)}</li>" for c in ex.choices) + "</ol>")
        if ex.kind == "python" and ex.starter_code:
            parts.append(f"<pre><code>{html.escape(ex.starter_code)}</code></pre>")
        sol = [self.md(ex.answer_md), self.md(ex.explanation_md)]
        if ex.kind == "multiple_choice" and ex.correct_choice is not None and 0 <= ex.correct_choice < len(ex.choices):
            sol.insert(0, f"<p><strong>Correct option: {chr(65 + ex.correct_choice)}</strong></p>")
        if ex.kind == "python" and ex.solution_code:
            sol.append(f"<pre><code>{html.escape(ex.solution_code)}</code></pre>")
            if ex.test_code:
                sol.append(f"<p>Tests:</p><pre><code>{html.escape(ex.test_code)}</code></pre>")
        parts.append(f"<details><summary>Solution</summary>{''.join(sol)}</details></div>")
        return "".join(parts)


CSS = """
:root{--fg:#1d2433;--muted:#5b6475;--line:#e3e6ec;--accent:#2f5bd3;--bg:#fff;--soft:#f6f7f9}
body{font:17px/1.65 Georgia,'Times New Roman',serif;color:var(--fg);background:var(--bg);max-width:46rem;margin:0 auto;padding:2rem 1rem 4rem}
h1,h2,h3,h4,.ex-head,.badge,figcaption,nav{font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
h1{font-size:2rem;line-height:1.2}h2{margin-top:2.5rem;border-bottom:1px solid var(--line);padding-bottom:.3rem}
.meta{color:var(--muted);font-size:.95rem}.box{background:var(--soft);border-left:4px solid var(--accent);padding:.6rem 1rem;margin:1rem 0}
.math.display{overflow-x:auto;margin:1rem 0}figure{margin:1.5rem 0;text-align:center}figure img{max-width:100%}
figcaption{font-size:.85rem;color:var(--muted)}table{border-collapse:collapse;margin:0 auto;font-size:.9rem}td,th{border:1px solid var(--line);padding:.25rem .5rem}
pre{background:var(--soft);padding:.75rem;overflow-x:auto;font-size:.85rem}.exercise{border:1px solid var(--line);border-radius:8px;padding:.5rem 1rem;margin:1rem 0}
.ex-head{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.badge{font-size:.7rem;padding:.1rem .4rem;border-radius:4px;margin-left:.4rem;text-transform:none;letter-spacing:0}
.badge.verified{background:#e3f5e8;color:#17663a}.badge.failed{background:#fde8e8;color:#9b1c1c}.badge.error,.badge.skipped{background:#eef0f3;color:#5b6475}
.step{display:grid;grid-template-columns:2rem 1fr;gap:.25rem;margin:.75rem 0}.step-n{font-family:system-ui;color:var(--muted)}
.cite{font-size:.85em}.cite-bad{color:#9b1c1c}.refs li{font-size:.9rem;margin:.3rem 0}
@media print{details{display:block}details>summary{display:none}a{color:inherit;text-decoration:none}.exercise{break-inside:avoid}}
"""


def render_chapter_html(chapter: Chapter, assets_dir: Path, include_solutions: bool = True) -> str:
    r = _Renderer(chapter, assets_dir)
    out: list[str] = []
    a = out.append
    a(f"<h1>{html.escape(chapter.title)}</h1>")
    a(f'<p class="meta">A textbook chapter based on <em>{html.escape(chapter.paper_title)}</em>'
      f"{' by ' + html.escape(', '.join(chapter.paper_authors)) if chapter.paper_authors else ''}. "
      f"Generated with {html.escape(chapter.provider)}/{html.escape(chapter.model)}; verify important details against the paper.</p>")
    a('<div class="box"><strong>Learning objectives</strong><ul>' + "".join(f"<li>{r.md(o, True)}</li>" for o in chapter.learning_objectives) + "</ul></div>")
    a("<h2>Intuition first</h2>" + r.md(chapter.intuition_md))
    if chapter.primers:
        a("<h2>Prerequisites</h2>")
        for p in chapter.primers:
            a(f"<h3>{html.escape(p.title)}</h3>{r.md(p.intuition_md)}{r.md(p.explanation_md)}")
            a("".join(f'<div class="math display">\\[{html.escape(f)}\\]</div>' for f in p.key_formulas_latex))
            a(f"<p><strong>Example.</strong></p>{r.md(p.example_md)}{r.exercise(p.check_question)}")
    if chapter.notation:
        a("<h2>Notation</h2><table>" + "".join(
            f"<tr><td>{r.md('$' + n.symbol_latex + '$', True)}</td><td>{r.md(n.meaning, True)}</td></tr>" for n in chapter.notation) + "</table>")
    for i, s in enumerate(chapter.sections, 1):
        a(f'<h2 id="{s.id}">{i}. {html.escape(s.title)}</h2><div class="box">{r.md(s.intuition_md)}</div>{r.md(s.body_md)}')
        for d, deriv in enumerate(s.derivations):
            a(f"<h3>Derivation: {html.escape(deriv.title)}</h3>{r.md(deriv.goal_md)}")
            for k, step in enumerate(deriv.steps):
                a(f'<div class="step"><div class="step-n">{k + 1}.</div><div>'
                  f'<div class="math display">\\[{html.escape(step.latex)}\\]</div>{r.md(step.explanation_md)}'
                  f'<p class="meta">{html.escape(step.justification)} {r.badge(f"deriv:{s.id}:{d}:{k}")}</p></div></div>')
            a(f'<p><strong>Result:</strong></p><div class="math display">\\[{html.escape(deriv.result_latex)}\\]</div>')
        for e, ex in enumerate(s.worked_examples):
            a(f"<h3>Worked example: {html.escape(ex.title)} {r.badge(f'example:{s.id}:{e}')}</h3>{r.md(ex.problem_md)}<ol>"
              + "".join(f"<li>{r.md(st)}</li>" for st in ex.solution_steps_md) + f"</ol><p><strong>Answer:</strong></p>{r.md(ex.answer_md)}")
        if s.check_questions:
            a("<h3>Check your understanding</h3>" + "".join(r.exercise(q) for q in s.check_questions))
    a("<h2>Summary</h2>" + r.md(chapter.summary_md))
    a("<h3>Key takeaways</h3><ul>" + "".join(f"<li>{r.md(t, True)}</li>" for t in chapter.key_takeaways) + "</ul>")
    if chapter.common_misconceptions:
        a("<h3>Common misconceptions</h3><ul>" + "".join(f"<li>{r.md(t, True)}</li>" for t in chapter.common_misconceptions) + "</ul>")
    a("<h2>Practice problems</h2>" + "".join(r.exercise(q) for q in chapter.practice))
    if chapter.further_reading:
        a("<h2>Further reading</h2><ul>")
        for fr in chapter.further_reading:
            tag = f'<a href="#ref-{fr.ref_id}">[{r.ref_numbers.get(fr.ref_id, "")}]</a>' if fr.ref_id else "<em>(suggested by the model; not from the paper - verify)</em>"
            a(f"<li><strong>{html.escape(fr.title)}</strong>, {html.escape(fr.authors)}{', ' + html.escape(fr.year) if fr.year else ''}. {html.escape(fr.why)} {tag}</li>")
        a("</ul>")
    if chapter.references:
        a('<h2>References (from the paper)</h2><ol class="refs">' + "".join(
            f'<li id="ref-{ref.id}" value="{r.ref_numbers[ref.id]}">{html.escape(ref.text)}</li>' for ref in chapter.references) + "</ol>")
    body = "\n".join(out)
    if not include_solutions:
        body = re.sub(r"<details><summary>Solution</summary>.*?</details>", "", body, flags=re.S)
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(chapter.title)}</title>
<link rel="stylesheet" href="{KATEX}/katex.min.css">
<script defer src="{KATEX}/katex.min.js"></script>
<script defer src="{KATEX}/contrib/auto-render.min.js" onload="renderMathInElement(document.body,{{delimiters:[{{left:'\\\\[',right:'\\\\]',display:true}},{{left:'\\\\(',right:'\\\\)',display:false}}],throwOnError:false}})"></script>
<style>{CSS}</style></head><body>
{body}
</body></html>"""
