"""Run all verifications on a generated chapter and record results in `chapter.verification`.

Verification keys (used by the reader UI):
  deriv:<section>:<d>:<step>   derivation step check
  example:<section>:<e>        worked-example check
  ex:<exercise id>             exercise (math answer check / python tests / MCQ structure)
"""

import asyncio
from collections.abc import Iterator

from ..config import Settings
from ..models import Chapter, Exercise, VerificationResult
from .math_check import CheckJob, run_checks
from .sandbox import Sandbox


def iter_exercises(chapter: Chapter) -> Iterator[Exercise]:
    for p in chapter.primers:
        yield p.check_question
    for s in chapter.sections:
        yield from s.check_questions
    yield from chapter.practice


def math_jobs(chapter: Chapter) -> list[CheckJob]:
    jobs: list[CheckJob] = []
    for s in chapter.sections:
        for d, deriv in enumerate(s.derivations):
            for k, step in enumerate(deriv.steps):
                if step.check:
                    jobs.append(CheckJob(f"deriv:{s.id}:{d}:{k}", step.check.lhs, step.check.rhs))
        for e, ex in enumerate(s.worked_examples):
            if ex.check:
                jobs.append(CheckJob(f"example:{s.id}:{e}", ex.check.lhs, ex.check.rhs))
    for ex in iter_exercises(chapter):
        if ex.kind == "math" and ex.answer_check:
            jobs.append(CheckJob(f"ex:{ex.id}", ex.answer_check.lhs, ex.answer_check.rhs, None))
            if ex.numeric_answer is not None:
                jobs.append(
                    CheckJob(f"ex:{ex.id}#numeric", ex.answer_check.lhs, repr(ex.numeric_answer),
                             ex.tolerance if ex.tolerance else None)
                )
    return jobs


def structural_checks(chapter: Chapter) -> dict[str, VerificationResult]:
    out = {}
    for ex in iter_exercises(chapter):
        if ex.kind == "multiple_choice":
            ok = ex.correct_choice is not None and 0 <= ex.correct_choice < len(ex.choices) and len(ex.choices) >= 2
            out[f"ex:{ex.id}"] = VerificationResult(
                status="verified" if ok else "failed",
                method="structure",
                detail="answer key is consistent with the choices" if ok else "invalid answer key",
            )
    return out


async def verify_math(chapter: Chapter) -> None:
    results = await asyncio.to_thread(run_checks, math_jobs(chapter))
    merged: dict[str, VerificationResult] = {}
    for key, r in results.items():
        base = key.split("#")[0]
        vr = VerificationResult(status=r.status, method="sympy numeric check", detail=r.detail)
        prev = merged.get(base)
        # the numeric-answer check can only downgrade a verified result
        if prev is None or (prev.status == "verified" and vr.status != "verified"):
            merged[base] = vr
    chapter.verification.update(merged)


async def verify_python(chapter: Chapter, sandbox: Sandbox | None, settings: Settings) -> list[Exercise]:
    """Run each python exercise's reference solution against its tests. Returns failures."""
    failures = []
    for ex in iter_exercises(chapter):
        if ex.kind != "python":
            continue
        key = f"ex:{ex.id}"
        if not (ex.solution_code and ex.test_code):
            chapter.verification[key] = VerificationResult(
                status="failed", method="python", detail="missing solution or tests"
            )
            failures.append(ex)
            continue
        if sandbox is None:
            chapter.verification[key] = VerificationResult(
                status="skipped", method="python", detail="server sandbox disabled"
            )
            continue
        result = await asyncio.to_thread(sandbox.run_tests, ex.solution_code, ex.test_code, settings.sandbox_timeout_s)
        method = f"python tests ({sandbox.name} sandbox)"
        chapter.verification[key] = VerificationResult(
            status="verified" if result.ok else "failed", method=method, detail=result.summary()
        )
        if not result.ok:
            failures.append(ex)
    return failures


def summarize(chapter: Chapter) -> dict[str, int]:
    counts = {"verified": 0, "failed": 0, "error": 0, "skipped": 0}
    for v in chapter.verification.values():
        counts[v.status] = counts.get(v.status, 0) + 1
    return counts
