"""export.md is pinned byte for byte.

The parts export (`export.parts`) is built by the same renderer, so this test guards the note every existing user
already gets. The fixtures are one mock-provider chapter (`fixtures/chapter.json`) and the notes the renderer made
from it before the parts export existed (`fixtures/export-*.md`).
"""

import json
from pathlib import Path

import pytest

from app.export_md import render_chapter_markdown
from app.models import Chapter

FIX = Path(__file__).parent / "fixtures"
VARIANTS = {
    "obsidian-pdf": dict(flavor="obsidian", asset_prefix="softmax-", pdf_link="Papers/sample.pdf"),
    "obsidian": dict(flavor="obsidian"),
    "commonmark": dict(flavor="commonmark"),
    "obsidian-nosolutions": dict(flavor="obsidian", include_solutions=False),
}


@pytest.fixture(scope="module")
def chapter() -> Chapter:
    return Chapter.model_validate(json.loads((FIX / "chapter.json").read_text(encoding="utf-8")))


@pytest.mark.parametrize("name", list(VARIANTS))
def test_markdown_is_unchanged(chapter, name):
    out = render_chapter_markdown(chapter, **VARIANTS[name])
    assert out.markdown == (FIX / f"export-{name}.md").read_text(encoding="utf-8")
    assert out.assets == ["F1.png"]
