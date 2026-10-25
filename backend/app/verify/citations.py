"""Check that every citation and figure/table placeholder in a chapter resolves.

Citation syntax: `[@R12]`, `[@p4]` (source paper page), or grouped `[@R1; @R3]`.
Unknown references are rewritten to `[@?R99]` so the reader can flag them visibly instead of
silently presenting an invented source.
"""

import re
from typing import Any

from pydantic import BaseModel

CITE_RE = re.compile(r"\[@([^\]]+)\]")
PLACEHOLDER_RE = re.compile(r"\{\{(fig|table):([A-Za-z0-9]+)\}\}")


def _walk_md(obj: Any, fn, key: str = "") -> Any:
    """Apply fn to every string stored under a key ending in `_md` (including lists)."""
    if isinstance(obj, dict):
        return {k: _walk_md(v, fn, k) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_walk_md(v, fn, key) for v in obj]
    if isinstance(obj, str) and key.endswith("_md"):
        return fn(obj)
    return obj


def check_and_fix(
    data: dict, ref_ids: set[str], page_count: int, figure_ids: set[str], table_ids: set[str]
) -> tuple[dict, dict[str, int], list[str]]:
    stats = {"citations": 0, "unresolved": 0, "placeholders_removed": 0}
    unknown: set[str] = set()

    def fix(text: str) -> str:
        def cite(m: re.Match) -> str:
            keys = [k.strip().lstrip("@") for k in re.split(r"[;,]", m.group(1)) if k.strip()]
            out = []
            for k in keys:
                stats["citations"] += 1
                ok = k in ref_ids or (re.fullmatch(r"p(\d+)", k) and 1 <= int(k[1:]) <= page_count)
                if not ok:
                    stats["unresolved"] += 1
                    unknown.add(k)
                out.append(f"@{k}" if ok else f"@?{k}")
            return "[" + "; ".join(out) + "]"

        def placeholder(m: re.Match) -> str:
            kind, ident = m.group(1), m.group(2)
            if ident in (figure_ids if kind == "fig" else table_ids):
                return m.group(0)
            stats["placeholders_removed"] += 1
            return ""

        return PLACEHOLDER_RE.sub(placeholder, CITE_RE.sub(cite, text))

    fixed = _walk_md(data, fix)
    warnings = []
    if unknown:
        warnings.append(
            "Unresolved citations were flagged (not in the paper's reference list): "
            + ", ".join(sorted(unknown)[:20])
        )
    return fixed, stats, warnings


def apply_to_model(model: BaseModel, **kwargs) -> tuple[BaseModel, dict[str, int], list[str]]:
    data, stats, warnings = check_and_fix(model.model_dump(), **kwargs)
    return type(model).model_validate(data), stats, warnings
