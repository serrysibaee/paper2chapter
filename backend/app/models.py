"""Domain models.

Two families live here:

* **LLM output schemas** (`PaperAnalysis`, `ChapterOutline`, `ChapterSection`, ...). Every field
  is required and has no default, optional values are expressed as nullable. This keeps the JSON
  schemas compatible with the strict structured-output modes of Anthropic, OpenAI, Gemini, Groq
  and Ollama.
* **Stored records** (`PaperRecord`, `Extraction`, `Chapter`, ...), which add bookkeeping fields
  such as verification results and token usage. Verification is kept in a separate mapping so the
  LLM schemas stay small.

Markdown conventions used in every `*_md` field:
  - math: `$inline$` and `$$display$$` (KaTeX-compatible LaTeX)
  - citations: `[@R12]` = reference R12 of the source paper, `[@p4]` = source paper, page 4
  - figures/tables: a line containing only `{{fig:F2}}` or `{{table:T1}}`
"""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- extraction


class PageText(BaseModel):
    page: int
    markdown: str


class Figure(BaseModel):
    id: str
    page: int
    caption: str
    image_file: str
    width: int
    height: int


class Table(BaseModel):
    id: str
    page: int
    caption: str
    markdown: str


class EquationRegion(BaseModel):
    id: str
    page: int
    raw_text: str
    image_file: str | None = None


class Reference(BaseModel):
    id: str
    number: int | None = None
    text: str


class Extraction(BaseModel):
    paper_id: str
    filename: str
    page_count: int
    title_guess: str
    pages: list[PageText]
    figures: list[Figure] = []
    tables: list[Table] = []
    equations: list[EquationRegion] = []
    references: list[Reference] = []
    warnings: list[str] = []

    def full_text(self) -> str:
        return "\n\n".join(f"<!-- page {p.page} -->\n{p.markdown}" for p in self.pages)


# --------------------------------------------------------------------------- LLM schemas: analysis


class Prerequisite(BaseModel):
    id: str = Field(description="short kebab-case slug, e.g. 'linear-algebra-matrix-products'")
    name: str
    why_needed: str = Field(description="where in the paper this concept is used")
    level: Literal["foundational", "intermediate", "advanced"]


class KeyEquation(BaseModel):
    id: str = Field(description="E1, E2, ...")
    latex: str = Field(description="KaTeX-compatible LaTeX, without surrounding $ signs")
    meaning: str
    page: int | None


class NotationEntry(BaseModel):
    symbol_latex: str
    meaning: str


class PaperSectionSummary(BaseModel):
    title: str
    summary: str


class ChunkNotes(BaseModel):
    """Map-step output used when a paper does not fit into a single request."""

    summary: str
    key_points: list[str]
    key_equations: list[KeyEquation]
    concepts_used: list[str]
    notation: list[NotationEntry]


class PaperAnalysis(BaseModel):
    title: str
    authors: list[str]
    year: str | None
    field: str
    one_sentence_summary: str
    problem: str
    key_contributions: list[str]
    method_overview: str
    key_results: list[str]
    limitations: list[str]
    sections: list[PaperSectionSummary]
    key_equations: list[KeyEquation]
    notation: list[NotationEntry]
    prerequisites: list[Prerequisite]
    difficulty: Literal["introductory", "intermediate", "advanced"]


# --------------------------------------------------------------------------- LLM schemas: chapter


class SympyCheck(BaseModel):
    """Machine-checkable claim `lhs == rhs`, written in SymPy/Python syntax (e.g. `x**2 + 2*x`)."""

    lhs: str
    rhs: str


class OutlineSection(BaseModel):
    id: str
    title: str
    goal: str
    paper_sections: list[str]
    key_equation_ids: list[str]
    figure_ids: list[str]
    needs_derivation: bool
    needs_worked_example: bool


class ChapterOutline(BaseModel):
    title: str
    learning_objectives: list[str]
    intuition_md: str = Field(description="big-picture intuition before any formalism")
    sections: list[OutlineSection]


class Exercise(BaseModel):
    id: str
    kind: Literal["conceptual", "multiple_choice", "math", "python"]
    difficulty: Literal["easy", "medium", "hard"]
    prompt_md: str
    choices: list[str] = Field(description="answer options for multiple_choice, otherwise []")
    correct_choice: int | None = Field(description="0-based index for multiple_choice, else null")
    answer_md: str = Field(description="the correct answer, stated concisely")
    explanation_md: str = Field(description="why the answer is correct; worked solution")
    numeric_answer: float | None = Field(description="for math exercises with a numeric answer")
    tolerance: float | None = Field(description="absolute tolerance for numeric_answer")
    answer_check: SympyCheck | None = Field(
        description="for math: lhs computes the answer from the problem data, rhs is the answer"
    )
    starter_code: str | None = Field(description="python only: code skeleton for the learner")
    solution_code: str | None = Field(description="python only: complete reference solution")
    test_code: str | None = Field(description="python only: assert-based tests run after the code")


class DerivationStep(BaseModel):
    latex: str = Field(description="the expression after this step, no surrounding $ signs")
    explanation_md: str
    justification: str = Field(description="rule used, e.g. 'chain rule', 'definition of E2'")
    check: SympyCheck | None = Field(
        description="optional machine check that this step follows, in SymPy syntax"
    )


class Derivation(BaseModel):
    title: str
    goal_md: str
    steps: list[DerivationStep]
    result_latex: str


class WorkedExample(BaseModel):
    title: str
    problem_md: str
    solution_steps_md: list[str]
    answer_md: str
    check: SympyCheck | None


class ChapterSection(BaseModel):
    id: str
    title: str
    intuition_md: str
    body_md: str
    derivations: list[Derivation]
    worked_examples: list[WorkedExample]
    check_questions: list[Exercise]


class PrimerSection(BaseModel):
    prerequisite_id: str
    title: str
    intuition_md: str
    explanation_md: str
    key_formulas_latex: list[str]
    example_md: str
    check_question: Exercise


class PrimerSet(BaseModel):
    primers: list[PrimerSection]


class FurtherReading(BaseModel):
    title: str
    authors: str
    year: str | None
    why: str
    ref_id: str | None = Field(description="R-id if this item is in the paper's reference list")


class ChapterWrapUp(BaseModel):
    summary_md: str
    key_takeaways: list[str]
    common_misconceptions: list[str]
    further_reading: list[FurtherReading]


class PracticeSet(BaseModel):
    exercises: list[Exercise]


# --------------------------------------------------------------------------- stored records


class Usage(BaseModel):
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float | None = 0.0

    def add(self, other: "Usage") -> None:
        self.calls += other.calls
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_read_tokens += other.cache_read_tokens
        self.cache_write_tokens += other.cache_write_tokens
        if self.cost_usd is None or other.cost_usd is None:
            self.cost_usd = None
        else:
            self.cost_usd = round(self.cost_usd + other.cost_usd, 6)


VerificationStatus = Literal["verified", "failed", "error", "skipped"]


class VerificationResult(BaseModel):
    status: VerificationStatus
    method: str
    detail: str = ""


class GenerationOptions(BaseModel):
    audience: Literal["high-school", "undergraduate", "graduate", "practitioner"] = "undergraduate"
    known_prerequisites: list[str] = []
    focus: str = ""
    include_python: bool = True


class Chapter(BaseModel):
    paper_id: str
    title: str
    generated_at: str = Field(default_factory=utcnow)
    provider: str
    model: str
    options: GenerationOptions
    paper_title: str
    paper_authors: list[str]
    learning_objectives: list[str]
    intuition_md: str
    primers: list[PrimerSection]
    sections: list[ChapterSection]
    summary_md: str
    key_takeaways: list[str]
    common_misconceptions: list[str]
    practice: list[Exercise]
    further_reading: list[FurtherReading]
    references: list[Reference]
    figures: list[Figure]
    tables: list[Table]
    notation: list[NotationEntry]
    verification: dict[str, VerificationResult] = {}
    warnings: list[str] = []
    usage: Usage = Usage()


JobKind = Literal["extract", "analyze", "generate"]
PaperStatus = Literal[
    "uploaded", "extracting", "extracted", "analyzing", "analyzed", "generating", "ready", "failed"
]


class JobState(BaseModel):
    kind: JobKind
    status: Literal["running", "succeeded", "failed"] = "running"
    stage: str = ""
    progress: float = 0.0
    message: str = ""
    error: str | None = None
    started_at: str = Field(default_factory=utcnow)
    finished_at: str | None = None
    log: list[str] = []


class PaperRecord(BaseModel):
    id: str
    filename: str
    created_at: str = Field(default_factory=utcnow)
    status: PaperStatus = "uploaded"
    title: str = ""
    page_count: int = 0
    job: JobState | None = None
    has_analysis: bool = False
    has_chapter: bool = False
    usage: Usage = Usage()
