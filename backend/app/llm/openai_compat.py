"""Provider for any OpenAI-compatible Chat Completions endpoint.

Covers OpenAI, Google Gemini (OpenAI compatibility endpoint), Groq, OpenRouter, Ollama and
custom servers (LM Studio, vLLM, ...). Structured output starts with strict `json_schema` and
automatically degrades to `json_object` and then to schema-in-prompt when an endpoint or model
rejects it; the result is always validated against the Pydantic schema.
"""

import asyncio
import re

import openai

from ..models import Usage
from .base import LLMError, LLMProvider, LLMRequest, RawCompletion, SchemaUnsupported
from .schema import schema_name, schema_prompt, strict_schema

_SCHEMA_HINTS = ("response_format", "json_schema", "schema", "structured", "json mode")


class OpenAICompatProvider(LLMProvider):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        key = self.preset.api_key()
        if self.preset.key_required and not key:
            raise LLMError(f"Set {self.preset.api_key_env} to use {self.preset.label}.")
        self.client = openai.AsyncOpenAI(
            api_key=key or "not-needed",
            base_url=self.preset.base_url,
            timeout=900,
            # Retries are handled in _create(): blind SDK retries burn free-tier daily quotas.
            max_retries=0,
        )
        self.send_reasoning = self.model.reasoning

    async def _complete(self, req: LLMRequest, prompt: str, max_tokens: int) -> RawCompletion:
        user = (req.context + "\n\n" + prompt) if req.context else prompt
        kwargs: dict = {"model": self.model.id, self.preset.max_tokens_param: max_tokens}
        if self.mode == "json_schema":
            kwargs["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": schema_name(req.schema),
                    "schema": strict_schema(req.schema),
                    "strict": True,
                },
            }
        else:
            user = user + "\n\n" + schema_prompt(req.schema)
            if self.mode == "json_object":
                kwargs["response_format"] = {"type": "json_object"}
        if self.send_reasoning:
            kwargs["reasoning_effort"] = self.effort
        kwargs["messages"] = [
            {"role": "system", "content": req.system},
            {"role": "user", "content": user},
        ]

        try:
            resp = await self._create(kwargs)
        except openai.AuthenticationError as exc:
            raise LLMError(f"{self.preset.label} rejected the API key ({self.preset.api_key_env}).") from exc
        except openai.NotFoundError as exc:
            raise LLMError(f"Model '{self.model.id}' was not found at {self.preset.label}.") from exc
        except openai.RateLimitError as exc:
            raise LLMError(_rate_limit_message(self.preset.label, self.model.id, str(exc))) from exc
        except openai.BadRequestError as exc:
            text = str(exc).lower()
            if self.send_reasoning and "reasoning" in text:
                self.send_reasoning = False
                return await self._complete(req, prompt, max_tokens)
            if self.mode != "prompt" and any(h in text for h in _SCHEMA_HINTS):
                raise SchemaUnsupported(str(exc)) from exc
            raise LLMError(f"{self.preset.label} rejected the request: {exc}") from exc
        except openai.APIConnectionError as exc:
            hint = " Is Ollama running?" if self.preset.id == "ollama" else ""
            raise LLMError(f"Could not reach {self.preset.label} at {self.preset.base_url}.{hint}") from exc
        except openai.APIStatusError as exc:
            raise LLMError(f"{self.preset.label} API error {exc.status_code}: {exc}") from exc

        if not resp.choices:
            raise LLMError(f"{self.preset.label} returned no choices.")
        choice = resp.choices[0]
        refusal = getattr(choice.message, "refusal", None)
        if refusal:
            raise LLMError(f"The model refused: {refusal}")
        usage = Usage(calls=1)
        if resp.usage:
            cached = 0
            details = getattr(resp.usage, "prompt_tokens_details", None)
            if details is not None:
                cached = getattr(details, "cached_tokens", 0) or 0
            usage.input_tokens = (resp.usage.prompt_tokens or 0) - cached
            usage.cache_read_tokens = cached
            usage.output_tokens = resp.usage.completion_tokens or 0
        return RawCompletion(
            text=choice.message.content or "",
            usage=usage,
            truncated=choice.finish_reason == "length",
        )

    async def _create(self, kwargs: dict):
        """Call the API, retrying transient failures and short rate limits only.

        Daily/plan quota errors are raised immediately: retrying them cannot succeed and
        on free tiers each failed attempt can still count against the quota.
        """
        attempt = 0
        while True:
            try:
                return await self.client.chat.completions.create(**kwargs)
            except openai.RateLimitError as exc:
                delay = _retry_delay(str(exc))
                if attempt >= 3 or _is_hard_quota(str(exc)) or delay is None or delay > 90:
                    raise
                await asyncio.sleep(delay + 1)
            except (openai.APIConnectionError, openai.InternalServerError):
                if attempt >= 2:
                    raise
                await asyncio.sleep(2 * (attempt + 1))
            attempt += 1


def _retry_delay(message: str) -> float | None:
    m = re.search(r"retry in ([\d.]+)s", message) or re.search(r"retryDelay['\"]?:\s*['\"]?(\d+)s", message)
    if m:
        return float(m.group(1))
    m = re.search(r"try again in ([\d.]+)s", message, re.I)  # Groq/OpenAI wording
    return float(m.group(1)) if m else 20.0


def _is_hard_quota(message: str) -> bool:
    low = message.lower()
    return "limit: 0" in low or "per day" in low or "insufficient_quota" in low


def _rate_limit_message(label: str, model: str, message: str) -> str:
    if "limit: 0" in message:
        return (f"'{model}' is not available on your {label} plan (quota is 0). Enable billing for "
                "this API key, or pick another model in Settings.")
    if "per day" in message.lower():
        m = re.search(r"retry in (?:(\d+)h)?(?:(\d+)m)?", message)
        when = f" It resets in about {m.group(1) or 0}h{m.group(2) or 0}m." if m and (m.group(1) or m.group(2)) else ""
        return (f"Daily free-tier request limit reached for '{model}' on {label}.{when} "
                "Each model has its own quota, so you can switch to another model in Settings, "
                "or enable billing for higher limits.")
    return f"{label} rate limit reached. Wait a minute and retry, or switch model in Settings."
