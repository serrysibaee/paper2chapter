// Mirrors backend/app/models.py (keep in sync).

export type PaperStatus =
  | "uploaded" | "extracting" | "extracted" | "analyzing" | "analyzed" | "generating" | "ready" | "failed";

export interface Usage {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number | null;
}

export interface JobState {
  kind: "extract" | "analyze" | "generate";
  status: "running" | "succeeded" | "failed";
  stage: string;
  progress: number;
  message: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  log: string[];
}

export interface PaperRecord {
  id: string;
  filename: string;
  created_at: string;
  status: PaperStatus;
  title: string;
  page_count: number;
  job: JobState | null;
  has_analysis: boolean;
  has_chapter: boolean;
  usage: Usage;
}

export interface Figure { id: string; page: number; caption: string; image_file: string; width: number; height: number }
export interface Table { id: string; page: number; caption: string; markdown: string }
export interface Reference { id: string; number: number | null; text: string }

export interface ExtractionSummary {
  paper_id: string;
  filename: string;
  page_count: number;
  title_guess: string;
  figures: Figure[];
  tables: Table[];
  equations: { id: string; page: number; raw_text: string; image_file: string | null }[];
  references: Reference[];
  warnings: string[];
  text_tokens: number;
}

export interface Prerequisite {
  id: string;
  name: string;
  why_needed: string;
  level: "foundational" | "intermediate" | "advanced";
}
export interface KeyEquation { id: string; latex: string; meaning: string; page: number | null }
export interface NotationEntry { symbol_latex: string; meaning: string }

export interface PaperAnalysis {
  title: string;
  authors: string[];
  year: string | null;
  field: string;
  one_sentence_summary: string;
  problem: string;
  key_contributions: string[];
  method_overview: string;
  key_results: string[];
  limitations: string[];
  sections: { title: string; summary: string }[];
  key_equations: KeyEquation[];
  notation: NotationEntry[];
  prerequisites: Prerequisite[];
  difficulty: "introductory" | "intermediate" | "advanced";
}

export interface SympyCheck { lhs: string; rhs: string }

export interface Exercise {
  id: string;
  kind: "conceptual" | "multiple_choice" | "math" | "python";
  difficulty: "easy" | "medium" | "hard";
  prompt_md: string;
  choices: string[];
  correct_choice: number | null;
  answer_md: string;
  explanation_md: string;
  numeric_answer: number | null;
  tolerance: number | null;
  answer_check: SympyCheck | null;
  starter_code: string | null;
  solution_code: string | null;
  test_code: string | null;
}

export interface DerivationStep { latex: string; explanation_md: string; justification: string; check: SympyCheck | null }
export interface Derivation { title: string; goal_md: string; steps: DerivationStep[]; result_latex: string }
export interface WorkedExample { title: string; problem_md: string; solution_steps_md: string[]; answer_md: string; check: SympyCheck | null }

export interface ChapterSection {
  id: string;
  title: string;
  intuition_md: string;
  body_md: string;
  derivations: Derivation[];
  worked_examples: WorkedExample[];
  check_questions: Exercise[];
}

export interface PrimerSection {
  prerequisite_id: string;
  title: string;
  intuition_md: string;
  explanation_md: string;
  key_formulas_latex: string[];
  example_md: string;
  check_question: Exercise;
}

export interface FurtherReading { title: string; authors: string; year: string | null; why: string; ref_id: string | null }

export interface VerificationResult { status: "verified" | "failed" | "error" | "skipped"; method: string; detail: string }

export type Audience = "high-school" | "undergraduate" | "graduate" | "practitioner";

export interface GenerationOptions {
  audience: Audience;
  known_prerequisites: string[];
  focus: string;
  include_python: boolean;
}

export interface Chapter {
  paper_id: string;
  title: string;
  generated_at: string;
  provider: string;
  model: string;
  options: GenerationOptions;
  paper_title: string;
  paper_authors: string[];
  learning_objectives: string[];
  intuition_md: string;
  primers: PrimerSection[];
  sections: ChapterSection[];
  summary_md: string;
  key_takeaways: string[];
  common_misconceptions: string[];
  practice: Exercise[];
  further_reading: FurtherReading[];
  references: Reference[];
  figures: Figure[];
  tables: Table[];
  notation: NotationEntry[];
  verification: Record<string, VerificationResult>;
  warnings: string[];
  usage: Usage;
}

export interface ModelOption {
  id: string;
  label: string;
  tier: "free" | "free-tier" | "paid" | "local";
  context_tokens: number;
  input_price: number | null;
  output_price: number | null;
  cache_read_price: number | null;
  notes: string;
  typical_chapter_cost_usd: number | null;
}

export interface ProviderOption {
  id: string;
  label: string;
  kind: string;
  configured: boolean;
  api_key_env: string | null;
  key_required: boolean;
  free_note: string;
  pricing_note: string;
  docs_url: string;
  supports_pdf: boolean;
  models: ModelOption[];
}

export interface AppSettings {
  selection: { provider: string; model: string; effort: "low" | "medium" | "high" };
  providers: ProviderOption[];
  sandbox: { backend: string; isolated: boolean };
  native_pdf: boolean;
}

export interface Estimate {
  provider: string;
  model: string;
  tier: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  cost_with_cache_usd: number | null;
}
