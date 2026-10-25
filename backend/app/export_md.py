"""Markdown export of a chapter, for Obsidian (default) or any CommonMark reader.

The Obsidian flavour is what the Obsidian plugin writes into a vault: one note with YAML
frontmatter, `$`/`$$` math, callouts, solutions folded in collapsed callouts, figures embedded
as `![[<prefix><file>]]`, and citations that link to the right page of the PDF in the vault.

Model output is untrusted (a PDF's text can steer it), and a note in a vault can execute code
through community plugins. So every string from the model passes `_safe()`: HTML tags are
escaped, Templater tags (`<% … %>`) and Dataview inline queries (`` `= …` ``, `` `$= …` ``)
are neutralised, and only code blocks in an allow-list of languages keep their language, so a
```` ```dataviewjs ```` block arrives as inert text. Math and code are left byte-for-byte.
"""

import re
from dataclasses import dataclass, field
from typing import Literal

from .models import Chapter, Exercise, VerificationResult

Flavor = Literal["obsidian", "commonmark"]

WJ = "\u2060"  # word joiner: invisible, breaks `<%` and `` `$= `` without changing the text read
SAFE_LANGS = {"", "python", "py", "text", "txt", "plaintext", "json", "latex", "tex", "math",
              "bash", "sh", "shell", "console", "c", "cpp", "java", "javascript", "js",
              "typescript", "ts", "matlab", "r", "julia", "yaml", "toml", "csv", "pseudo",
              "pseudocode", "sql", "html", "xml", "markdown", "md", "rust", "go"}

_CITE_RE = re.compile(r"\[@([^\]]+)\]")
_PLACEHOLDER_RE = re.compile(r"\{\{(fig|table):([A-Za-z0-9]+)\}\}")
# segments left untouched by the safety pass: fenced code, inline code, display and inline math
_PROTECTED_RE = re.compile(
    r"(?P<fence>^[ \t]*(?P<ticks>`{3,}|~{3,})(?P<lang>[^\n]*)\n.*?^[ \t]*(?P=ticks)[ \t]*$)"
    r"|(?P<icode>`[^`\n]+`)"
    r"|(?P<dmath>\$\$.+?\$\$)"
    r"|(?P<imath>(?<![\\$])\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d))",
    re.S | re.M,
)
_TAG_RE = re.compile(r"<(?=[A-Za-z/!?%])")


def _safe(text: str) -> str:
    """Neutralise anything in model output that a vault plugin could execute."""
    out: list[str] = []
    pos = 0
    for m in _PROTECTED_RE.finditer(text):
        out.append(_escape_prose(text[pos:m.start()]))
        seg = m.group(0)
        if m.group("fence"):
            lang = (m.group("lang") or "").strip().split()[0].lower() if (m.group("lang") or "").strip() else ""
            if lang not in SAFE_LANGS:
                seg = seg.replace(m.group("ticks") + m.group("lang"), m.group("ticks") + "text", 1)
            seg = seg.replace("<%", "<" + WJ + "%")
        elif m.group("icode"):
            inner = seg[1:-1]
            if inner.lstrip().startswith(("=", "$=")) or inner.startswith("dv."):
                seg = "`" + WJ + inner + "`"
            seg = seg.replace("<%", "<" + WJ + "%")
        out.append(seg)
        pos = m.end()
    out.append(_escape_prose(text[pos:]))
    return "".join(out)


def _escape_prose(text: str) -> str:
    return _TAG_RE.sub("&lt;", text.replace("<%", "<" + WJ + "%"))


def _plain(text: str) -> str:
    """Text for a heading, table cell or caption: one line, safe."""
    return _safe(" ".join(str(text).split())).replace("|", "\\|")


def _quote(text: str, depth: int = 1) -> str:
    prefix = "> " * depth
    return "\n".join((prefix + line).rstrip() for line in text.split("\n"))


def _yaml_str(text: str) -> str:
    return '"' + str(text).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'


MARK = {"verified": "✅", "failed": "❌", "error": "➖", "skipped": "⏸"}
MARK_WORD = {"verified": "checked", "failed": "check failed", "error": "not checkable", "skipped": "not run"}


@dataclass
class MarkdownExport:
    markdown: str
    assets: list[str] = field(default_factory=list)  # asset files (unprefixed) the note embeds


class _Writer:
    def __init__(self, ch: Chapter, flavor: Flavor, asset_prefix: str, pdf_link: str | None,
                 include_solutions: bool):
        self.ch = ch
        self.obsidian = flavor == "obsidian"
        self.prefix = asset_prefix
        self.pdf = pdf_link
        self.solutions = include_solutions
        self.ref_numbers = {r.id: (r.number or i + 1) for i, r in enumerate(ch.references)}
        self.figures = {f.id: f for f in ch.figures}
        self.tables = {t.id: t for t in ch.tables}
        self.assets: list[str] = []
        self.n_exercise = 0

    # ---------------------------------------------------------------- text

    def md(self, text: str) -> str:
        text = _safe(text or "")
        text = _CITE_RE.sub(self._cite, text)
        return _PLACEHOLDER_RE.sub(self._placeholder, text).strip()

    def _cite(self, m: re.Match) -> str:
        parts = []
        for key in [k.strip().lstrip("@") for k in re.split(r"[;,]", m.group(1)) if k.strip()]:
            if key.startswith("?"):
                parts.append(f"⚠ unresolved {key[1:]}")
            elif re.fullmatch(r"p\d+", key):
                page = key[1:]
                parts.append(f"[[{self.pdf}#page={page}|p. {page}]]" if (self.obsidian and self.pdf) else f"p. {page}")
            elif key in self.ref_numbers:
                n = self.ref_numbers[key]
                parts.append(f"[[#^ref-{key}|{n}]]" if self.obsidian else f"[{n}](#ref-{key})")
        # parentheses, not brackets: "[[[#^ref|1]]]" is misparsed by Obsidian's link syntax
        return "(" + ", ".join(parts) + ")" if parts else ""

    def _placeholder(self, m: re.Match) -> str:
        kind, ident = m.group(1), m.group(2)
        if kind == "fig" and ident in self.figures:
            f = self.figures[ident]
            if f.image_file not in self.assets:
                self.assets.append(f.image_file)
            name = self.prefix + f.image_file
            caption = f"*{_label('Figure', ident, f.caption)} (paper {self._page(f.page)})*"
            embed = f"![[{name}]]" if self.obsidian else f"![{_plain(f.caption or ident)}]({name})"
            return f"\n{embed}\n{caption}\n"
        if kind == "table" and ident in self.tables:
            t = self.tables[ident]
            return f"\n{_safe(t.markdown).strip()}\n\n*{_label('Table', ident, t.caption)} (paper {self._page(t.page)})*\n"
        return ""

    def _page(self, page: int) -> str:
        return f"[[{self.pdf}#page={page}|p. {page}]]" if (self.obsidian and self.pdf) else f"p. {page}"

    @staticmethod
    def math(latex: str) -> str:
        return "$$\n" + latex.strip().replace("$$", "") + "\n$$"

    def mark(self, key: str) -> str:
        v: VerificationResult | None = self.ch.verification.get(key)
        if v is None:
            return ""
        return f" {MARK[v.status]}" if self.obsidian else f" ({MARK_WORD[v.status]})"

    def callout(self, kind: str, title: str, body: str, folded: bool = False, depth: int = 1) -> str:
        if self.obsidian:
            head = f"[!{kind}]{'-' if folded else ''} {title}".rstrip()
            return _quote(head + "\n" + body, depth)
        return _quote(f"**{title}**\n\n{body}", depth)

    # ---------------------------------------------------------------- exercises

    def exercise(self, ex: Exercise, label: str | None = None) -> str:
        self.n_exercise += 1
        title = label or f"Exercise {self.n_exercise}"
        title = f"{title} · {ex.kind.replace('_', ' ')} · {ex.difficulty}{self.mark('ex:' + ex.id)}"
        body = [self.md(ex.prompt_md)]
        if ex.kind == "multiple_choice" and ex.choices:
            body.append("\n".join(f"{chr(65 + i)}. {self.md(c)}" for i, c in enumerate(ex.choices)))
        if ex.kind == "python" and ex.starter_code:
            body.append("Starter code:\n\n```python\n" + _safe_code(ex.starter_code) + "\n```")
        if self.solutions:
            sol = []
            if ex.kind == "multiple_choice" and ex.correct_choice is not None and 0 <= ex.correct_choice < len(ex.choices):
                sol.append(f"**Correct option: {chr(65 + ex.correct_choice)}**")
            sol += [self.md(ex.answer_md), self.md(ex.explanation_md)]
            if ex.kind == "python" and ex.solution_code:
                sol.append("```python\n" + _safe_code(ex.solution_code) + "\n```")
                if ex.test_code:
                    sol.append("Tests:\n\n```python\n" + _safe_code(ex.test_code) + "\n```")
            body.append(self.callout("success", "Solution", "\n\n".join(s for s in sol if s), folded=True))
        return self.callout("question", title, "\n\n".join(b for b in body if b))

    # ---------------------------------------------------------------- document

    def render(self) -> str:
        ch = self.ch
        out: list[str] = []
        a = out.append
        if self.obsidian:
            a(self.frontmatter())
        a(f"# {_plain(ch.title)}")
        by = f" by {_plain(', '.join(ch.paper_authors))}" if ch.paper_authors else ""
        src = f"[[{self.pdf}|{_plain(ch.paper_title)}]]" if (self.obsidian and self.pdf) else f"*{_plain(ch.paper_title)}*"
        legend = ("Marks: ✅ checked automatically · ❌ check failed · ➖ not checkable."
                  if self.obsidian else "")
        a(self.callout("info", "About this chapter",
                       f"A textbook chapter based on {src}{by}. Generated with {_plain(ch.provider)}/"
                       f"{_plain(ch.model)}; machine-written, so verify important details against the "
                       f"paper. {legend}".strip()))
        if ch.learning_objectives:
            a(self.callout("abstract", "Learning objectives",
                           "\n".join(f"- {self.md(o)}" for o in ch.learning_objectives)))
        a("## Intuition first\n\n" + self.md(ch.intuition_md))

        if ch.primers:
            a("## Prerequisites")
            for p in ch.primers:
                parts = [f"### {_plain(p.title)}", self.md(p.intuition_md), self.md(p.explanation_md)]
                parts += [self.math(f) for f in p.key_formulas_latex]
                if p.example_md:
                    parts.append("**Example.** " + self.md(p.example_md))
                parts.append(self.exercise(p.check_question, "Check"))
                a("\n\n".join(x for x in parts if x))

        if ch.notation:
            rows = "\n".join(f"| ${n.symbol_latex.strip()}$ | {_plain(n.meaning)} |" for n in ch.notation)
            a("## Notation\n\n| Symbol | Meaning |\n|---|---|\n" + rows)

        for i, s in enumerate(ch.sections, 1):
            parts = [f"## {i}. {_plain(s.title)}"]
            if s.intuition_md:
                parts.append(self.callout("tip", "Intuition", self.md(s.intuition_md)))
            parts.append(self.md(s.body_md))
            for d, deriv in enumerate(s.derivations):
                parts.append(f"### Derivation: {_plain(deriv.title)}")
                if deriv.goal_md:
                    parts.append(self.md(deriv.goal_md))
                for k, step in enumerate(deriv.steps, 1):
                    parts.append(f"**Step {k}.**{self.mark(f'deriv:{s.id}:{d}:{k - 1}')} *{_plain(step.justification)}*\n\n"
                                 + self.math(step.latex) + "\n\n" + self.md(step.explanation_md))
                parts.append("**Result:**\n\n" + self.math(deriv.result_latex))
            for e, ex in enumerate(s.worked_examples):
                steps = "\n".join(f"{n}. {self.md(st)}" for n, st in enumerate(ex.solution_steps_md, 1))
                parts.append(self.callout(
                    "example", f"Worked example: {_plain(ex.title)}{self.mark(f'example:{s.id}:{e}')}",
                    self.md(ex.problem_md) + "\n\n" + steps + "\n\n**Answer:** " + self.md(ex.answer_md)))
            if s.check_questions:
                parts.append("### Check your understanding")
                parts += [self.exercise(q) for q in s.check_questions]
            a("\n\n".join(x for x in parts if x))

        a("## Summary\n\n" + self.md(ch.summary_md))
        if ch.key_takeaways:
            a("### Key takeaways\n\n" + "\n".join(f"- {self.md(t)}" for t in ch.key_takeaways))
        if ch.common_misconceptions:
            a("### Common misconceptions\n\n" + "\n".join(f"- {self.md(t)}" for t in ch.common_misconceptions))
        if ch.practice:
            self.n_exercise = 0
            a("## Practice problems\n\n" + "\n\n".join(self.exercise(q) for q in ch.practice))
        if ch.further_reading:
            items = []
            for fr in ch.further_reading:
                if fr.ref_id and fr.ref_id in self.ref_numbers:
                    n = self.ref_numbers[fr.ref_id]
                    tag = f"([[#^ref-{fr.ref_id}|ref. {n}]])" if self.obsidian else f"([ref. {n}](#ref-{fr.ref_id}))"
                else:
                    tag = "*(suggested by the model; not from the paper: verify)*"
                year = f", {_plain(fr.year)}" if fr.year else ""
                items.append(f"- **{_plain(fr.title)}**, {_plain(fr.authors)}{year}. {self.md(fr.why)} {tag}")
            a("## Further reading\n\n" + "\n".join(items))
        if ch.references:
            lines = []
            for ref in ch.references:
                n = self.ref_numbers[ref.id]
                anchor = f" ^ref-{ref.id}" if self.obsidian else ""
                lead = "" if self.obsidian else f'<a id="ref-{ref.id}"></a>'
                lines.append(f"{n}. {lead}{_plain(ref.text)}{anchor}")
            a("## References (from the paper)\n\n" + "\n".join(lines))
        if ch.warnings:
            a(self.callout("warning", "Generation notes", "\n".join(f"- {_plain(w)}" for w in ch.warnings)))
        return "\n\n".join(x for x in out if x).rstrip() + "\n"

    def frontmatter(self) -> str:
        ch = self.ch
        lines = ["---", f"title: {_yaml_str(ch.title)}", f"paper: {_yaml_str(ch.paper_title)}"]
        if ch.paper_authors:
            lines.append("authors:")
            lines += [f"  - {_yaml_str(x)}" for x in ch.paper_authors]
        if self.pdf:
            lines.append(f"source_pdf: {_yaml_str('[[' + self.pdf + ']]')}")
        lines += [
            f"generated: {_yaml_str(ch.generated_at)}",
            f"generator: {_yaml_str('paper2chapter')}",
            f"model: {_yaml_str(ch.provider + '/' + ch.model)}",
            f"audience: {_yaml_str(ch.options.audience)}",
            f"paper_id: {_yaml_str(ch.paper_id)}",
            "tags:",
            "  - paper2chapter",
            "---",
        ]
        return "\n".join(lines)


def _label(kind: str, ident: str, caption: str) -> str:
    """'Figure F2: caption', unless the caption already names itself ('Figure 2: ...')."""
    cap = _plain(caption or "")
    if re.match(rf"(?i)({kind}|{kind[:3]}\.?)\s*\d", cap):
        return cap
    return f"{kind} {ident}: {cap}" if cap else f"{kind} {ident}"


def _safe_code(code: str) -> str:
    return code.replace("<%", "<" + WJ + "%").replace("```", "`\u200b``").rstrip()


def render_chapter_markdown(
    chapter: Chapter,
    flavor: Flavor = "obsidian",
    asset_prefix: str = "",
    pdf_link: str | None = None,
    include_solutions: bool = True,
) -> MarkdownExport:
    w = _Writer(chapter, flavor, asset_prefix, pdf_link or None, include_solutions)
    return MarkdownExport(markdown=w.render(), assets=w.assets)
