"""Convert Pydantic models into JSON Schemas accepted by strict structured-output modes.

Strict modes (OpenAI `strict: true`, Anthropic `output_config.format`, Gemini, Ollama) share a
common subset: every object lists all properties as required, sets
`additionalProperties: false`, and avoids validation keywords such as `default` or `title`.
`$ref`s are inlined because some OpenAI-compatible backends do not resolve them.
"""

import json
import re
from typing import Any

from pydantic import BaseModel

_DROP_KEYS = {"title", "default", "examples"}


def _inline(node: Any, defs: dict[str, Any]) -> Any:
    if isinstance(node, dict):
        if "$ref" in node:
            name = node["$ref"].split("/")[-1]
            resolved = _inline(defs[name], defs)
            extra = {k: v for k, v in node.items() if k != "$ref"}
            return {**resolved, **_inline(extra, defs)}
        return {k: _inline(v, defs) for k, v in node.items() if k != "$defs"}
    if isinstance(node, list):
        return [_inline(v, defs) for v in node]
    return node


def _strictify(node: Any) -> Any:
    if isinstance(node, dict):
        out = {k: _strictify(v) for k, v in node.items() if k not in _DROP_KEYS}
        if isinstance(node.get("properties"), dict):
            # property *names* may collide with dropped metadata keys (e.g. a field called "title")
            out["properties"] = {k: _strictify(v) for k, v in node["properties"].items()}
        if out.get("type") == "object" and "properties" in out:
            out["required"] = list(out["properties"].keys())
            out["additionalProperties"] = False
        return out
    if isinstance(node, list):
        return [_strictify(v) for v in node]
    return node


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    raw = model.model_json_schema()
    defs = raw.get("$defs", {})
    return _strictify(_inline(raw, defs))


def schema_name(model: type[BaseModel]) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", model.__name__)[:64]


def schema_prompt(model: type[BaseModel]) -> str:
    """Instructions used when the provider cannot enforce the schema itself."""
    return (
        "Respond with a single JSON object that conforms exactly to this JSON Schema. "
        "Output only the JSON, with no prose or code fences.\n\n"
        + json.dumps(strict_schema(model), separators=(",", ":"))
    )


_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.S)
_THINK_RE = re.compile(r"<think>.*?</think>", re.S)


def extract_json_text(text: str) -> str:
    """Best-effort extraction of a JSON object from model output."""
    text = _THINK_RE.sub("", text).strip()
    m = _FENCE_RE.match(text)
    if m:
        text = m.group(1)
    if not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            text = text[start : end + 1]
    return text
