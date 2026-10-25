"""Provider presets and model metadata (pricing researched October 2026).

Prices are USD per 1M tokens on the standard tier and are used only for cost *estimates*;
check the provider's pricing page before budgeting. Users may also type any model id the
provider supports; unknown models get conservative defaults and no cost estimate.

Sources (checked 2026-10-25):
  Anthropic   bundled Claude API reference (models table cached 2026-10-06)
  OpenAI      https://developers.openai.com/api/docs/pricing
  Gemini      https://ai.google.dev/gemini-api/docs/pricing
  Groq        https://console.groq.com/docs/models, https://console.groq.com/docs/rate-limits
  OpenRouter  https://openrouter.ai/api/v1/models, https://openrouter.ai/docs/api-reference/limits
  Ollama      https://ollama.com/library
"""

import os
from dataclasses import dataclass, field
from typing import Literal

from ..config import Settings

StructuredMode = Literal["json_schema", "json_object", "prompt"]
Tier = Literal["free", "free-tier", "paid", "local", "subscription"]


@dataclass(frozen=True)
class ModelInfo:
    id: str
    label: str
    tier: Tier
    context_tokens: int
    max_output_tokens: int
    input_price: float | None = None  # USD / 1M tokens
    output_price: float | None = None
    cache_read_price: float | None = None
    cache_write_price: float | None = None
    reasoning: bool = False  # accepts a reasoning-effort parameter
    notes: str = ""


@dataclass(frozen=True)
class ProviderPreset:
    id: str
    label: str
    kind: Literal["anthropic", "openai_compat", "cli", "mock"]
    models: list[ModelInfo]
    api_key_env: str | None = None
    base_url: str | None = None
    key_required: bool = True
    structured_mode: StructuredMode = "json_schema"
    supports_pdf: bool = False
    max_tokens_param: Literal["max_tokens", "max_completion_tokens"] = "max_tokens"
    tokens_per_minute: int | None = None  # client-side pacing for strict free tiers
    input_budget_tokens: int | None = None  # per-request input cap (small context / TPM limits)
    output_cap_tokens: int | None = None
    pricing_note: str = ""
    free_note: str = ""
    docs_url: str = ""
    max_concurrency: int | None = None  # parallel requests per job (None: the pipeline decides)
    setup_hint: str = ""  # what to do when the provider is not ready (shown in Settings)
    extra: dict = field(default_factory=dict)

    def model(self, model_id: str) -> ModelInfo:
        for m in self.models:
            if m.id == model_id:
                return m
        if self.kind == "cli":
            # Any model the CLI accepts; usage is covered by the plan, not billed per token.
            return ModelInfo(id=model_id, label=model_id, tier="subscription", context_tokens=200_000,
                             max_output_tokens=32_000, input_price=0.0, output_price=0.0,
                             reasoning=self.models[0].reasoning if self.models else False,
                             notes="Model id typed by you; the CLI decides whether your plan has it.")
        # Unknown/custom model id: conservative defaults, no pricing.
        return ModelInfo(
            id=model_id,
            label=model_id,
            tier="local" if self.kind == "openai_compat" and not self.key_required else "paid",
            context_tokens=32_000,
            max_output_tokens=8_000,
            notes="Custom model id: limits and pricing unknown.",
        )

    def api_key(self) -> str | None:
        return os.environ.get(self.api_key_env) if self.api_key_env else None

    def is_configured(self) -> bool:
        if self.kind == "cli":
            from .cli_runner import resolve_cli

            return resolve_cli(self.extra["cli"], self.extra.get("cli_path", "")) is not None
        return not self.key_required or bool(self.api_key())


def _presets(settings: Settings) -> list[ProviderPreset]:
    presets = [
        ProviderPreset(
            id="anthropic",
            label="Anthropic Claude",
            kind="anthropic",
            api_key_env="ANTHROPIC_API_KEY",
            supports_pdf=True,
            docs_url="https://platform.claude.com/docs",
            pricing_note="Prompt caching is used for the paper text (cache reads ~5-10% of input price).",
            models=[
                ModelInfo("claude-opus-5-5", "Claude Opus 5.5", "paid", 1_000_000, 32_000,
                          4.00, 20.00, 0.20, 5.00, reasoning=True,
                          notes="Highest quality for derivations and exercises."),
                ModelInfo("claude-sonnet-5-5", "Claude Sonnet 5.5", "paid", 1_000_000, 32_000,
                          2.00, 10.00, 0.20, 2.50, reasoning=True,
                          notes="Strong quality at half the Opus price."),
                ModelInfo("claude-haiku-5-5", "Claude Haiku 5.5", "paid", 1_000_000, 32_000,
                          0.10, 0.50, None, None, reasoning=True,
                          notes="Very cheap; $0.50/$2.50 above 100K-token prompts."),
            ],
        ),
        ProviderPreset(
            id="openai",
            label="OpenAI",
            kind="openai_compat",
            api_key_env="OPENAI_API_KEY",
            base_url="https://api.openai.com/v1",
            max_tokens_param="max_completion_tokens",
            docs_url="https://developers.openai.com/api/docs/pricing",
            pricing_note="Prices for prompts up to 272K tokens. Cached input billed at ~5-10%.",
            models=[
                ModelInfo("gpt-6.1-sol", "GPT-6.1 Sol", "paid", 272_000, 32_000,
                          2.00, 10.00, 0.10, reasoning=True),
                ModelInfo("gpt-6-astra", "GPT-6 Astra", "paid", 272_000, 32_000,
                          10.00, 50.00, 1.00, reasoning=True, notes="Flagship; expensive."),
                ModelInfo("gpt-5.4-mini", "GPT-5.4 mini", "paid", 272_000, 32_000,
                          0.75, 4.50, 0.075, reasoning=True),
                ModelInfo("gpt-6-luna", "GPT-6 Luna", "paid", 272_000, 32_000,
                          0.10, 0.50, 0.01, reasoning=True, notes="Cheapest OpenAI option."),
            ],
        ),
        ProviderPreset(
            id="claude-cli",
            label="Claude subscription (Claude Code)",
            kind="cli",
            key_required=False,
            structured_mode="json_schema",  # --json-schema when the CLI has it, else schema in prompt
            supports_pdf=settings.claude_cli_read_pdf,
            max_concurrency=settings.cli_max_concurrency,
            docs_url="https://claude.com/claude-code",
            setup_hint=("Install Claude Code, run `claude` once in a terminal and sign in with your "
                        "Claude Pro/Max account (/login). Set CLAUDE_CLI_PATH if it is not on PATH."),
            free_note=("Uses your Claude Pro or Max plan through the Claude Code CLI on this machine: "
                       "no API key and no per-token bill, but the plan's usage limits apply (a chapter "
                       "is ~10-12 requests). For your own use only; do not host this for others."),
            pricing_note="Included in your Claude plan. Token counts are shown for information.",
            extra={"cli": "claude", "cli_path": settings.claude_cli_path,
                   "timeout_s": settings.cli_timeout_s, "read_pdf": settings.claude_cli_read_pdf},
            models=[
                ModelInfo("sonnet", "Claude Sonnet", "subscription", 200_000,
                          32_000, 0.0, 0.0, notes="The latest Sonnet your plan offers; a good balance of quality and plan usage."),
                ModelInfo("opus", "Claude Opus", "subscription", 200_000,
                          32_000, 0.0, 0.0, notes="The latest Opus your plan offers; best derivations, uses the plan's limits fastest."),
                ModelInfo("haiku", "Claude Haiku", "subscription", 200_000,
                          32_000, 0.0, 0.0, notes="The latest Haiku your plan offers; fast and light on limits, weaker on long derivations."),
            ],
        ),
        ProviderPreset(
            id="codex-cli",
            label="ChatGPT subscription (Codex)",
            kind="cli",
            key_required=False,
            structured_mode="json_schema",  # --output-schema
            max_concurrency=settings.cli_max_concurrency,
            docs_url="https://developers.openai.com/codex/cli",
            setup_hint=("Install the Codex CLI (npm install -g @openai/codex), then run `codex login` "
                        "and sign in with your ChatGPT Plus/Pro account. Set CODEX_CLI_PATH if needed."),
            free_note=("Uses your ChatGPT Plus or Pro plan through the Codex CLI on this machine: no API "
                       "key and no per-token bill, but Codex's plan limits apply. For your own use only."),
            pricing_note="Included in your ChatGPT plan. Token counts are shown for information.",
            extra={"cli": "codex", "cli_path": settings.codex_cli_path,
                   "timeout_s": settings.cli_timeout_s},
            models=[
                ModelInfo("gpt-6.1-sol", "GPT-6.1 Sol", "subscription", 272_000, 32_000, 0.0, 0.0,
                          reasoning=True, notes="Codex's first choice (Oct 2026)."),
                ModelInfo("gpt-6-astra", "GPT-6 Astra", "subscription", 272_000, 32_000, 0.0, 0.0,
                          reasoning=True, notes="Flagship; uses the plan's limits fastest."),
                ModelInfo("gpt-6-luna", "GPT-6 Luna", "subscription", 272_000, 32_000, 0.0, 0.0,
                          reasoning=True, notes="Fast and light on limits."),
                ModelInfo("default", "Codex default", "subscription", 272_000, 32_000, 0.0, 0.0,
                          reasoning=True, notes="Whatever model your Codex CLI picks."),
            ],
        ),
        ProviderPreset(
            id="gemini",
            label="Google Gemini",
            kind="openai_compat",
            api_key_env="GEMINI_API_KEY",
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            docs_url="https://ai.google.dev/gemini-api/docs/pricing",
            free_note=(
                "Free tier via Google AI Studio for Flash/Flash-Lite models (no card), but only ~20 "
                "requests/day per model (observed Oct 2026); a chapter needs ~10-12, so about one "
                "paper per model per day. Pro models need billing. Free-tier prompts may be used "
                "to improve Google products - avoid confidential papers."
            ),
            pricing_note="Gemini 3.8 Flash is at an introductory price until 2026-12-31 ($1.50/$7.50 after).",
            models=[
                ModelInfo("gemini-3.8-flash", "Gemini 3.8 Flash", "free-tier", 1_000_000, 32_000,
                          0.75, 3.75, reasoning=True),
                ModelInfo("gemini-3.5-flash", "Gemini 3.5 Flash", "free-tier", 1_000_000, 32_000,
                          reasoning=True,
                          notes="Separate free-tier quota from 3.8/3.7 Flash; paid price not on the pricing page."),
                ModelInfo("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", "free-tier", 1_000_000,
                          32_000, 0.30, 2.50),
                ModelInfo("gemini-3.1-pro-preview", "Gemini 3.1 Pro (preview)", "paid", 1_000_000, 32_000,
                          2.00, 12.00, reasoning=True,
                          notes="Paid only (free-tier quota is 0): enable billing in Google AI Studio."),
                ModelInfo("gemini-4-argon", "Gemini 4 Argon", "paid", 1_000_000, 32_000,
                          2.00, 10.00, reasoning=True,
                          notes="Paid only; $4/$20 from 2026-12-01."),
            ],
        ),
        ProviderPreset(
            id="groq",
            label="Groq",
            kind="openai_compat",
            api_key_env="GROQ_API_KEY",
            base_url="https://api.groq.com/openai/v1",
            max_tokens_param="max_completion_tokens",
            docs_url="https://console.groq.com/docs/rate-limits",
            tokens_per_minute=7_500 if settings.groq_free_tier else None,
            input_budget_tokens=3_500 if settings.groq_free_tier else 60_000,
            output_cap_tokens=4_000 if settings.groq_free_tier else None,
            free_note=(
                "Free plan: ~30 req/min, 1K req/day, 8K tokens/min, 200K tokens/day per model. "
                "Enough for roughly one chapter per day, generated slowly. Set GROQ_FREE_TIER=false "
                "on a paid plan."
            ),
            models=[
                ModelInfo("openai/gpt-oss-120b", "gpt-oss-120b", "free-tier", 131_072, 16_000,
                          0.15, 0.60, reasoning=True),
                ModelInfo("openai/gpt-oss-20b", "gpt-oss-20b", "free-tier", 131_072, 16_000,
                          0.075, 0.30, reasoning=True),
                ModelInfo("qwen/qwen3.8-27b", "Qwen3.8 27B", "free-tier", 131_072, 16_000,
                          notes="Paid price not published on the models page."),
            ],
        ),
        ProviderPreset(
            id="openrouter",
            label="OpenRouter",
            kind="openai_compat",
            api_key_env="OPENROUTER_API_KEY",
            base_url="https://openrouter.ai/api/v1",
            docs_url="https://openrouter.ai/models?max_price=0",
            free_note=(
                ":free models: 20 req/min; 50 req/day (1,000/day after a one-time $10 credit "
                "purchase). A chapter needs ~15-25 requests. The free catalogue changes often."
            ),
            models=[
                ModelInfo("nvidia/nemotron-3.5-super-vl:free", "Nemotron 3.5 Super (free)", "free",
                          1_000_000, 16_000, 0.0, 0.0, notes="Supports structured outputs."),
                ModelInfo("nvidia/nemotron-3-super-120b-a12b:free", "Nemotron 3 Super 120B (free)",
                          "free", 262_144, 16_000, 0.0, 0.0),
                ModelInfo("google/gemma-4-31b-it:free", "Gemma 4 31B (free)", "free", 262_144,
                          16_000, 0.0, 0.0, notes="JSON mode only (no strict schema)."),
            ],
        ),
        ProviderPreset(
            id="ollama",
            label="Ollama (local)",
            kind="openai_compat",
            base_url=settings.ollama_base_url,
            key_required=False,
            input_budget_tokens=settings.ollama_input_budget_tokens,
            output_cap_tokens=8_000,
            docs_url="https://ollama.com/library",
            free_note=(
                "Runs on your machine: free and private. Quality depends heavily on model size. "
                "Start Ollama with a larger context, e.g. OLLAMA_CONTEXT_LENGTH=32768."
            ),
            models=[
                ModelInfo("qwen3.6:27b", "Qwen 3.6 27B", "local", 32_768, 8_000, 0.0, 0.0,
                          notes="Needs ~20 GB VRAM/RAM; best local quality in this list."),
                ModelInfo("gpt-oss:20b", "gpt-oss 20B", "local", 32_768, 8_000, 0.0, 0.0,
                          notes="Needs ~16 GB."),
                ModelInfo("gemma4:12b", "Gemma 4 12B", "local", 32_768, 8_000, 0.0, 0.0,
                          notes="Needs ~10 GB."),
                ModelInfo("qwen3:8b", "Qwen3 8B", "local", 32_768, 8_000, 0.0, 0.0,
                          notes="Runs on modest hardware; expect weaker derivations."),
            ],
        ),
        ProviderPreset(
            id="mock",
            label="Mock (offline demo)",
            kind="mock",
            key_required=False,
            free_note="Returns fixed placeholder content. For testing the app without an API key.",
            models=[ModelInfo("mock", "Mock model", "local", 1_000_000, 32_000, 0.0, 0.0)],
        ),
    ]
    if settings.custom_openai_base_url:
        presets.insert(
            -1,
            ProviderPreset(
                id="custom",
                label="Custom OpenAI-compatible",
                kind="openai_compat",
                api_key_env="CUSTOM_OPENAI_API_KEY",
                base_url=settings.custom_openai_base_url,
                key_required=False,
                structured_mode="json_object",
                models=[ModelInfo(settings.custom_openai_model or "default", settings.custom_openai_model or "default",
                                  "paid", 32_000, 8_000)],
            ),
        )
    return presets


def get_presets(settings: Settings) -> dict[str, ProviderPreset]:
    return {p.id: p for p in _presets(settings)}
