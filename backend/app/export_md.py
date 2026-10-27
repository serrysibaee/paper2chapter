"""Markdown export of a chapter, for Obsidian (default) or any CommonMark reader.

The Obsidian flavour is what the Obsidian plugin writes into a vault: one note with YAML
frontmatter, `$`/`$$` math, callouts, solutions folded in collapsed callouts, figures embedded
as `![[<prefix><file>]]`, and citations that link to the right page of the PDF in the vault.

Model output is untrusted (a PDF's text can steer it), and a note in a vault can execute code
through community plugins. So every string from the model passes `_safe()`: HTML tags are
escaped, Templater tags (`<% … %>`) and Dataview inline queries (`` `= …` ``, `` `$= …` ``)
are neutralised, and only code blocks in an allow-list of languages keep their language, so a
```` ```dataviewjs ```` block arrives as inert text. Math and code are left byte-for-byte.

The same renderer also gives the chapter as **parts** (`render_chapter_parts`): each piece of the note (the intuition,
each primer, each section and its derivations, worked examples and questions, the practice set, ...) as its own
Markdown fragment, already made inert, with the paper's metadata and its prerequisites. A client that builds its
own note from a template uses them; every fragment is exactly the text the note has in that place.

Page citations link to the PDF in the vault (`pdf_link`), or follow a URL template (`page_link`, with `{page}`)
for a PDF kept elsewhere, for example `zotero://open-pdf/library/items/<KEY>?page={page}`.
"""

import re
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel

from .identifiers import PaperIds
from .models import Chapter, Exercise, PaperAnalysis, VerificationResult, VerificationStatus

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


# --------------------------------------------------------------------------- parts

PARTS_VERSION = 1  # raised when a field changes meaning or goes away; new fields keep the version


class PaperInfo(BaseModel):
    title: str
    authors: list[str]
    year: str | None = None
    field: str | None = None
    doi: str | None = None      # printed on the PDF's first page (see identifiers.py)
    arxiv: str | None = None
    page_count: int | None = None


class PrerequisitePart(BaseModel):
    id: str
    name: str
    why_needed: str
    level: str
    known: bool                 # the reader said they know it
    primed: bool                # the chapter teaches it in a primer


class PrimerPart(BaseModel):
    prerequisite_id: str
    title: str
    md: str


class DerivationPart(BaseModel):
    title: str
    md: str


class ExamplePart(BaseModel):
    title: str
    check: VerificationStatus | None
    md: str


class ExercisePart(BaseModel):
    """One exercise as data, every text made inert: what flashcards and a chapter manifest are made of."""
    id: str
    where: Literal["primer", "section", "practice"]
    section: int | None = None          # the section's number, for a section's check question
    prerequisite_id: str | None = None  # the prerequisite, for a primer's check
    kind: str
    difficulty: str
    prompt: str
    choices: list[str]
    correct_choice: int | None = None
    answer: str                         # kept whatever include_solutions says: a card or a manifest needs it
    explanation: str
    starter_code: str | None = None
    solution_code: str | None = None
    check: VerificationStatus | None = None


class SectionPart(BaseModel):
    id: str
    number: int
    title: str
    pages: list[int]            # pages of the paper the section cites, captions included
    intuition: str
    body: str
    derivations: list[DerivationPart]
    worked_examples: list[ExamplePart]
    check_questions: list[str]  # each a question callout, solution folded inside
    md: str                     # everything the note has under the section's heading


class ChapterParts(BaseModel):
    version: int = PARTS_VERSION
    paper_id: str
    title: str
    generated_at: str
    provider: str
    model: str
    audience: str
    flavor: Flavor
    paper: PaperInfo
    prerequisites: list[PrerequisitePart]
    about: str
    one_line: str
    new_or_surprising: str
    objectives: str
    intuition: str
    primers: list[PrimerPart]
    notation: str
    sections: list[SectionPart]
    summary: str
    takeaways: str
    misconceptions: str
    practice: list[str]
    further_reading: str
    references: str
    warnings: str
    assets: list[str]
    exercises: list[ExercisePart] = []  # every exercise in the note's order: primers, sections, practice


@dataclass
class _Built:
    """The note's pieces, made in the order the note shows them (asset and exercise numbering depend on it)."""
    about: str
    objectives: str
    intuition: str
    primers: list[PrimerPart]
    notation: str
    sections: list[SectionPart]
    summary: str
    takeaways: str
    misconceptions: str
    practice: list[str]
    further_reading: str
    references: str
    warnings: str


class _Writer:
    def __init__(self, ch: Chapter, flavor: Flavor, asset_prefix: str, pdf_link: str | None,
                 include_solutions: bool, page_link: str | None = None):
        self.ch = ch
        self.obsidian = flavor == "obsidian"
        self.prefix = asset_prefix
        self.pdf = pdf_link
        self.page_link = page_link  # a URL template with {page}; validated by the API
        self.solutions = include_solutions
        self.pages: set[int] = set()  # pages cited since the last reset (one section's)
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
                parts.append(self._page_ref(key[1:]))
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
        return self._page_ref(str(page))

    def _page_ref(self, page: str) -> str:
        """A page of the paper: a link by the template, else to the PDF in the vault, else plain text."""
        self.pages.add(int(page))
        if self.page_link:
            return f"[p. {page}]({self.page_link.replace('{page}', page)})"
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

    def exercise_part(self, ex: Exercise, where: str, section: int | None = None,
                      prerequisite_id: str | None = None) -> ExercisePart:
        v = self.ch.verification.get("ex:" + ex.id)
        return ExercisePart(
            id=_plain(ex.id), where=where, section=section,
            prerequisite_id=_plain(prerequisite_id) if prerequisite_id else None,
            kind=ex.kind, difficulty=ex.difficulty, prompt=self.md(ex.prompt_md),
            choices=[self.md(c) for c in ex.choices], correct_choice=ex.correct_choice,
            answer=self.md(ex.answer_md), explanation=self.md(ex.explanation_md),
            starter_code=_safe_code(ex.starter_code) if ex.starter_code else None,
            solution_code=_safe_code(ex.solution_code) if ex.solution_code else None,
            check=v.status if v else None)

    # ---------------------------------------------------------------- document

    def _primer(self, p) -> PrimerPart:
        parts = [self.md(p.intuition_md), self.md(p.explanation_md)]
        parts += [self.math(f) for f in p.key_formulas_latex]
        if p.example_md:
            parts.append("**Example.** " + self.md(p.example_md))
        parts.append(self.exercise(p.check_question, "Check"))
        return PrimerPart(prerequisite_id=_plain(p.prerequisite_id), title=_plain(p.title),
                          md="\n\n".join(x for x in parts if x))

    def _section(self, i: int, s) -> SectionPart:
        self.pages = set()
        parts: list[str] = []  # everything under the section's heading, in the note's order
        intuition = ""
        if s.intuition_md:
            intuition = self.md(s.intuition_md)
            parts.append(self.callout("tip", "Intuition", intuition))
        body = self.md(s.body_md)
        parts.append(body)
        derivations = []
        for d, deriv in enumerate(s.derivations):
            title = _plain(deriv.title)
            steps = []
            if deriv.goal_md:
                steps.append(self.md(deriv.goal_md))
            for k, step in enumerate(deriv.steps, 1):
                steps.append(f"**Step {k}.**{self.mark(f'deriv:{s.id}:{d}:{k - 1}')} *{_plain(step.justification)}*\n\n"
                             + self.math(step.latex) + "\n\n" + self.md(step.explanation_md))
            steps.append("**Result:**\n\n" + self.math(deriv.result_latex))
            parts += [f"### Derivation: {title}", *steps]
            derivations.append(DerivationPart(title=title, md="\n\n".join(x for x in steps if x)))
        examples = []
        for e, ex in enumerate(s.worked_examples):
            key = f"example:{s.id}:{e}"
            title = _plain(ex.title)
            steps = "\n".join(f"{n}. {self.md(st)}" for n, st in enumerate(ex.solution_steps_md, 1))
            text = self.md(ex.problem_md) + "\n\n" + steps + "\n\n**Answer:** " + self.md(ex.answer_md)
            parts.append(self.callout("example", f"Worked example: {title}{self.mark(key)}", text))
            v = self.ch.verification.get(key)
            examples.append(ExamplePart(title=title, check=v.status if v else None, md=text))
        questions = []
        if s.check_questions:
            questions = [self.exercise(q) for q in s.check_questions]
            parts += ["### Check your understanding", *questions]
        return SectionPart(id=_plain(s.id), number=i, title=_plain(s.title), pages=sorted(self.pages),
                           intuition=intuition, body=body, derivations=derivations, worked_examples=examples,
                           check_questions=questions, md="\n\n".join(x for x in parts if x))

    def _further_reading(self) -> str:
        items = []
        for fr in self.ch.further_reading:
            if fr.ref_id and fr.ref_id in self.ref_numbers:
                n = self.ref_numbers[fr.ref_id]
                tag = f"([[#^ref-{fr.ref_id}|ref. {n}]])" if self.obsidian else f"([ref. {n}](#ref-{fr.ref_id}))"
            else:
                tag = "*(suggested by the model; not from the paper: verify)*"
            year = f", {_plain(fr.year)}" if fr.year else ""
            items.append(f"- **{_plain(fr.title)}**, {_plain(fr.authors)}{year}. {self.md(fr.why)} {tag}")
        return "\n".join(items)

    def _references(self) -> str:
        lines = []
        for ref in self.ch.references:
            n = self.ref_numbers[ref.id]
            anchor = f" ^ref-{ref.id}" if self.obsidian else ""
            lead = "" if self.obsidian else f'<a id="ref-{ref.id}"></a>'
            lines.append(f"{n}. {lead}{_plain(ref.text)}{anchor}")
        return "\n".join(lines)

    def build(self) -> _Built:
        """Every piece of the note, made once and in the note's order."""
        ch = self.ch
        by = f" by {_plain(', '.join(ch.paper_authors))}" if ch.paper_authors else ""
        src = f"[[{self.pdf}|{_plain(ch.paper_title)}]]" if (self.obsidian and self.pdf) else f"*{_plain(ch.paper_title)}*"
        legend = ("Marks: ✅ checked automatically · ❌ check failed · ➖ not checkable."
                  if self.obsidian else "")
        about = (f"A textbook chapter based on {src}{by}. Generated with {_plain(ch.provider)}/"
                 f"{_plain(ch.model)}; machine-written, so verify important details against the "
                 f"paper. {legend}".strip())
        objectives = "\n".join(f"- {self.md(o)}" for o in ch.learning_objectives)
        intuition = self.md(ch.intuition_md)
        primers = [self._primer(p) for p in ch.primers]
        notation = ""
        if ch.notation:
            rows = "\n".join(f"| ${n.symbol_latex.strip()}$ | {_plain(n.meaning)} |" for n in ch.notation)
            notation = "| Symbol | Meaning |\n|---|---|\n" + rows
        sections = [self._section(i, s) for i, s in enumerate(ch.sections, 1)]
        summary = self.md(ch.summary_md)
        takeaways = "\n".join(f"- {self.md(t)}" for t in ch.key_takeaways)
        misconceptions = "\n".join(f"- {self.md(t)}" for t in ch.common_misconceptions)
        practice = []
        if ch.practice:
            self.n_exercise = 0
            practice = [self.exercise(q) for q in ch.practice]
        return _Built(about=about, objectives=objectives, intuition=intuition, primers=primers, notation=notation,
                      sections=sections, summary=summary, takeaways=takeaways, misconceptions=misconceptions,
                      practice=practice, further_reading=self._further_reading(), references=self._references(),
                      warnings="\n".join(f"- {_plain(w)}" for w in ch.warnings))

    def render(self) -> str:
        ch = self.ch
        b = self.build()
        out: list[str] = []
        a = out.append
        if self.obsidian:
            a(self.frontmatter())
        a(f"# {_plain(ch.title)}")
        a(self.callout("info", "About this chapter", b.about))
        if ch.learning_objectives:
            a(self.callout("abstract", "Learning objectives", b.objectives))
        a("## Intuition first\n\n" + b.intuition)
        if b.primers:
            a("## Prerequisites")
            out += [f"### {p.title}" + (f"\n\n{p.md}" if p.md else "") for p in b.primers]
        if b.notation:
            a("## Notation\n\n" + b.notation)
        out += [f"## {s.number}. {s.title}" + (f"\n\n{s.md}" if s.md else "") for s in b.sections]
        a("## Summary\n\n" + b.summary)
        if ch.key_takeaways:
            a("### Key takeaways\n\n" + b.takeaways)
        if ch.common_misconceptions:
            a("### Common misconceptions\n\n" + b.misconceptions)
        if b.practice:
            a("## Practice problems\n\n" + "\n\n".join(b.practice))
        if ch.further_reading:
            a("## Further reading\n\n" + b.further_reading)
        if ch.references:
            a("## References (from the paper)\n\n" + b.references)
        if ch.warnings:
            a(self.callout("warning", "Generation notes", b.warnings))
        return "\n\n".join(x for x in out if x).rstrip() + "\n"

    def parts(self, analysis: PaperAnalysis | None, ids: PaperIds | None, page_count: int | None) -> ChapterParts:
        ch = self.ch
        b = self.build()
        known = set(ch.options.known_prerequisites)
        primed = {p.prerequisite_id for p in ch.primers}
        if analysis is not None:
            prereqs = [PrerequisitePart(id=_plain(p.id), name=_plain(p.name), why_needed=self.md(p.why_needed),
                                        level=p.level, known=p.id in known, primed=p.id in primed)
                       for p in analysis.prerequisites]
        else:  # without the analysis, the primers and the reader's ticks still name them
            prereqs = [PrerequisitePart(id=_plain(p.prerequisite_id), name=_plain(p.title), why_needed="", level="",
                                        known=p.prerequisite_id in known, primed=True) for p in ch.primers]
            prereqs += [PrerequisitePart(id=_plain(k), name=_plain(k), why_needed="", level="", known=True,
                                         primed=False) for k in ch.options.known_prerequisites if k not in primed]
        ids = ids or PaperIds()
        paper = PaperInfo(title=_plain(ch.paper_title), authors=[_plain(x) for x in ch.paper_authors],
                          year=_plain(analysis.year) if analysis and analysis.year else None,
                          field=_plain(analysis.field) if analysis and analysis.field else None,
                          doi=ids.doi, arxiv=ids.arxiv, page_count=page_count)
        one_line = self.md(analysis.one_sentence_summary) if analysis else ""
        new = "\n".join(f"- {self.md(c)}" for c in analysis.key_contributions) if analysis else ""
        exercises = [self.exercise_part(p.check_question, "primer", prerequisite_id=p.prerequisite_id)
                     for p in ch.primers]
        exercises += [self.exercise_part(q, "section", section=i)
                      for i, s in enumerate(ch.sections, 1) for q in s.check_questions]
        exercises += [self.exercise_part(q, "practice") for q in ch.practice]
        return ChapterParts(
            paper_id=_plain(ch.paper_id), title=_plain(ch.title), generated_at=_plain(ch.generated_at),
            provider=_plain(ch.provider), model=_plain(ch.model), audience=ch.options.audience,
            flavor="obsidian" if self.obsidian else "commonmark", paper=paper, prerequisites=prereqs,
            about=b.about, one_line=one_line, new_or_surprising=new, objectives=b.objectives, intuition=b.intuition,
            primers=b.primers, notation=b.notation, sections=b.sections, summary=b.summary, takeaways=b.takeaways,
            misconceptions=b.misconceptions, practice=b.practice, further_reading=b.further_reading,
            references=b.references, warnings=b.warnings, assets=self.assets, exercises=exercises)

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
    page_link: str | None = None,
) -> MarkdownExport:
    w = _Writer(chapter, flavor, asset_prefix, pdf_link or None, include_solutions, page_link or None)
    return MarkdownExport(markdown=w.render(), assets=w.assets)


def render_chapter_parts(
    chapter: Chapter,
    analysis: PaperAnalysis | None = None,
    ids: PaperIds | None = None,
    page_count: int | None = None,
    flavor: Flavor = "obsidian",
    asset_prefix: str = "",
    pdf_link: str | None = None,
    include_solutions: bool = True,
    page_link: str | None = None,
) -> ChapterParts:
    """The chapter as the note's pieces, each made inert, for a client that assembles its own note."""
    w = _Writer(chapter, flavor, asset_prefix, pdf_link or None, include_solutions, page_link or None)
    return w.parts(analysis, ids, page_count)
