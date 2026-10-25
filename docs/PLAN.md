# Plan: subscription providers and an Obsidian plugin

Started 2026-10-25. This file is the tracker: each item is ticked in the commit that finishes it.

## Goals

1. **Use a Claude or ChatGPT subscription, not only API keys.** A Claude Pro/Max or ChatGPT
   Plus/Pro user should be able to generate chapters without buying API credits.
2. **An Obsidian plugin.** Turn a PDF in a vault into a chapter note in the same vault, without
   leaving Obsidian.

Both must keep what makes the tool trustworthy: schema-validated output, repair loops, SymPy and
sandbox verification, citation checks, and no paid call in the test suite.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Subscriptions are reached through the vendors' own CLIs, run headless: **Claude Code** (`claude -p`) for Claude, **Codex** (`codex exec`) for ChatGPT. | Both CLIs sign in with the subscription and are the vendors' supported way to use it from scripts. The app never sees an OAuth token, never stores one, and never imitates a client. |
| D2 | A new provider kind, `cli`, beside `anthropic`, `openai_compat` and `mock`. The pipeline is untouched: a CLI provider implements `_complete()` like any other. | Repairs, schema downgrade, usage accounting and verification all live in `LLMProvider.generate()` and keep working. |
| D3 | Structured output: Codex gets `--output-schema` (strict JSON Schema). Claude Code gets `--json-schema` when the installed CLI has it, else the schema in the prompt. The result is validated either way. | Older Claude Code builds (2.0.x) lack `--json-schema`; the existing `prompt` mode plus validation covers them. |
| D4 | Every prompt, schema and context goes through **stdin or a temp file**, never the command line. On Windows an npm `.cmd` shim is resolved to `node <script>` so cmd.exe never parses arguments. | cmd.exe caps a command at 8,191 characters and mangles quotes and newlines; a paper is ~40K characters. |
| D5 | The CLI runs in an empty temp directory, with no tools (Claude: tools disallowed; Codex: read-only sandbox), no MCP servers, no project settings, ephemeral session. Claude may optionally read the PDF itself (`--allowedTools Read` on `./paper.pdf` only) for equation fidelity. | The model must generate text, not act on the machine. A paper's text could otherwise steer an agent with tools. |
| D6 | Subscription calls are free at the margin: tier `subscription`, cost shown as "included in your plan", not dollars. Concurrency is capped (default 2) because plans have rate limits, not token bills. | A dollar estimate would mislead; a burst of five parallel sections can hit a plan's limit. |
| D7 | The plugin is a **client of the existing backend** and can start it itself on desktop. | Keeps PyMuPDF extraction, SymPy checks and the Python sandbox. A TypeScript port would lose them. |
| D8 | A chapter becomes **one note**: frontmatter, primers, sections, display math, figures embedded from an `attachments/` folder beside the note, exercises in callouts with folded answers, citations linked to the PDF's page in the vault. Rendering happens in the backend (`export_md.py`), so it is tested in Python and usable outside Obsidian. | One note is easy to read, move and link; the backend already owns every other export. |
| D9 | Work lands on `main` of `serrysibaee/paper2chapter` (owner's contributor decision, 2026-10-25). Tags and GitHub releases are created only on an explicit go-ahead. | |

## Phases

### P0. Baseline
- [x] Clone, create the backend venv, run the suite: 80 passed, 1 skipped.
- [x] Prove both CLIs headless on this machine: `claude -p --output-format json` returns a JSON
      result with usage; `codex exec --output-schema … --json` runs (its ChatGPT login must be
      refreshed with `codex login`).

### P1. Subscription providers (backend)
- [x] `app/llm/cli_runner.py`: find a CLI (env override, PATH, npm shim → node script), run it
      with stdin, a timeout and a process-tree kill, capture stdout/stderr.
- [x] `app/llm/cli_provider.py`: `ClaudeCodeProvider` and `CodexProvider` on a shared
      `CLIProvider` base (temp dir, semaphore, error mapping: not installed, not signed in,
      plan limit reached, timeout, refusal).
- [x] Registry presets `claude-cli` ("Claude subscription") and `codex-cli` ("ChatGPT
      subscription"): models, tier `subscription`, `max_concurrency`, readiness = CLI found.
- [x] Pipeline reads `preset.max_concurrency`; estimate and settings API report subscription
      models as included, not priced.
- [x] Config: `CLAUDE_CLI_PATH`, `CODEX_CLI_PATH`, `CLI_TIMEOUT_S`, `CLI_MAX_CONCURRENCY`,
      `CLAUDE_CLI_READ_PDF`; `.env.example` documents them.
- [x] `GET /api/providers/{id}/check`: runs the CLI's version (and Codex's `login status`) so the
      UI can say "not installed" or "sign in first" before a job fails.
- [x] Frontend Settings: the `subscription` tier label, the CLI readiness message and the check
      button.

### P2. Markdown export (backend)
- [x] `app/export_md.py`: chapter → Obsidian-flavoured Markdown (frontmatter, `$$` math,
      callouts, folded solutions, verification marks, figure embeds with a caller-given prefix,
      tables, citations to `[[paper.pdf#page=N]]` or plain `p. N`, references list).
- [x] `GET /api/papers/{id}/export.md` with `solutions`, `asset_prefix`, `pdf_link`, `flavor`
      (`obsidian` | `commonmark`), returning the Markdown and the list of assets it embeds.

### P3. Obsidian plugin (`obsidian-plugin/`)
- [x] Scaffold: TypeScript, esbuild, `manifest.json`, `versions.json`, styles, desktop-only.
- [x] API client on `requestUrl` (multipart upload built by hand, job polling with backoff).
- [x] Backend manager: health check, start `uvicorn` from the configured backend folder and
      Python, stop on unload, show its log on failure.
- [x] Settings tab: backend URL and folder, auto-start, output folder, provider / model / effort
      (read from and saved to the backend), audience, Python exercises, solutions.
- [x] Commands and menus: "Generate chapter from this PDF" (active file and file menu),
      "Generate chapter from a PDF…" (picker), "Start/stop backend", "Open the paper2chapter app".
- [x] Generate modal: upload → extract → analyze → tick known prerequisites (with cost or
      "included in your plan") → generate, with stage, progress and cancel-safe errors.
- [x] Writer: note and attachments into the output folder, never overwriting (suffix instead),
      then open the note.

### P4. Testing
- [x] Backend unit tests with **fake CLIs** (small Python scripts that act as `claude` and
      `codex`): argument building, stdin, schema modes, usage parsing, every error path, timeout,
      Windows shim resolution. No real CLI is called by `pytest`.
- [x] Backend tests for `export_md.py` on the mock chapter (math, callouts, embeds, citations,
      no raw HTML) and for the new endpoints.
- [x] Plugin unit tests (`node --test`, no extra runner) with a stubbed `obsidian` module: multipart
      body, job polling, file naming, the writer on an in-memory vault, the backend manager, the run;
      plus an end-to-end test where the plugin's backend manager starts the real backend (mock
      provider) and a sample paper becomes a note.
- [x] Plugin build and `tsc --noEmit` clean.
- [x] Live smoke, run by hand (`backend/scripts/smoke_cli.py`): a real paper through
      `claude-cli` and `codex-cli` end to end; results recorded below.
- [x] Plugin end to end: the built plugin in a scratch vault against the running backend.

### P5. Documentation
- [x] README: subscriptions in the provider list and quick start; the plugin section.
- [x] `docs/PROVIDERS.md`: a subscription section (setup, limits, what it costs, terms).
- [x] `docs/OBSIDIAN.md`: install, settings, workflow, the note format, troubleshooting.
- [x] `obsidian-plugin/README.md`; `docs/ARCHITECTURE.md`: the CLI provider and the plugin.
- [x] `CHANGELOG.md`.

### P6. Production
- [x] CI (`.github/workflows/ci.yml`): backend pytest, frontend test/typecheck/build, plugin
      test/build, on push and pull request.
- [x] Release workflow (`plugin-release.yml`): on a tag that is the plugin version (`0.1.0`, the form
      Obsidian and BRAT expect), build and attach `main.js`, `manifest.json`, `styles.css`; root
      `manifest.json` and `versions.json`, kept in step by `npm version` and checked in CI.
- [x] Versions: backend 0.2.0, plugin 0.1.0.
- [x] Push to `main` (2026-10-25).
- [x] Tag `0.1.0` (go-ahead given 2026-10-25): the release workflow published
      https://github.com/serrysibaee/paper2chapter/releases/tag/0.1.0 with `main.js`, `manifest.json`
      and `styles.css`, byte-identical to a local build of the same commit.
- [ ] Submission to Obsidian's community directory: the repository owner's step.

### P7. Closing the gaps (owner's request, 2026-10-25)
- [x] The web Settings page checked in a browser: the subscription tier, *your plan* / *included*,
      **Check CLI** (`2.0.27 (Claude Code): Installed…`), the saved selection, *included in your plan*
      on a paper's page; no console errors. The intro now mentions subscriptions.
- [x] Plugin lint clean, 0 warnings: the settings tab on the declarative settings API (Obsidian
      1.13+, found by the settings search), UI text in sentence case, `fetch` allowed in Node-only tests.
      `minAppVersion` 1.13.0, plugin version 0.1.1.
- [x] Claude Code's `--json-schema` path, live, with Claude Code 2.1.310 installed in a scratch folder
      (the global 2.0.27 left alone).
- [x] Claude reading the PDF itself (`CLAUDE_CLI_READ_PDF`), live, on 2.1.310 and 2.0.27.
- [x] The watchdog when the Obsidian window closes, live, and isolated in a real server process.
- [x] Codex through the Obsidian plugin, live.
- macOS and Linux by hand: not possible here; CI runs every suite on Linux.

## Risks

| Risk | Mitigation |
|---|---|
| Vendor terms: a consumer subscription is for its holder. | Docs say: personal use on your own machine, your own CLI and login; do not host the backend for others with your subscription. |
| CLI flags drift between versions. | Feature detection from `--help`, cached per binary; fallbacks to schema-in-prompt; fake-CLI tests pin the contract we rely on. |
| Plan rate limits mid-chapter. | Concurrency cap, a clear "plan limit reached" error, and the existing per-job retry from the UI. |
| User hooks or MCP servers leaking into headless runs. | `--setting-sources` without project/local, `--strict-mcp-config`, empty temp cwd, ephemeral sessions. |
| Long generations. | Per-call timeout (default 15 min) and process-tree kill. |

## Results log

| Date | What | Result |
|---|---|---|
| 2026-10-25 | Baseline suite | 80 passed, 1 skipped |
| 2026-10-25 | Backend after P1-P2 | 108 passed, 1 skipped (21 fake-CLI tests, 7 Markdown export tests) |
| 2026-10-25 | Plugin | 24 tests (incl. end to end on the real backend), tsc and lint clean (0 errors), main.js 25 KB |
| 2026-10-25 | Live: `codex-cli` / `gpt-6-luna` (Codex CLI 0.164.0, ChatGPT sign-in), the sample paper | ready in 95 s, 10 requests; checks 14 verified, 0 failed; 0 unresolved citations. Codex adds ~15K tokens of its own instructions per request |
| 2026-10-25 | Live in Obsidian 1.15.0 (scratch vault `C:\Vaults\p2c-test`), `claude-cli` / `haiku` | Connect started the backend; both CLIs listed as set up; Check the CLI and Save model worked; file menu → Generate a chapter → prerequisites → Generate; modal closed mid-run and the note was still written and opened (16K words, 1 figure embedded, 37 page links, 30 exercises with folded solutions; math, callouts and properties render). Disabling the plugin stopped the backend it started |
| 2026-10-25 | Found in Obsidian and fixed | the Connection line reset after re-render; long model labels squeezed the setting name; raw `[@p1]` in prerequisite text; a window reload orphaned the backend (fixed by a parent-PID watchdog: the backend exits when the Obsidian process that started it is gone) |
| 2026-10-25 | Web Settings page in the browser (Next dev + backend) | renders as designed; Check CLI works; *included in your plan* on the paper page; no console errors |
| 2026-10-25 | Live: `claude-cli` / `haiku`, Claude Code 2.1.310 (native `claude.exe`) | `--json-schema`, `--tools ""`, `--effort`, `--no-session-persistence` used (reply in `structured_output`, no schema in the prompt); chapter in 220 s, 10 requests, no repairs, 26 verified, 0 failed, 0 unresolved |
| 2026-10-25 | Found and fixed | Claude Code 2.1's npm shim runs `claude.exe`, which the shim resolver did not recognise (it would have gone through cmd.exe); local `.bin` shims (`%dp0%\..\`) too |
| 2026-10-25 | Live: `CLAUDE_CLI_READ_PDF=true` | chapter in 268 s, 25 verified, 0 failed; given only the file, Claude answered a table value, a reference author and a figure caption correctly, on 2.1.310 and on 2.0.27 |
| 2026-10-25 | Live in Obsidian: watchdog | the backend logged `watching parent process 17396` (the vault window's renderer); after a reload (plugin no longer owns it), closing that window left nothing running within 2 s; other Obsidian windows untouched. Isolated: a real server exited 4.8 s after its stand-in parent was killed, logging why |
| 2026-10-25 | Live in Obsidian: `codex-cli` / `gpt-6-luna` through the plugin, plugin 0.1.1 | the cached analysis was reused (ready in 6 s); note written as `… 2.md` beside the first (no overwrite), 7.6K words, 23 exercises, figure embedded; declarative settings tab, provider switch re-render and settings search for *subscription* all work |
| 2026-10-25 | Frontend after P1 | 19 tests passed, typecheck and build clean |
| 2026-10-25 | Live: `claude-cli` / `haiku` (Claude Code 2.0.27, signed in with a Claude plan), the 3-page sample paper | ready in 260 s, 13 requests, 34K in / 38K out tokens; checks 19 verified, 1 failed; 11 unresolved citations flagged (section/equation refs written as citations) |
