# Architecture

```
frontend/ (Next.js 16, TypeScript)          backend/ (FastAPI, Python 3.11+)
  /               library + upload   --->     POST /api/papers           -> extract job
  /papers/[id]    analysis, prereqs  --->     POST .../analyze           -> analyze job
                                     --->     POST .../generate          -> generate job
  /papers/[id]/chapter  reader       <---     GET  .../chapter, assets, export.html
  /settings       provider/model     <-->     GET/PUT /api/settings
  Pyodide worker (learner code, in browser)

obsidian-plugin/ (TypeScript)               the same API, plus
  PDF in the vault -> upload, poll    --->     GET .../export.md           -> one Markdown note
                                      --->     GET .../export.parts        -> its pieces, for a template
  note + attachments in the vault     <---     GET .../assets/{name}
  starts/stops uvicorn (desktop)               GET /api/providers/{id}/check

backend/app/llm/cli_provider.py  --stdin-->  claude -p  |  codex exec   (subscription sign-in)
```

## Backend modules

| Module | Responsibility |
|---|---|
| `pdf_extract.py` | PyMuPDF + pymupdf4llm layout analysis: per-page Markdown, figure crops (vector and raster), tables as Markdown, formula regions, reference list |
| `pipeline/` | Orchestration and prompts. Analyze (map-reduce for long papers), then outline, primers, sections, practice set and wrap-up, then verify and repair |
| `llm/` | Provider abstraction: `LLMProvider.generate(request) -> validated Pydantic object`. Anthropic SDK, one OpenAI-compatible client (OpenAI, Gemini, Groq, OpenRouter, Ollama, custom), two subscription providers that drive the Claude Code and Codex CLIs (`cli_provider.py`, `cli_runner.py`), and a mock |
| `verify/` | SymPy identity checks (in a child process), Python sandbox (Docker or subprocess), citation and placeholder resolution |
| `export.py` | Self-contained HTML (figures inlined, KaTeX, print stylesheet) |
| `export_md.py` | One Markdown note, Obsidian-flavoured (callouts, embeds, page links) or CommonMark, with model output made inert; or the same note as its parts (`export.parts`: each fragment inert, with the paper's metadata and prerequisites, and since 0.4.0 every exercise as data for flashcards and the plugin's chapter manifest), built by the same renderer. Page links go to the PDF in the vault or follow a URL template (`page_link`, e.g. Zotero's `zotero://open-pdf/…?page={page}`) |
| `identifiers.py` | A paper's DOI and arXiv id, when its first page prints them |
| `watchdog.py` | Ends a plugin-started backend once the Obsidian process that started it is gone |
| `storage.py` / `jobs.py` | JSON files per paper; asyncio background jobs with progress saved to disk |

## Key decisions and trade-offs

**One schema-validated object per LLM call.** Each step (analysis, outline, each section, ...) returns
one Pydantic-validated JSON object. This keeps every output within token limits, makes failures local
(a bad section is retried, not the whole chapter), and lets independent sections run in parallel.
Schemas are normalised to the strict subset all providers accept (`llm/schema.py`). If a provider
rejects strict schemas, the client falls back to JSON mode and then to schema-in-prompt. The result is
always validated, and invalid output gets up to two repair attempts with the validation errors fed back.

**Prerequisites as an explicit step.** Analysis lists the concepts the paper relies on. The reader
ticks what they already know, and primers teach the rest before the chapter (up to 6, foundational
first). Section prompts are told what the primers cover so they build on it rather than repeat it.

**Verification is evidence, not proof, and the UI says so.**
- Math: the model attaches optional `lhs == rhs` checks in SymPy syntax to derivation steps, worked
  examples and numeric exercises. They are evaluated numerically at random points. This is fast,
  cannot hang in `simplify`, and catches algebra slips. Expressions go through a whitelist (no
  attribute access, no dunders, only known functions) because `parse_expr` uses `eval` and model
  output can be steered by text in the PDF. Checks run in a child process with a timeout.
- Python: each reference solution is run against its own tests in the server sandbox. Failing
  exercises get one automatic repair attempt and are re-run. If the repair also fails, the exercise is
  shown with a red badge rather than hidden.
- Citations: `[@R12]` must exist in the extracted reference list and `[@p4]` must be a real page.
  Unknown keys are rewritten to visible "unresolved" markers. Model-suggested further reading that is
  not in the paper is labelled as unverified.

**Two sandboxes for two threat models.**
- *Learner code* runs only in the browser (Pyodide/WebAssembly in a Web Worker, killed on timeout).
  It never reaches the server.
- *LLM-generated reference solutions* run on the server, because their correctness has to be checked
  before showing them. With Docker (`sandbox/Dockerfile`) they run with no network, a read-only root,
  dropped capabilities, a non-root user, and memory/CPU/PID limits. Without Docker, a subprocess
  fallback uses isolated mode, a scrubbed environment, a temp working dir, a timeout, POSIX rlimits and
  an AST import allowlist. That is **not** an isolation boundary; it is meant for single-user local
  use, and the Settings page says so.

**Equations.** PDF text cannot be turned back into LaTeX reliably. The extractor keeps raw formula text
and a cropped image of each formula region. The analysis step reconstructs LaTeX. Providers that read
PDFs natively (Anthropic) receive the original file for this step (`USE_NATIVE_PDF`).

**Context management.** If the paper fits the provider's input budget, every call gets the full text,
and Anthropic/OpenAI prompt caching makes the repeats cheap. Otherwise analysis does map-reduce over
chunks, and each section gets the pages most relevant to it (keyword overlap). Small-context
providers (Groq free, Ollama) have explicit per-request budgets, and Groq free also gets client-side
tokens-per-minute pacing.

**Storage and jobs.** JSON files and in-process asyncio tasks are enough for a single-user MVP and
need no infrastructure. A restart marks running jobs as failed (retry from the UI). Moving to a
database and a task queue is a contained change (`storage.py`, `jobs.py`).

**PDF export.** HTML export is self-contained. PDF export uses the browser's print-to-PDF with a print
stylesheet, which renders KaTeX exactly as on screen. Server-side PDF (WeasyPrint/Playwright) would
add heavy native dependencies, especially on Windows.

**Licensing.** PyMuPDF/pymupdf4llm are AGPL-3.0 (or commercial). That is fine for local or open-source
use. Hosting a closed-source service needs a commercial licence or a swap of `pdf_extract.py` for a
permissively licensed parser. The interface is a single function.

**Subscriptions through the vendors' CLIs.** A Claude or ChatGPT plan has no API key, but its CLI
(Claude Code, Codex) signs in with it and runs headless. `CLIProvider._complete()` starts the CLI per
request in an empty temp directory and feeds the prompt on stdin; the rest of `generate()` (repairs,
schema downgrade, usage) is unchanged. Choices: stdin and temp files only, because Windows npm shims
go through cmd.exe and its 8,191-character limit (shims are resolved to `node <script>`); no tools,
MCP servers or project settings, so a paper's text cannot steer an agent into acting; API keys
stripped from the child's environment, so the plan is used rather than an API account; Codex's
`--output-schema` for strict JSON, Claude Code's `--json-schema` when the installed version has it
(feature-detected from `--help`, like `--tools`, `--effort` and `--no-session-persistence`), else the
schema in the prompt; a per-job concurrency cap because
plans have rate limits. Usage is recorded with a price of zero and shown as included in the plan.
Tests run a fake CLI (`tests/fake_cli.py`) that records its arguments, stdin and environment.

**Obsidian plugin as a client.** The plugin keeps the backend's extraction and verification rather
than re-implementing them in TypeScript. It talks to the same API through Obsidian's `requestUrl`
(no CORS; multipart built by hand), can start `uvicorn` from the backend folder, and writes the
`export.md` result as one note. Generation is owned by the plugin, not the modal, so closing the
window does not lose the chapter. The paper id is cached per PDF path with the file's size and mtime,
so an unchanged PDF reuses its extraction and analysis. Because community plugins can execute code
found in notes (Templater tags, DataviewJS blocks), Markdown export escapes HTML, breaks Templater
and Dataview inline syntax, and demotes code blocks outside a language allow-list to plain text.

## Known limitations

- Scanned PDFs need OCR (pymupdf4llm uses RapidOCR if installed); otherwise there is almost no text.
- Figure captions are matched by layout proximity and can occasionally be attached to the wrong figure.
- Verification covers scalar identities, numeric answers, Python tests and citation existence. It
  cannot check the correctness of prose explanations or matrix/vector derivations. Those steps show
  no badge, or "not checkable".
- Quality depends heavily on the model. Free and small models produce more failed checks.
- Single-user: no authentication. Do not expose the backend to the internet as-is.
- Subscription providers depend on the CLIs' headless interfaces, which change between versions;
  the provider feature-detects what it can and falls back to schema-in-prompt.
