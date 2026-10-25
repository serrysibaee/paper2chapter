"""Deterministic offline provider for tests and for trying the UI without an API key.

The content is fixed (a short lesson on softmax-weighted averages) and clearly labelled as
mock output. It deliberately exercises every feature: math, derivations with SymPy checks,
citations, figures, and all exercise types including a Python exercise whose reference
solution passes its tests.
"""

import json
import re

from ..models import (
    ChapterOutline,
    ChapterSection,
    ChapterWrapUp,
    ChunkNotes,
    PaperAnalysis,
    PracticeSet,
    PrimerSet,
    Usage,
)
from .base import LLMProvider, LLMRequest, RawCompletion, estimate_tokens

NOTE = "*(Mock provider output: configure a real model in Settings for a real chapter.)*"


def _exercise(eid: str, kind: str, **kw) -> dict:
    base = {
        "id": eid,
        "kind": kind,
        "difficulty": "easy",
        "prompt_md": "",
        "choices": [],
        "correct_choice": None,
        "answer_md": "",
        "explanation_md": "",
        "numeric_answer": None,
        "tolerance": None,
        "answer_check": None,
        "starter_code": None,
        "solution_code": None,
        "test_code": None,
    }
    base.update(kw)
    return base


def _analysis(req: LLMRequest) -> dict:
    m = re.search(r"Extracted title: (.+)", req.context + "\n" + req.prompt)
    title = m.group(1).strip() if m else "Untitled paper"
    return {
        "title": title,
        "authors": ["(mock) A. Author"],
        "year": None,
        "field": "Machine learning",
        "one_sentence_summary": f"{NOTE} The paper proposes weighting inputs with a softmax.",
        "problem": "How to combine several values according to learned relevance scores.",
        "key_contributions": ["A softmax-weighted average of values", "A scaling rule for scores"],
        "method_overview": "Scores are turned into weights with softmax; the output is a weighted sum.",
        "key_results": ["Weighted averaging improves accuracy in the mock experiment."],
        "limitations": ["Mock analysis - no real results."],
        "sections": [{"title": "Introduction", "summary": "Motivation."}],
        "key_equations": [
            {"id": "E1", "latex": r"\mathrm{softmax}(z)_i = \frac{e^{z_i}}{\sum_j e^{z_j}}",
             "meaning": "turns scores into positive weights that sum to one", "page": 1}
        ],
        "notation": [{"symbol_latex": "z_i", "meaning": "score of item i"}],
        "prerequisites": [
            {"id": "exponential-function", "name": "The exponential function",
             "why_needed": "softmax exponentiates scores", "level": "foundational"},
            {"id": "weighted-averages", "name": "Weighted averages",
             "why_needed": "the output is a weighted average", "level": "foundational"},
            {"id": "vectors-dot-products", "name": "Vectors and dot products",
             "why_needed": "scores are dot products", "level": "intermediate"},
        ],
        "difficulty": "intermediate",
    }


def _outline(req: LLMRequest) -> dict:
    return {
        "title": "Softmax-Weighted Averages",
        "learning_objectives": [
            "Explain why softmax produces valid weights",
            "Derive the softmax of two scores as a logistic function",
            "Implement a numerically stable softmax in Python",
        ],
        "intuition_md": (
            f"{NOTE}\n\nImagine asking several friends for advice and trusting some more than "
            "others. Softmax turns *how much you trust each friend* into percentages that add up "
            "to 100%, and the final advice is the trust-weighted average."
        ),
        "sections": [
            {"id": "s1", "title": "From scores to weights", "goal": "Understand softmax",
             "paper_sections": ["Introduction"], "key_equation_ids": ["E1"], "figure_ids": [],
             "needs_derivation": True, "needs_worked_example": True},
            {"id": "s2", "title": "Weighted averages in practice", "goal": "Apply the idea",
             "paper_sections": ["Method"], "key_equation_ids": [], "figure_ids": ["F1"],
             "needs_derivation": False, "needs_worked_example": True},
        ],
    }


def _primers(req: LLMRequest) -> dict:
    items = re.findall(r"- \[([^\]]+)\] ([^:\n]+)", req.prompt)
    primers = []
    for pid, name in items:
        primers.append({
            "prerequisite_id": pid,
            "title": name.strip(),
            "intuition_md": f"{NOTE} A quick refresher on {name.strip().lower()}.",
            "explanation_md": "The exponential $e^x$ is always positive and grows quickly.",
            "key_formulas_latex": [r"e^{a+b} = e^a e^b"],
            "example_md": "$e^0 = 1$ and $e^1 \\approx 2.718$.",
            "check_question": _exercise(
                f"primer-{pid}", "multiple_choice",
                prompt_md="Which value is $e^0$?", choices=["0", "1", "e"], correct_choice=1,
                answer_md="1", explanation_md="Any nonzero number to the power 0 equals 1.",
            ),
        })
    return {"primers": primers}


def _section(req: LLMRequest) -> dict:
    m = re.search(r"Section id: (\S+)", req.prompt)
    sid = m.group(1) if m else "s1"
    t = re.search(r"Section title: (.+)", req.prompt)
    title = t.group(1).strip() if t else "Section"
    return {
        "id": sid,
        "title": title,
        "intuition_md": f"{NOTE} Larger scores should get larger, but never negative, weights.",
        "body_md": (
            "Given scores $z_1, \\dots, z_n$, softmax defines\n\n"
            "$$w_i = \\frac{e^{z_i}}{\\sum_{j=1}^n e^{z_j}}$$\n\n"
            "Every $w_i > 0$ and $\\sum_i w_i = 1$, so the $w_i$ are valid weights [@R1]. "
            "The paper introduces this on page 1 [@p1].\n\n{{fig:F1}}\n"
        ),
        "derivations": [{
            "title": "Softmax of two scores is a logistic function",
            "goal_md": "Show that $w_1 = \\sigma(z_1 - z_2)$ where $\\sigma(t) = 1/(1+e^{-t})$.",
            "steps": [
                {"latex": r"w_1 = \frac{e^{z_1}}{e^{z_1} + e^{z_2}}",
                 "explanation_md": "Definition of softmax with $n=2$.",
                 "justification": "definition (E1)", "check": None},
                {"latex": r"w_1 = \frac{1}{1 + e^{z_2 - z_1}}",
                 "explanation_md": "Divide numerator and denominator by $e^{z_1}$.",
                 "justification": "algebra",
                 "check": {"lhs": "exp(z1)/(exp(z1)+exp(z2))", "rhs": "1/(1+exp(z2-z1))"}},
                {"latex": r"w_1 = \sigma(z_1 - z_2)",
                 "explanation_md": "Recognise the logistic function with $t = z_1 - z_2$.",
                 "justification": "definition of the logistic function",
                 "check": {"lhs": "1/(1+exp(z2-z1))", "rhs": "1/(1+exp(-(z1-z2)))"}},
            ],
            "result_latex": r"w_1 = \sigma(z_1 - z_2)",
        }],
        "worked_examples": [{
            "title": "Weights for scores (0, ln 3)",
            "problem_md": "Compute the softmax weights for $z = (0, \\ln 3)$.",
            "solution_steps_md": ["$e^0 = 1$, $e^{\\ln 3} = 3$.", "Sum is $4$, so $w = (1/4, 3/4)$."],
            "answer_md": "$w = (0.25, 0.75)$",
            "check": {"lhs": "exp(log(3))/(exp(0)+exp(log(3)))", "rhs": "3/4"},
        }],
        "check_questions": [
            _exercise(f"{sid}-q1", "multiple_choice",
                      prompt_md="If all scores are equal, what are the softmax weights?",
                      choices=["All 0", "All $1/n$", "All 1"], correct_choice=1,
                      answer_md="All $1/n$",
                      explanation_md="Equal numerators $e^{z}$ divided by $n e^{z}$ give $1/n$."),
        ],
    }


def _wrapup(req: LLMRequest) -> dict:
    return {
        "summary_md": f"{NOTE} Softmax converts arbitrary scores into weights that are positive "
                      "and sum to one; the output is the weighted average of the values.",
        "key_takeaways": ["Softmax weights are positive and sum to 1",
                          "Adding a constant to all scores does not change the weights"],
        "common_misconceptions": ["Softmax is not the same as normalising by the sum of scores"],
        "further_reading": [
            {"title": "Reference R1 of the paper", "authors": "see reference list", "year": None,
             "why": "original source of the idea", "ref_id": "R1"},
        ],
    }


def _practice(req: LLMRequest) -> dict:
    return {"exercises": [
        _exercise("p1", "conceptual", difficulty="easy",
                  prompt_md="Why must softmax weights be positive?",
                  answer_md="Because $e^x > 0$ for every real $x$.",
                  explanation_md="Each weight is a ratio of positive numbers."),
        _exercise("p2", "math", difficulty="medium",
                  prompt_md="Compute $w_1$ for scores $z = (2, 0)$. Give 3 decimals.",
                  answer_md="$w_1 \\approx 0.881$",
                  explanation_md="$w_1 = e^2/(e^2+1) = \\sigma(2) \\approx 0.8808$.",
                  numeric_answer=0.881, tolerance=0.001,
                  answer_check={"lhs": "exp(2)/(exp(2)+1)", "rhs": "0.8808"}),
        _exercise("p3", "python", difficulty="medium",
                  prompt_md="Implement `softmax(z)` for a list of floats. Subtract the maximum "
                            "score first for numerical stability.",
                  answer_md="See the reference solution.",
                  explanation_md="Subtracting $\\max z$ leaves the weights unchanged but avoids overflow.",
                  starter_code="import math\n\ndef softmax(z):\n    # your code here\n    pass\n",
                  solution_code=("import math\n\ndef softmax(z):\n    m = max(z)\n"
                                 "    e = [math.exp(v - m) for v in z]\n    s = sum(e)\n"
                                 "    return [v / s for v in e]\n"),
                  test_code=("w = softmax([0.0, math.log(3)])\n"
                             "assert abs(w[0] - 0.25) < 1e-9 and abs(w[1] - 0.75) < 1e-9\n"
                             "assert abs(sum(softmax([1000.0, 1000.0, 999.0])) - 1) < 1e-9\n")),
    ]}


_HANDLERS = {
    PaperAnalysis: _analysis,
    ChunkNotes: lambda req: {"summary": NOTE, "key_points": [], "key_equations": [],
                             "concepts_used": [], "notation": []},
    ChapterOutline: _outline,
    PrimerSet: _primers,
    ChapterSection: _section,
    ChapterWrapUp: _wrapup,
    PracticeSet: _practice,
}


class MockProvider(LLMProvider):
    async def _complete(self, req: LLMRequest, prompt: str, max_tokens: int) -> RawCompletion:
        handler = _HANDLERS.get(req.schema)
        if handler is None:
            raise NotImplementedError(f"mock has no handler for {req.schema.__name__}")
        text = json.dumps(handler(req))
        usage = Usage(
            calls=1,
            input_tokens=estimate_tokens(req.system + req.context + prompt),
            output_tokens=estimate_tokens(text),
        )
        return RawCompletion(text=text, usage=usage)
