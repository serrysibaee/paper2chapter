# LLM providers: models, limits and cost

Researched **2026-10-25**. Prices change often; check the linked pages before budgeting. The same
data lives in `backend/app/llm/registry.py` and is shown on the Settings page.

## How a chapter uses tokens

One chapter is about 10-12 requests: analysis, outline, primers, one per section (about 5), practice
set and wrap-up, plus occasional repairs. Each request carries the paper text (about 12K tokens for
a 15-page paper). Output is about 50K tokens including reasoning tokens. Anthropic and OpenAI cache
the repeated paper prefix, which cuts input cost substantially.

Estimates below are for a ~15-page paper (~12K tokens): ~145K input tokens and ~50K output tokens.
They come from `backend/app/estimate.py`. Real costs vary with paper length, effort level and
reasoning verbosity.

## Comparison

| Provider | Model | Tier | $ in / out per 1M | Context | Est. $ per chapter | Notes |
|---|---|---|---|---|---|---|
| Anthropic | `claude-opus-5-5` | paid | 4.00 / 20.00 | 1M | ~1.18 (cached) | Best quality for derivations; reads the PDF natively |
| Anthropic | `claude-sonnet-5-5` | paid | 2.00 / 10.00 | 1M | ~0.60 (cached) | Strong quality at half the Opus price |
| Anthropic | `claude-haiku-5-5` | paid | 0.10 / 0.50 | 1M | ~0.04 | Very cheap; weaker on long derivations |
| OpenAI | `gpt-6-astra` | paid | 10.00 / 50.00 | ≥272K | ~2.98 (cached) | Flagship |
| OpenAI | `gpt-6.1-sol` | paid | 2.00 / 10.00 | ≥272K | ~0.58 (cached) | |
| OpenAI | `gpt-5.4-mini` | paid | 0.75 / 4.50 | ≥272K | ~0.26 (cached) | |
| OpenAI | `gpt-6-luna` | paid | 0.10 / 0.50 | ≥272K | ~0.03 (cached) | Cheapest OpenAI model |
| Google | `gemini-3.8-flash` | free tier + paid | 0.75 / 3.75* | (not on pricing page) | 0 free / ~0.30 paid | *Introductory price until 2026-12-31, then 1.50 / 7.50 |
| Google | `gemini-3.5-flash-lite` | free tier + paid | 0.30 / 2.50 | (not on pricing page) | 0 free / ~0.17 paid | |
| Google | `gemini-4-argon` | paid only | 2.00 / 10.00* | (not on pricing page) | ~0.79 | *4.00 / 20.00 from 2026-12-01 |
| Groq | `openai/gpt-oss-120b` | free tier + paid | 0.15 / 0.60 | 131K | 0 free / ~0.05 paid | Very fast |
| Groq | `openai/gpt-oss-20b` | free tier + paid | 0.075 / 0.30 | 131K | 0 free / ~0.03 paid | |
| OpenRouter | `nvidia/nemotron-3.5-super-vl:free` | free | 0 / 0 | 1M | 0 | Supports structured outputs |
| OpenRouter | `google/gemma-4-31b-it:free` | free | 0 / 0 | 262K | 0 | JSON mode only |
| Ollama | `qwen3.6:27b`, `gpt-oss:20b`, `gemma4:12b`, `qwen3:8b` | local | 0 | you set it | 0 (your hardware) | Private; quality scales with size |

The ≥272K figure for OpenAI is the prompt size covered by the listed prices. The pricing page does
not state context windows.

## Subscriptions: Claude Code and Codex

If you pay for Claude Pro/Max or ChatGPT Plus/Pro, you can use that plan instead of an API key. The
backend runs the vendor's own command-line tool headless, signed in with your plan:

| Provider id | Uses | Sign in once | Models offered |
|---|---|---|---|
| `claude-cli` | [Claude Code](https://claude.com/claude-code): `claude -p --output-format json` | run `claude`, then `/login` | `sonnet`, `opus`, `haiku` (the latest your plan offers), or any id the CLI accepts |
| `codex-cli` | [Codex CLI](https://developers.openai.com/codex/cli): `codex exec --json` | `codex login` | `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-luna`, `default`, or any id Codex accepts |

**What it costs.** Nothing per token: requests count against your plan's usage limits instead. A
chapter is about 10-13 requests. The Settings page shows *included in your plan* instead of a price.

**How it works.** For each request the backend starts the CLI in an empty temporary folder, writes
the prompt (paper text, instructions, JSON schema) to its standard input, and reads JSON back. The
output is validated and repaired exactly as for API providers, and all verification still runs.

- **No token handling.** The CLI holds the sign-in; the app never reads, stores or forwards it.
- **No tools.** Claude Code runs with every tool disabled (or only `Read` on `./paper.pdf` if you
  set `CLAUDE_CLI_READ_PDF=true`); Codex runs in its `read-only` sandbox. Neither loads MCP servers,
  project settings or your Codex config, and sessions are not saved. The model writes text; it
  cannot act on your machine.
- **Your plan, not an API account.** `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` are removed from the
  CLI's environment, because a CLI that finds an API key may bill it instead of using the plan.
- **Structured output.** Codex enforces the schema (`--output-schema`). Claude Code uses
  `--json-schema` when your CLI version has it and otherwise gets the schema in the prompt; either
  way the result is validated.
- **Concurrency.** At most `CLI_MAX_CONCURRENCY` (default 2) requests run at once, to stay under
  plan rate limits. Each request may take up to `CLI_TIMEOUT_S` (default 900 s).
- **Windows.** npm installs the CLIs as `.cmd` shims; the backend runs the underlying
  `node <script>` directly, so prompts never pass through cmd.exe and its 8,191-character limit.
  Set `CLAUDE_CLI_PATH` / `CODEX_CLI_PATH` if a CLI is not on `PATH`.

**Measured on 2026-10-25** (the three-page sample paper of the test suite, one chapter):

| Provider / model | Time | Requests | Checks |
|---|---|---|---|
| `claude-cli` / `haiku` (Claude Code 2.0.27) | 260 s | 13 | 19 verified, 1 failed |
| `codex-cli` / `gpt-6-luna` (Codex CLI 0.164.0) | 95 s | 10 | 14 verified, 0 failed |

Codex adds its own agent instructions to every request, so its input-token counts look high (about
15K per request); on a plan that is usage, not money.

**Terms.** A consumer subscription is for its holder. Use these providers on your own machine, for
yourself. Do not run the backend as a service for other people on your subscription; give a shared
deployment an API key instead.

**Errors you may see.** *not signed in* (run `claude` + `/login`, or `codex login`), *usage limit
was reached* (wait for the plan to reset or use a lighter model), *did not answer within … s*
(raise `CLI_TIMEOUT_S`). **Check CLI** on the Settings page (or `GET /api/providers/<id>/check`)
reports the installed version and, for Codex, the sign-in.

## Free options and their limits

| Option | Limits (as published) | Practical result |
|---|---|---|
| **Gemini free tier** (AI Studio key, no card) | Per-project quotas shown in AI Studio; Pro models are not free | Best free quality. Free-tier prompts **may be used to improve Google products**, so don't use it for confidential papers. |
| **Groq free plan** | ~30 req/min, 1K req/day, **8K tokens/min**, 200K tokens/day per model | Works, but requests must be small. The app paces requests and uses 3.5K-token excerpts (`GROQ_FREE_TIER=true`). About one chapter per day, generated slowly, and quality drops because each section sees less of the paper. |
| **OpenRouter `:free` models** | 20 req/min; **50 req/day** (1,000/day after a one-time $10 credit purchase) | 2-4 chapters/day without buying credits. The free catalogue changes often (17 of 467 models were free when checked). |
| **Ollama (local)** | Your hardware | Free and private. Needs ~10-20 GB RAM/VRAM for useful models. Set `OLLAMA_CONTEXT_LENGTH=32768`, because the default context is small and silently truncates input. |

## Recommendations

- **Already paying for Claude or ChatGPT:** `claude-cli` (Sonnet) or `codex-cli` (GPT-6.1 Sol): no
  extra cost, within your plan's limits.
- **Best quality:** Claude Opus 5.5, or Sonnet 5.5 for half the cost. Native PDF input gives the most
  faithful equations, and prompt caching keeps the cost down.
- **Good and cheap:** Gemini 3.8 Flash (free tier for non-confidential papers), GPT-5.4 mini, or
  Claude Haiku 5.5.
- **Free:** Gemini free tier first, then OpenRouter free models. Use Groq free for experiments.
- **Private/offline:** Ollama with the largest model your machine runs.

Smaller and free models produce more schema-repair retries and more failed verification checks. The
reader shows those as red badges, so quality problems are visible rather than hidden.

## Adding or switching providers

- Switch at runtime on the **Settings** page, or with `LLM_PROVIDER` / `LLM_MODEL` env vars.
- Any model id the provider accepts can be typed in; unknown models get no cost estimate.
- Any OpenAI-compatible server works through `CUSTOM_OPENAI_BASE_URL` / `CUSTOM_OPENAI_MODEL`.
- A new provider type means implementing `LLMProvider._complete()` (see `backend/app/llm/`); a new
  CLI-backed one subclasses `CLIProvider` in `backend/app/llm/cli_provider.py`.

## Sources

- Anthropic: bundled Claude API reference (model table cached 2026-10-06)
- OpenAI: https://developers.openai.com/api/docs/pricing
- Gemini: https://ai.google.dev/gemini-api/docs/pricing
- Groq: https://console.groq.com/docs/models, https://console.groq.com/docs/rate-limits
- OpenRouter: https://openrouter.ai/api/v1/models, https://openrouter.ai/docs/api-reference/limits
- Ollama: https://ollama.com/library
