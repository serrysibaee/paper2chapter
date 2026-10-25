"""LLM provider abstraction. Use `get_provider()` to build the configured provider."""

from ..config import Settings
from .base import LLMError, LLMProvider, LLMRequest, LLMResult
from .registry import ModelInfo, ProviderPreset, get_presets

__all__ = ["LLMError", "LLMProvider", "LLMRequest", "LLMResult", "ProviderSelection",
           "get_provider", "resolve_selection"]


class ProviderSelection:
    def __init__(self, provider: str, model: str, effort: str):
        self.provider = provider
        self.model = model
        self.effort = effort


def resolve_selection(settings: Settings, saved: dict) -> ProviderSelection:
    """Settings page choice > environment variables > defaults."""
    presets = get_presets(settings)
    provider = saved.get("provider") or settings.llm_provider
    if provider not in presets:
        provider = "mock"
    preset = presets[provider]
    model = saved.get("model") if saved.get("provider") else settings.llm_model
    if not model:
        model = preset.models[0].id
    effort = saved.get("effort") or settings.llm_effort
    return ProviderSelection(provider, model, effort)


def get_provider(settings: Settings, selection: ProviderSelection) -> LLMProvider:
    presets = get_presets(settings)
    if selection.provider not in presets:
        raise LLMError(f"Unknown provider '{selection.provider}'.")
    preset = presets[selection.provider]
    model: ModelInfo = preset.model(selection.model)
    args = (preset, model, selection.effort, settings.llm_max_repairs)
    if preset.kind == "anthropic":
        from .anthropic_provider import AnthropicProvider

        return AnthropicProvider(*args)
    if preset.kind == "openai_compat":
        from .openai_compat import OpenAICompatProvider

        return OpenAICompatProvider(*args)
    from .mock import MockProvider

    return MockProvider(*args)
