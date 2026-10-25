"""Provider-agnostic interface for schema-validated LLM generation."""

import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from collections import deque
from dataclasses import dataclass
from typing import Generic, TypeVar

from pydantic import BaseModel, ValidationError

from ..models import Usage
from .registry import ModelInfo, ProviderPreset, StructuredMode
from .schema import extract_json_text

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """Generation failed in a way the user should see (bad key, refusal, quota, ...)."""

    def __init__(self, message: str, usage: Usage | None = None):
        super().__init__(message)
        self.usage = usage  # tokens spent on failed attempts, so they are still accounted for


class SchemaUnsupported(Exception):
    """The provider rejected the structured-output request; retry in a weaker mode."""


class TruncatedOutput(Exception):
    pass


@dataclass
class LLMRequest:
    task: str  # short label, e.g. "analysis" (logging + mock routing)
    system: str
    prompt: str
    schema: type[BaseModel]
    context: str = ""  # large, stable text (paper); sent first so prefix caching applies
    pdf_bytes: bytes | None = None
    max_output_tokens: int = 16_000


@dataclass
class RawCompletion:
    text: str
    usage: Usage
    truncated: bool = False


@dataclass
class LLMResult(Generic[T]):
    value: T
    usage: Usage


def estimate_tokens(text: str) -> int:
    """Rough token estimate (~3.5 chars/token for technical English with math)."""
    return int(len(text) / 3.5) + 1


class TokenRateLimiter:
    """Sliding-window limiter for providers with tight tokens-per-minute quotas."""

    def __init__(self, tokens_per_minute: int):
        self.tpm = tokens_per_minute
        self.window: deque[tuple[float, int]] = deque()
        self.lock = asyncio.Lock()

    async def acquire(self, tokens: int) -> None:
        tokens = min(tokens, self.tpm)
        async with self.lock:
            while True:
                now = time.monotonic()
                while self.window and now - self.window[0][0] > 60:
                    self.window.popleft()
                used = sum(t for _, t in self.window)
                if used + tokens <= self.tpm:
                    self.window.append((now, tokens))
                    return
                await asyncio.sleep(max(0.5, 60 - (now - self.window[0][0]) + 0.1))


class LLMProvider(ABC):
    def __init__(self, preset: ProviderPreset, model: ModelInfo, effort: str, max_repairs: int):
        self.preset = preset
        self.model = model
        self.effort = effort
        self.max_repairs = max_repairs
        self.mode: StructuredMode = preset.structured_mode
        self.limiter = TokenRateLimiter(preset.tokens_per_minute) if preset.tokens_per_minute else None

    # ------------------------------------------------------------------ capabilities

    @property
    def accepts_pdf(self) -> bool:
        return self.preset.supports_pdf

    @property
    def input_budget_tokens(self) -> int:
        """How much input text the pipeline may put into one request."""
        budget = self.model.context_tokens - self.output_cap - 4_000
        if self.preset.input_budget_tokens:
            budget = min(budget, self.preset.input_budget_tokens)
        # Even with 1M-token models, very long prompts cost more and dilute attention.
        return max(2_000, min(budget, 150_000))

    @property
    def output_cap(self) -> int:
        cap = self.model.max_output_tokens
        if self.preset.output_cap_tokens:
            cap = min(cap, self.preset.output_cap_tokens)
        return cap

    # ------------------------------------------------------------------ provider hook

    @abstractmethod
    async def _complete(self, req: LLMRequest, prompt: str, max_tokens: int) -> RawCompletion:
        """Send one request. Raise SchemaUnsupported if the structured-output mode is rejected."""

    # ------------------------------------------------------------------ public API

    def cost(self, usage: Usage) -> float | None:
        m = self.model
        if m.input_price is None or m.output_price is None:
            return None
        cr = m.cache_read_price if m.cache_read_price is not None else m.input_price
        cw = m.cache_write_price if m.cache_write_price is not None else m.input_price
        total = (
            usage.input_tokens * m.input_price
            + usage.cache_read_tokens * cr
            + usage.cache_write_tokens * cw
            + usage.output_tokens * m.output_price
        )
        return round(total / 1_000_000, 6)

    async def generate(self, req: LLMRequest) -> LLMResult:
        """Generate an instance of `req.schema`, repairing invalid output up to N times."""
        total = Usage()
        prompt = req.prompt
        max_tokens = min(req.max_output_tokens, self.output_cap)
        last_error = ""
        for attempt in range(self.max_repairs + 1):
            if self.limiter:
                await self.limiter.acquire(
                    estimate_tokens(req.system + req.context + prompt) + max_tokens
                )
            try:
                raw = await self._complete(req, prompt, max_tokens)
            except SchemaUnsupported as exc:
                self._downgrade(str(exc))
                raw = await self._complete(req, prompt, max_tokens)
            raw.usage.cost_usd = self.cost(raw.usage)
            total.add(raw.usage)

            if raw.truncated:
                last_error = "output was cut off at the token limit"
                prompt = (
                    req.prompt
                    + "\n\nIMPORTANT: Your previous answer was too long and got cut off. "
                    "Be more concise: shorter prose, fewer items, same JSON structure."
                )
                continue
            try:
                data = json.loads(extract_json_text(raw.text))
                return LLMResult(value=req.schema.model_validate(data), usage=total)
            except (json.JSONDecodeError, ValidationError) as exc:
                last_error = _short_error(exc)
                log.info("%s: invalid output (attempt %d): %s", req.task, attempt + 1, last_error)
                prompt = (
                    req.prompt
                    + "\n\nA previous attempt returned invalid output. Fix these problems and "
                    f"return the complete, corrected JSON object:\n{last_error}\n\n"
                    f"Previous output (truncated):\n{raw.text[:4000]}"
                )
        raise LLMError(
            f"The model did not return valid {req.schema.__name__} output after "
            f"{self.max_repairs + 1} attempts ({last_error}). Try a more capable model.",
            usage=total,
        )

    def _downgrade(self, reason: str) -> None:
        order: list[StructuredMode] = ["json_schema", "json_object", "prompt"]
        idx = order.index(self.mode)
        if idx == len(order) - 1:
            raise LLMError(f"Provider rejected the request: {reason}")
        self.mode = order[idx + 1]
        log.warning("structured mode downgraded to %s (%s)", self.mode, reason[:200])


def _short_error(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        parts = [
            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:10]
        ]
        return "; ".join(parts)
    return str(exc)[:500]
