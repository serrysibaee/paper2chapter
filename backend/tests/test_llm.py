import asyncio

import pytest
from pydantic import BaseModel

from app.config import Settings
from app.llm import LLMError, ProviderSelection, get_provider, resolve_selection
from app.llm.base import LLMProvider, LLMRequest, RawCompletion, SchemaUnsupported, TokenRateLimiter
from app.llm.registry import ModelInfo, ProviderPreset, get_presets
from app.models import Usage


class Item(BaseModel):
    name: str
    count: int


class ScriptedProvider(LLMProvider):
    """Returns queued responses; records the prompts it received."""

    def __init__(self, responses, **kw):
        preset = ProviderPreset(id="t", label="Test", kind="mock", key_required=False, models=[], **kw)
        model = ModelInfo("m", "m", "paid", 100_000, 4_000, 1.0, 2.0)
        super().__init__(preset, model, "medium", max_repairs=2)
        self.responses = list(responses)
        self.prompts: list[str] = []
        self.modes: list[str] = []

    async def _complete(self, req, prompt, max_tokens):
        self.prompts.append(prompt)
        self.modes.append(self.mode)
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        text, truncated = r if isinstance(r, tuple) else (r, False)
        return RawCompletion(text=text, usage=Usage(calls=1, input_tokens=1000, output_tokens=500), truncated=truncated)


def _req():
    return LLMRequest(task="t", system="s", prompt="make an item", schema=Item)


def test_valid_output_first_try():
    p = ScriptedProvider(['{"name": "a", "count": 2}'])
    res = asyncio.run(p.generate(_req()))
    assert res.value == Item(name="a", count=2)
    assert res.usage.calls == 1
    assert res.usage.cost_usd == pytest.approx((1000 * 1.0 + 500 * 2.0) / 1e6)


def test_repairs_invalid_json_and_schema_errors():
    p = ScriptedProvider(["not json", '{"name": "a"}', '{"name": "a", "count": 3}'])
    res = asyncio.run(p.generate(_req()))
    assert res.value.count == 3 and res.usage.calls == 3
    assert "count" in p.prompts[2] and "invalid output" in p.prompts[2]


def test_gives_up_after_max_repairs():
    p = ScriptedProvider(["x", "y", "z"])
    with pytest.raises(LLMError):
        asyncio.run(p.generate(_req()))


def test_truncated_output_asks_for_concision():
    p = ScriptedProvider([('{"name": "a", "cou', True), '{"name": "a", "count": 1}'])
    asyncio.run(p.generate(_req()))
    assert "cut off" in p.prompts[1]


def test_schema_unsupported_downgrades_mode():
    p = ScriptedProvider([SchemaUnsupported("response_format json_schema not supported"), '{"name": "a", "count": 1}'])
    asyncio.run(p.generate(_req()))
    assert p.modes == ["json_schema", "json_object"]


def test_rate_limiter_allows_within_budget():
    lim = TokenRateLimiter(1000)
    asyncio.run(asyncio.wait_for(lim.acquire(400), 1))
    asyncio.run(asyncio.wait_for(lim.acquire(400), 1))
    assert sum(t for _, t in lim.window) == 800


def test_missing_api_key_is_reported(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(LLMError, match="ANTHROPIC_API_KEY"):
        get_provider(Settings(), ProviderSelection("anthropic", "claude-opus-5-5", "medium"))


def test_selection_precedence():
    s = Settings(llm_provider="openai", llm_model="gpt-6-luna")
    assert resolve_selection(s, {}).model == "gpt-6-luna"
    saved = resolve_selection(s, {"provider": "anthropic", "model": "claude-sonnet-5-5"})
    assert (saved.provider, saved.model) == ("anthropic", "claude-sonnet-5-5")
    assert resolve_selection(Settings(llm_provider="nope"), {}).provider == "mock"


def test_presets_have_pricing_and_unique_models():
    presets = get_presets(Settings())
    assert {"anthropic", "openai", "gemini", "groq", "openrouter", "ollama", "mock"} <= set(presets)
    for p in presets.values():
        ids = [m.id for m in p.models]
        assert len(ids) == len(set(ids)) and ids
    assert presets["anthropic"].model("claude-opus-5-5").input_price == 4.0
    unknown = presets["ollama"].model("my-custom:7b")
    assert unknown.input_price is None and unknown.context_tokens > 0


def test_input_budget_respects_preset_cap():
    presets = get_presets(Settings(groq_free_tier=True))
    groq = presets["groq"]
    prov = ScriptedProvider([])
    prov.preset, prov.model = groq, groq.models[0]
    assert prov.input_budget_tokens == 3_500 and prov.output_cap == 4_000
    assert groq.tokens_per_minute is not None


def test_rate_limit_classification():
    from app.llm.openai_compat import _is_hard_quota, _rate_limit_message, _retry_delay

    daily = "Quota exceeded for metric: free_tier_requests, limit: 20, description: Generate content requests per day limit exceeded. Please retry in 20h50m39.4s."
    minute = "Quota exceeded: requests per minute. check your plan and billing details. Please retry in 31.5s."
    zero = "Quota exceeded ... limit: 0, model: gemini-3.1-pro"
    assert _is_hard_quota(daily) and _is_hard_quota(zero) and not _is_hard_quota(minute)
    assert _retry_delay(minute) == 31.5
    assert "20h50m" in _rate_limit_message("Gemini", "m", daily)
    assert "billing" in _rate_limit_message("Gemini", "m", zero)
