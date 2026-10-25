"""Markdown export (the Obsidian plugin's note format) and its safety pass."""

import re

import pytest
from fastapi.testclient import TestClient

from app.export_md import WJ, _safe
from app.main import app
from test_api import generated, _wait  # noqa: F401  (module fixture reused)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_obsidian_markdown_has_structure(client, generated):
    pid, _ = generated
    r = client.get(f"/api/papers/{pid}/export.md",
                   params={"asset_prefix": "softmax-", "pdf_link": "Papers/sample.pdf"})
    assert r.status_code == 200, r.text
    data = r.json()
    md = data["markdown"]
    assert md.startswith("---\ntitle: ") and "\ntags:\n  - paper2chapter\n---\n" in md
    assert 'source_pdf: "[[Papers/sample.pdf]]"' in md
    assert "\n# " in md and "## Intuition first" in md and "## Practice problems" in md
    assert "> [!question] Exercise 1" in md and "> > [!success]- Solution" in md
    assert "$$\n" in md  # display math blocks
    # the figure placeholder becomes an embed with the prefix, and is listed as an asset
    assert "![[softmax-F1.png]]" in md and data["assets"] == ["F1.png"]
    assert "*Figure 1: Softmax weights" in md and "Figure F1: Figure 1" not in md
    # citations: references link to block ids, pages to the PDF in the vault
    assert re.search(r"\(\[\[#\^ref-R1\|1\]\]\)", md) and " ^ref-R1" in md and "[[[" not in md
    assert "[[Papers/sample.pdf#page=" in md
    assert "✅" in md  # verification marks
    assert data["filename"].endswith(".md") and "/" not in data["filename"]
    assert "{{fig:" not in md and "[@" not in md


def test_solutions_can_be_left_out(client, generated):
    pid, _ = generated
    md = client.get(f"/api/papers/{pid}/export.md", params={"solutions": False}).json()["markdown"]
    assert "[!success]- Solution" not in md and "def softmax(z):\n    m = max(z)" not in md
    assert "[!question]" in md


def test_commonmark_flavor(client, generated):
    pid, _ = generated
    md = client.get(f"/api/papers/{pid}/export.md", params={"flavor": "commonmark"}).json()["markdown"]
    assert not md.startswith("---") and "[!question]" not in md and "![[" not in md
    assert "(#ref-R1)" in md and '<a id="ref-R1"></a>' in md and "(checked)" in md


@pytest.mark.parametrize("params", [{"asset_prefix": "../x"}, {"pdf_link": "a]]b"}, {"pdf_link": "a|b"}])
def test_rejects_bad_params(client, generated, params):
    pid, _ = generated
    assert client.get(f"/api/papers/{pid}/export.md", params=params).status_code == 400


def test_safe_neutralises_executable_content():
    text = ("Intro <script>alert(1)</script> and <% tp.file.create_new() %>.\n"
            "Inline `= this.file.name` and `$= dv.current()`.\n"
            "```dataviewjs\napp.vault.delete()\n```\n"
            "```python\nprint('<% ok %>')\n```\n"
            "Math $a<b$ and $$x<y$$ stays.")
    out = _safe(text)
    assert "<script>" not in out and "&lt;script>" in out
    assert "<%" not in out and f"<{WJ}%" in out
    assert f"`{WJ}= this.file.name`" in out and f"`{WJ}$= dv.current()`" in out
    assert "```dataviewjs" not in out and "```text\napp.vault.delete()" in out
    assert "```python\n" in out  # allowed languages keep their tag
    assert "$a<b$" in out and "$$x<y$$" in out  # math untouched
