"""Paper -> chapter pipeline.

    extract  : PDF -> Extraction (text, figures, tables, equation regions, references)
    analyze  : Extraction -> PaperAnalysis (incl. prerequisites); map-reduce for long papers
    generate : outline -> prerequisite primers -> sections -> practice set + wrap-up
               -> verification (math, python, citations) -> repair failing python exercises

Each LLM call produces one schema-validated object, which keeps outputs within token limits
and lets a failed step be retried without redoing the rest.
"""

import asyncio
import json
import re

from ..config import Settings
from ..jobs import Progress, UserFacingError
from ..llm import LLMError, LLMProvider, LLMRequest
from ..llm.base import estimate_tokens
from ..models import (
    Chapter,
    ChapterOutline,
    ChapterSection,
    ChapterWrapUp,
    ChunkNotes,
    Exercise,
    Extraction,
    GenerationOptions,
    PaperAnalysis,
    PracticeSet,
    PrimerSet,
    Prerequisite,
    Usage,
)
from ..pdf_extract import ExtractionError, extract_pdf
from ..storage import Store
from ..verify import citations
from ..verify.chapter import structural_checks, summarize, verify_math, verify_python
from ..verify.sandbox import get_sandbox
from . import prompts

MAX_PRIMERS = 6


# --------------------------------------------------------------------------- context building


def _refs_block(ex: Extraction, max_chars: int) -> str:
    if not ex.references:
        return "(no reference list detected - do not use [@R..] citations)"
    per = max(60, min(220, max_chars // max(1, len(ex.references))))
    return "\n".join(f"{r.id}: {r.text[:per]}" for r in ex.references)


def paper_header(ex: Extraction, budget_tokens: int) -> str:
    """Metadata block: title, page count, figures, tables, references."""
    figs = "\n".join(f"{f.id} (page {f.page}): {f.caption[:200] or '(no caption)'}" for f in ex.figures) or "(none)"
    tabs = "\n".join(f"{t.id} (page {t.page}): {t.caption[:200] or '(no caption)'}" for t in ex.tables) or "(none)"
    ref_chars = min(12_000, budget_tokens * 3 // 4)
    return (
        f"Extracted title: {ex.title_guess}\nPages: {ex.page_count}\n\n"
        f"<figures>\n{figs}\n</figures>\n\n<tables>\n{tabs}\n</tables>\n\n"
        f"<references>\n{_refs_block(ex, ref_chars)}\n</references>"
    )


def _pages_text(ex: Extraction, pages: list[int]) -> str:
    wanted = set(pages)
    return "\n\n".join(f"<!-- page {p.page} -->\n{p.markdown}" for p in ex.pages if p.page in wanted)


def select_pages(ex: Extraction, query: str, budget_tokens: int) -> list[int]:
    """Pick the pages most relevant to `query` that fit the budget (kept in page order)."""
    all_pages = [p.page for p in ex.pages]
    if estimate_tokens(ex.full_text()) <= budget_tokens:
        return all_pages
    terms = {w for w in re.findall(r"[a-z]{4,}", query.lower())}
    scored = []
    for p in ex.pages:
        words = re.findall(r"[a-z]{4,}", p.markdown.lower())
        score = sum(1 for w in words if w in terms) / (1 + len(words) ** 0.5)
        scored.append((score, p.page, estimate_tokens(p.markdown)))
    chosen, used = [], 0
    for score, page, tokens in sorted(scored, reverse=True):
        if used + tokens > budget_tokens:
            continue
        chosen.append(page)
        used += tokens
    return sorted(chosen) or all_pages[:1]


def paper_context(ex: Extraction, budget_tokens: int, query: str = "", include_text: bool = True) -> str:
    header = paper_header(ex, budget_tokens)
    if not include_text:
        return f"<paper>\n{header}\n</paper>"
    remaining = max(1_000, budget_tokens - estimate_tokens(header))
    pages = select_pages(ex, query, remaining)
    note = "" if len(pages) == ex.page_count else f"\n(Excerpt: pages {', '.join(map(str, pages))} of {ex.page_count}.)"
    text = _pages_text(ex, pages)
    return f"<paper>\n{header}\n\n<text>{note}\n{text}\n</text>\n</paper>"


def _chunks(ex: Extraction, budget_tokens: int) -> list[str]:
    chunks, cur, used = [], [], 0
    for p in ex.pages:
        t = estimate_tokens(p.markdown)
        if cur and used + t > budget_tokens:
            chunks.append("\n\n".join(cur))
            cur, used = [], 0
        cur.append(f"<!-- page {p.page} -->\n{p.markdown[: budget_tokens * 3]}")
        used += t
    if cur:
        chunks.append("\n\n".join(cur))
    return chunks


# --------------------------------------------------------------------------- jobs


async def run_extract(store: Store, paper_id: str, progress: Progress) -> str:
    rec = store.get_paper(paper_id)
    progress.update("extracting", 0.1, "Extracting text, figures, tables and references")
    try:
        ex = await asyncio.to_thread(
            extract_pdf, store.pdf_path(paper_id), paper_id, rec.filename, store.assets_dir(paper_id)
        )
    except ExtractionError as exc:
        raise UserFacingError(str(exc)) from exc
    store.save(paper_id, "extraction", ex)
    rec = store.get_paper(paper_id)
    rec.title, rec.page_count = ex.title_guess, ex.page_count
    store.save_paper(rec)
    progress.update(
        "extracted", 1.0,
        f"Found {ex.page_count} pages, {len(ex.figures)} figures, {len(ex.tables)} tables, "
        f"{len(ex.equations)} equation regions, {len(ex.references)} references",
    )
    return "extracted"


class _Tracker:
    def __init__(self, store: Store, paper_id: str):
        self.store, self.paper_id, self.usage = store, paper_id, Usage()

    async def call(self, provider: LLMProvider, req: LLMRequest):
        try:
            result = await provider.generate(req)
        except LLMError as exc:
            if exc.usage:
                self._record(exc.usage)
            raise UserFacingError(str(exc)) from exc
        self._record(result.usage)
        return result.value

    def _record(self, usage: Usage) -> None:
        self.usage.add(usage)
        rec = self.store.get_paper(self.paper_id)
        rec.usage.add(usage)
        self.store.save_paper(rec)


async def run_analyze(store: Store, settings: Settings, provider: LLMProvider, paper_id: str, progress: Progress) -> str:
    ex = store.load(paper_id, "extraction", Extraction)
    tracker = _Tracker(store, paper_id)
    budget = provider.input_budget_tokens
    pdf_bytes = None
    text_tokens = estimate_tokens(ex.full_text())

    if provider.accepts_pdf and settings.use_native_pdf and ex.page_count <= 100:
        pdf = store.pdf_path(paper_id).read_bytes()
        if len(pdf) < 25 * 2**20:
            pdf_bytes = pdf
    if pdf_bytes is not None:
        context = paper_context(ex, budget, include_text=False)
        progress.update("analyzing", 0.2, "Analyzing paper (original PDF attached)")
    elif text_tokens + 2_000 <= budget:
        context = paper_context(ex, budget)
        progress.update("analyzing", 0.2, "Analyzing paper")
    else:
        parts = _chunks(ex, int(budget * 0.8))
        notes = []
        for i, part in enumerate(parts, 1):
            progress.update("analyzing", 0.1 + 0.6 * i / len(parts), f"Reading part {i}/{len(parts)}")
            n = await tracker.call(provider, LLMRequest(
                task="chunk-notes", system=prompts.SYSTEM, context=f"<paper-part>\n{part}\n</paper-part>",
                prompt=prompts.CHUNK_NOTES.format(i=i, n=len(parts)), schema=ChunkNotes, max_output_tokens=6_000,
            ))
            notes.append(f"## Part {i}\n{n.model_dump_json()}")
        header = paper_header(ex, budget // 4)
        context = f"<paper>\n{header}\n\n<notes>\n" + "\n\n".join(notes)[: budget * 3] + "\n</notes>\n</paper>"
        progress.update("analyzing", 0.8, "Combining notes into an analysis")

    analysis = await tracker.call(provider, LLMRequest(
        task="analysis", system=prompts.SYSTEM, context=context, pdf_bytes=pdf_bytes,
        prompt=prompts.ANALYSIS.format(pdf_note=prompts.PDF_NOTE if pdf_bytes else ""),
        schema=PaperAnalysis, max_output_tokens=16_000,
    ))
    analysis.prerequisites = _dedupe_prereqs(analysis.prerequisites)
    store.save(paper_id, "analysis", analysis)
    rec = store.get_paper(paper_id)
    rec.has_analysis = True
    rec.title = analysis.title or rec.title
    store.save_paper(rec)
    progress.update("analyzed", 1.0, f"Identified {len(analysis.prerequisites)} prerequisites")
    return "analyzed"


def _dedupe_prereqs(items: list[Prerequisite]) -> list[Prerequisite]:
    seen, out = set(), []
    for p in items:
        pid = re.sub(r"[^a-z0-9]+", "-", p.id.lower()).strip("-") or f"prereq-{len(out) + 1}"
        if pid in seen:
            continue
        seen.add(pid)
        out.append(p.model_copy(update={"id": pid}))
    return out


def _outline_text(outline: ChapterOutline) -> str:
    return "\n".join(f"- {s.id}: {s.title} - {s.goal}" for s in outline.sections)


def _equations_text(analysis: PaperAnalysis, ids: list[str] | None = None) -> str:
    eqs = [e for e in analysis.key_equations if ids is None or e.id in ids]
    return "\n".join(f"{e.id} (page {e.page}): $${e.latex}$$ - {e.meaning}" for e in eqs) or "(none)"


def _analysis_brief(analysis: PaperAnalysis) -> str:
    data = analysis.model_dump(exclude={"prerequisites"})
    return json.dumps(data, ensure_ascii=False)


async def run_generate(
    store: Store, settings: Settings, provider: LLMProvider, paper_id: str,
    options: GenerationOptions, progress: Progress,
) -> str:
    ex = store.load(paper_id, "extraction", Extraction)
    analysis = store.load(paper_id, "analysis", PaperAnalysis)
    tracker = _Tracker(store, paper_id)
    budget = provider.input_budget_tokens
    audience = prompts.audience_line(options.audience)
    warnings: list[str] = list(ex.warnings)

    known = [p for p in analysis.prerequisites if p.id in set(options.known_prerequisites)]
    missing = [p for p in analysis.prerequisites if p.id not in set(options.known_prerequisites)]
    if len(missing) > MAX_PRIMERS:
        warnings.append(
            f"{len(missing)} prerequisites are unfamiliar; primers cover the first {MAX_PRIMERS}: "
            + ", ".join(p.name for p in missing[MAX_PRIMERS:]) + " are not taught."
        )
        missing = missing[:MAX_PRIMERS]

    # The same paper context is reused across calls so prompt caching can apply.
    base_context = paper_context(ex, budget, query=analysis.method_overview + " " + analysis.problem)

    # 1. outline
    progress.update("outline", 0.05, "Planning the chapter")
    focus = f"Reader's focus request: {options.focus}" if options.focus.strip() else ""
    outline = await tracker.call(provider, LLMRequest(
        task="outline", system=prompts.SYSTEM, context=base_context, schema=ChapterOutline,
        prompt=prompts.OUTLINE.format(
            audience=audience, analysis=_analysis_brief(analysis),
            known=", ".join(p.name for p in known) or "nothing beyond general background",
            primers=", ".join(p.name for p in missing) or "nothing",
            focus=focus,
        ),
        max_output_tokens=8_000,
    ))
    if not outline.sections:
        raise UserFacingError("The model returned an empty outline. Try again or use a stronger model.")
    for i, s in enumerate(outline.sections, 1):
        s.id = f"s{i}"
    outline_txt = _outline_text(outline)
    figure_list = ", ".join(f"{f.id} ({f.caption[:80]})" for f in ex.figures) or "none"

    concurrency = provider.preset.max_concurrency or (
        1 if (provider.preset.tokens_per_minute or provider.model.tier in ("free", "free-tier", "local")) else 3)
    sem = asyncio.Semaphore(concurrency)
    done = {"n": 0}
    total_steps = len(outline.sections) + (1 if missing else 0) + 2

    def step_done(label: str) -> None:
        done["n"] += 1
        progress.update("writing", 0.1 + 0.7 * done["n"] / total_steps, label)

    async def primers_task() -> PrimerSet:
        if not missing:
            return PrimerSet(primers=[])
        items = "\n".join(f"- [{p.id}] {p.name}: {p.why_needed}" for p in missing)
        async with sem:
            res = await tracker.call(provider, LLMRequest(
                task="primers", system=prompts.SYSTEM, context=base_context, schema=PrimerSet,
                prompt=prompts.PRIMERS.format(audience=audience, items=items), max_output_tokens=16_000,
            ))
        step_done("Wrote prerequisite primers")
        return res

    async def section_task(sec) -> ChapterSection:
        query = " ".join([sec.title, sec.goal, *sec.paper_sections])
        ctx = base_context if estimate_tokens(ex.full_text()) <= budget else paper_context(ex, budget, query)
        async with sem:
            res = await tracker.call(provider, LLMRequest(
                task=f"section-{sec.id}", system=prompts.SYSTEM, context=ctx, schema=ChapterSection,
                prompt=prompts.SECTION.format(
                    audience=audience, chapter_title=outline.title, outline=outline_txt,
                    section_id=sec.id, section_title=sec.title, goal=sec.goal,
                    paper_sections=", ".join(sec.paper_sections) or "(see outline)",
                    equations=_equations_text(analysis, sec.key_equation_ids),
                    figures=", ".join(f for f in sec.figure_ids) or figure_list,
                    needs_derivation=sec.needs_derivation, needs_example=sec.needs_worked_example,
                ),
                max_output_tokens=24_000,
            ))
        res.id, res.title = sec.id, res.title or sec.title
        step_done(f"Wrote section {sec.id}: {sec.title}")
        return res

    async def practice_task() -> PracticeSet:
        python_line = ", and 2 python programming exercises (kind \"python\")" if options.include_python else ""
        async with sem:
            res = await tracker.call(provider, LLMRequest(
                task="practice", system=prompts.SYSTEM, context=base_context, schema=PracticeSet,
                prompt=prompts.PRACTICE.format(
                    audience=audience, outline=outline_txt, equations=_equations_text(analysis),
                    n_conceptual=4, n_math=3, python_line=python_line,
                ),
                max_output_tokens=24_000,
            ))
        step_done("Wrote practice set")
        return res

    async def wrapup_task() -> ChapterWrapUp:
        async with sem:
            res = await tracker.call(provider, LLMRequest(
                task="wrapup", system=prompts.SYSTEM, context=base_context, schema=ChapterWrapUp,
                prompt=prompts.WRAPUP.format(audience=audience, outline=outline_txt, analysis=_analysis_brief(analysis)),
                max_output_tokens=8_000,
            ))
        step_done("Wrote summary")
        return res

    progress.update("writing", 0.1, f"Writing {len(outline.sections)} sections")
    results = await asyncio.gather(
        primers_task(), practice_task(), wrapup_task(), *[section_task(s) for s in outline.sections]
    )
    primer_set, practice, wrapup = results[0], results[1], results[2]
    sections: list[ChapterSection] = list(results[3:])

    # deterministic exercise ids (the reader and verification keys rely on them)
    for i, p in enumerate(primer_set.primers, 1):
        p.check_question.id = f"primer{i}"
    for s in sections:
        for j, q in enumerate(s.check_questions, 1):
            q.id = f"{s.id}-q{j}"
    for k, q in enumerate(practice.exercises, 1):
        q.id = f"p{k}"

    chapter = Chapter(
        paper_id=paper_id, title=outline.title, provider=provider.preset.id, model=provider.model.id,
        options=options, paper_title=analysis.title, paper_authors=analysis.authors,
        learning_objectives=outline.learning_objectives, intuition_md=outline.intuition_md,
        primers=primer_set.primers, sections=sections, summary_md=wrapup.summary_md,
        key_takeaways=wrapup.key_takeaways, common_misconceptions=wrapup.common_misconceptions,
        practice=practice.exercises,
        further_reading=[fr for fr in wrapup.further_reading
                         if fr.ref_id is None or fr.ref_id in {r.id for r in ex.references}],
        references=ex.references, figures=ex.figures, tables=ex.tables, notation=analysis.notation,
        warnings=warnings,
    )

    # 2. verification
    progress.update("verifying", 0.85, "Checking citations")
    chapter, stats, cite_warnings = citations.apply_to_model(
        chapter, ref_ids={r.id for r in ex.references}, page_count=ex.page_count,
        figure_ids={f.id for f in ex.figures}, table_ids={t.id for t in ex.tables},
    )
    chapter.warnings.extend(cite_warnings)

    chapter.verification.update(structural_checks(chapter))
    progress.update("verifying", 0.88, "Verifying math with SymPy")
    await verify_math(chapter)

    sandbox = get_sandbox(settings)
    if sandbox is None:
        chapter.warnings.append("Python solutions were not executed on the server (sandbox disabled).")
    elif not sandbox.is_isolated:
        progress.log("Python checks use the local subprocess sandbox (not an isolation boundary).")
    progress.update("verifying", 0.9, "Running Python reference solutions")
    failures = await verify_python(chapter, sandbox, settings)

    if failures and sandbox is not None:
        progress.update("repairing", 0.94, f"Repairing {len(failures)} Python exercise(s)")
        for ex_item in failures:
            await _repair_python(chapter, ex_item, provider, tracker, sandbox, settings)

    chapter.usage = tracker.usage
    store.save(paper_id, "chapter", chapter)
    rec = store.get_paper(paper_id)
    rec.has_chapter = True
    store.save_paper(rec)
    counts = summarize(chapter)
    progress.update(
        "done", 1.0,
        f"Chapter ready. Checks: {counts['verified']} verified, {counts['failed']} failed, "
        f"{counts['error']} not checkable; {stats['citations']} citations ({stats['unresolved']} unresolved)",
    )
    return "ready"


async def _repair_python(chapter, ex_item: Exercise, provider, tracker, sandbox, settings) -> None:
    key = f"ex:{ex_item.id}"
    error = chapter.verification[key].detail if key in chapter.verification else "unknown"
    try:
        fixed: Exercise = await tracker.call(provider, LLMRequest(
            task="python-repair", system=prompts.SYSTEM, schema=Exercise,
            prompt=prompts.PYTHON_REPAIR.format(exercise=ex_item.model_dump_json(), error=error),
            max_output_tokens=8_000,
        ))
    except UserFacingError:
        return
    if fixed.kind != "python" or not (fixed.solution_code and fixed.test_code):
        return
    result = await asyncio.to_thread(sandbox.run_tests, fixed.solution_code, fixed.test_code, settings.sandbox_timeout_s)
    if not result.ok:
        return
    fixed.id = ex_item.id
    for container in [chapter.practice, *[s.check_questions for s in chapter.sections]]:
        for i, item in enumerate(container):
            if item.id == ex_item.id:
                container[i] = fixed
    chapter.verification[key] = chapter.verification[key].model_copy(
        update={"status": "verified", "detail": "all tests passed (after automatic repair)"}
    )
