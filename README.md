# paper2chapter

Turn a research-paper PDF into a textbook-style chapter: intuition first, prerequisite primers for
the background you're missing, step-by-step derivations, worked examples, in-chapter questions, and a
practice set (conceptual, math and Python) with solutions. Math, numeric answers, Python solutions and
citations are checked automatically where possible.

**Flow:** upload PDF → extract (text, figures, tables, equations, references) → analyze (summary, key
equations, prerequisites) → tick what you already know → generate chapter → read, do exercises, export
HTML/PDF.

- Backend: Python + FastAPI (`backend/`)
- Frontend: Next.js 16 + TypeScript (`frontend/`)
- **Obsidian plugin** (`obsidian-plugin/`): right-click a PDF in your vault, get a chapter note. See
  [docs/OBSIDIAN.md](docs/OBSIDIAN.md).
- LLMs: **your Claude Pro/Max or ChatGPT Plus/Pro subscription** (through the Claude Code or Codex
  CLI, no API key), Anthropic, OpenAI, Google Gemini, Groq, OpenRouter, Ollama, any OpenAI-compatible
  server, or a built-in mock. See [docs/PROVIDERS.md](docs/PROVIDERS.md) for models, free tiers and
  cost per chapter.
- Design and trade-offs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Quick start

Requirements: Python 3.11+, Node.js 20+. Docker is optional (recommended sandbox).

```bash
# 1. configuration
cp .env.example .env          # add an API key, or keep LLM_PROVIDER=mock to try the app offline

# 2. backend
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows; on macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 3. frontend (new terminal)
cd frontend
npm install
npm run dev                   # http://localhost:3000
```

Set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` if the backend is not at `http://localhost:8000`.

**Choosing a model:** open **Settings** in the app. Providers show "ready" when their API key variable
is set (restart the backend after editing `.env`). Keys are only read from the environment and are never
stored or returned by the API.

**Using a subscription instead of an API key:** sign in once with the vendor's CLI, then pick the
provider in Settings.

```bash
# Claude Pro/Max: install Claude Code (https://claude.com/claude-code), then
claude            # and /login with your Claude account
# ChatGPT Plus/Pro:
npm install -g @openai/codex
codex login
```

Requests then count against your plan's usage limits instead of an API bill. The CLI runs headless
with no tools, and the app never sees your sign-in. For your own use on your own machine; see
[docs/PROVIDERS.md](docs/PROVIDERS.md#subscriptions-claude-code-and-codex).

## Obsidian

Set up the backend as above (you need not start it), install the plugin from `obsidian-plugin/` (or
with BRAT from this repository), set *Backend folder* in its settings, and right-click any PDF in your
vault → **Generate a chapter**. The plugin starts the backend, asks which prerequisites you already
know, and writes one note with figures, math, folded solutions and links back to the PDF's pages.
Full guide: [docs/OBSIDIAN.md](docs/OBSIDIAN.md).

**Optional: Docker sandbox** for running generated Python solutions in an isolated container:

```bash
docker build -t paper2chapter-sandbox sandbox/
```

With `SANDBOX_BACKEND=auto` (default), the backend uses the container when the image exists and
otherwise falls back to a restricted local subprocess. The fallback is not an isolation boundary; see
the architecture doc.

## Tests

```bash
cd backend && .venv/Scripts/python -m pytest      # extraction, schemas, LLM retry logic, subscription
                                                  # CLIs (against a fake CLI), Markdown export, math
                                                  # checks, sandbox, citations, full API flow (mock)
cd frontend && npm test && npm run typecheck && npm run build
cd obsidian-plugin && npm test && npm run lint && npm run build   # includes an end-to-end run
                                                  # against the real backend (mock provider)
```

Tests always use the mock provider and never call paid APIs or a real CLI. To run one real paper
end to end with a provider you have, use `backend/scripts/smoke_cli.py --provider claude-cli`
(or `codex-cli`, or any other id). To also run extraction against a real
paper: `P2C_SAMPLE_PDF=/path/to/paper.pdf pytest tests/test_extract.py`.

## Notes

- **Windows:** if the project path contains non-ASCII characters and you see `UnicodeEncodeError` in
  the console, set `PYTHONUTF8=1`.
- **npm:** `frontend/.npmrc` sets `legacy-peer-deps=true` to work around an npm 10.9 crash
  (`Cannot read properties of null (reading 'edgesOut')`) on nested optional peer dependencies.
- The app is single-user and has no authentication. Run it locally, or put it behind your own auth.
- Generated chapters are machine-written. Badges show which items were checked automatically;
  everything else should be read critically against the paper (each claim links back to its page).

## License

[AGPL-3.0](LICENSE). This matches the license of PyMuPDF, which the PDF extractor depends on. If you
run a modified version as a network service, you must make its source available to its users.
