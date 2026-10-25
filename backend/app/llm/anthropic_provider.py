"""Anthropic Claude provider (official `anthropic` SDK).

* Structured output via `output_config.format` (JSON Schema), validated again client-side.
* Paper text is sent as a cached content block, so the many per-section calls of one chapter
  read it from the prompt cache instead of paying full input price each time.
* The original PDF can be attached as a `document` block for better equation fidelity.
* Server-side refusal fallbacks (`fallbacks: "default"`) are enabled for models that support
  them: if a safety classifier declines a request, the API retries on Anthropic's recommended
  fallback model inside the same call.
"""

import base64

import anthropic

from ..models import Usage
from .base import LLMError, LLMProvider, LLMRequest, RawCompletion, SchemaUnsupported
from .schema import schema_prompt, strict_schema

FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Haiku has no server-side fallback; adding the parameter there is pointless.
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-opus-5"}


class AnthropicProvider(LLMProvider):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        key = self.preset.api_key()
        if not key:
            raise LLMError(f"Set {self.preset.api_key_env} to use {self.preset.label}.")
        # Long generations: generous timeout; the SDK retries 429/5xx with backoff.
        self.client = anthropic.AsyncAnthropic(api_key=key, timeout=900, max_retries=4)

    async def _complete(self, req: LLMRequest, prompt: str, max_tokens: int) -> RawCompletion:
        content: list[dict] = []
        if req.pdf_bytes:
            content.append(
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": base64.b64encode(req.pdf_bytes).decode("ascii"),
                    },
                    "cache_control": {"type": "ephemeral"},
                }
            )
        if req.context:
            content.append(
                {"type": "text", "text": req.context, "cache_control": {"type": "ephemeral"}}
            )
        output_config: dict = {"effort": self.effort}
        if self.mode == "json_schema":
            output_config["format"] = {"type": "json_schema", "schema": strict_schema(req.schema)}
        else:
            prompt = prompt + "\n\n" + schema_prompt(req.schema)
        content.append({"type": "text", "text": prompt})

        kwargs: dict = dict(
            model=self.model.id,
            max_tokens=max_tokens,
            system=req.system,
            messages=[{"role": "user", "content": content}],
            output_config=output_config,
        )
        if self.model.id in FALLBACK_MODELS:
            kwargs["betas"] = [FALLBACK_BETA]
            kwargs["fallbacks"] = "default"

        try:
            async with self.client.beta.messages.stream(**kwargs) as stream:
                msg = await stream.get_final_message()
        except anthropic.AuthenticationError as exc:
            raise LLMError("Anthropic rejected the API key (ANTHROPIC_API_KEY).") from exc
        except anthropic.PermissionDeniedError as exc:
            raise LLMError(f"Anthropic permission denied: {exc.message}") from exc
        except anthropic.NotFoundError as exc:
            raise LLMError(f"Model '{self.model.id}' was not found: {exc.message}") from exc
        except anthropic.RateLimitError as exc:
            raise LLMError("Anthropic rate limit reached; wait and retry.") from exc
        except anthropic.BadRequestError as exc:
            text = str(exc.message).lower()
            if self.mode == "json_schema" and any(
                k in text for k in ("schema", "output_config", "format")
            ):
                raise SchemaUnsupported(exc.message) from exc
            raise LLMError(f"Anthropic rejected the request: {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise LLMError("Could not reach the Anthropic API (network error).") from exc
        except anthropic.APIStatusError as exc:
            raise LLMError(f"Anthropic API error {exc.status_code}: {exc.message}") from exc

        if msg.stop_reason == "refusal":
            raise LLMError(
                "The model declined this request (safety classifier). Try a different model."
            )
        u = msg.usage
        usage = Usage(
            calls=1,
            input_tokens=u.input_tokens or 0,
            output_tokens=u.output_tokens or 0,
            cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
            cache_write_tokens=getattr(u, "cache_creation_input_tokens", 0) or 0,
        )
        text = "".join(b.text for b in msg.content if b.type == "text")
        return RawCompletion(text=text, usage=usage, truncated=msg.stop_reason == "max_tokens")
