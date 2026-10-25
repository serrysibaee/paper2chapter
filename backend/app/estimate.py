"""Rough per-chapter token and cost estimates, shown before the user spends money.

Model of one chapter (5 sections): the paper context of T tokens is sent with ~10 requests
(analysis, outline, primers, 5 sections, practice, wrap-up). Output is ~50K tokens including
reasoning tokens; reasoning-heavy settings can exceed this.
"""

from .llm.base import estimate_tokens
from .llm.registry import ModelInfo, ProviderPreset

REQUESTS = 10
PROMPT_OVERHEAD = 2_500  # instructions + analysis/outline per request
OUTPUT_TOKENS = 50_000


def estimate_chapter(preset: ProviderPreset, model: ModelInfo, paper_tokens: int, budget: int) -> dict:
    t = min(paper_tokens, budget)
    input_tokens = REQUESTS * (t + PROMPT_OVERHEAD)
    out: dict = {
        "requests": REQUESTS + 2,  # +2 for possible repairs
        "input_tokens": input_tokens,
        "output_tokens": OUTPUT_TOKENS,
        "cost_usd": None,
        "cost_with_cache_usd": None,
    }
    if model.input_price is None or model.output_price is None:
        return out
    out["cost_usd"] = round((input_tokens * model.input_price + OUTPUT_TOKENS * model.output_price) / 1e6, 4)
    if model.cache_read_price is not None:
        cached = (REQUESTS - 1) * t
        uncached = input_tokens - cached
        write = model.cache_write_price if model.cache_write_price is not None else model.input_price
        cost = (uncached * model.input_price + t * (write - model.input_price)
                + cached * model.cache_read_price + OUTPUT_TOKENS * model.output_price) / 1e6
        out["cost_with_cache_usd"] = round(cost, 4)
    return out


def paper_tokens(text: str) -> int:
    return estimate_tokens(text)
