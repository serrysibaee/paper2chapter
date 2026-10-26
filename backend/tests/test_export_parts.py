"""The parts export (`export.parts`), page-link templates, and the paper ids found on a PDF's first page.

The parts are the chapter note's own pieces: each fragment must be exactly the text `export.md` puts in that place,
already made inert, so a client that assembles its own note from them gets the same content and the same safety.
"""

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.export_md import render_chapter_markdown, render_chapter_parts
from app.identifiers import PaperIds, paper_ids
from app.main import app
from app.models import Chapter, Extraction, PageText, PaperAnalysis
from test_api import generated, _wait  # noqa: F401  (module fixture reused)

FIX = Path(__file__).parent / "fixtures"
GOLD = (FIX / "export-obsidian-pdf.md").read_text(encoding="utf-8")
OPTS = dict(flavor="obsidian", asset_prefix="softmax-", pdf_link="Papers/sample.pdf")
ZOTERO = "zotero://open-pdf/library/items/ABCD1234?page={page}"


@pytest.fixture(scope="module")
def chapter() -> Chapter:
    return Chapter.model_validate(json.loads((FIX / "chapter.json").read_text(encoding="utf-8")))


@pytest.fixture(scope="module")
def analysis() -> PaperAnalysis:
    return PaperAnalysis.model_validate(json.loads((FIX / "analysis.json").read_text(encoding="utf-8")))


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def block(md: str, heading: str, stop: str = r"\n\n## ") -> str:
    """The text under `heading`, up to the next heading that matches `stop` (or the end)."""
    start = md.index(heading + "\n\n") + len(heading) + 2
    m = re.compile(stop).search(md, start)
    return md[start:m.start() if m else len(md.rstrip("\n"))]


def quoted(text: str) -> str:
    return "\n".join(("> " + line).rstrip() for line in text.split("\n"))


def strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from strings(v)


# --------------------------------------------------------------------------- the parts are the note's pieces


def test_parts_are_the_notes_own_pieces(chapter, analysis):
    p = render_chapter_parts(chapter, analysis=analysis, **OPTS)
    assert p.version == 1 and p.paper_id == chapter.paper_id and p.title == chapter.title
    assert p.provider == "mock" and p.audience == "undergraduate" and p.flavor == "obsidian"
    assert "> [!info] About this chapter\n" + quoted(p.about) in GOLD
    assert "> [!abstract] Learning objectives\n" + quoted(p.objectives) in GOLD
    assert block(GOLD, "## Intuition first") == p.intuition
    assert [x.title for x in p.primers] == ["Weighted averages", "Vectors and dot products"]
    for pr in p.primers:
        assert block(GOLD, f"### {pr.title}", stop=r"\n\n#{2,3} ") == pr.md
    assert block(GOLD, "## Notation") == p.notation
    assert [s.number for s in p.sections] == [1, 2]
    for s in p.sections:
        assert block(GOLD, f"## {s.number}. {s.title}") == s.md
    assert block(GOLD, "## Summary", stop=r"\n\n#{2,3} ") == p.summary
    assert block(GOLD, "### Key takeaways", stop=r"\n\n#{2,3} ") == p.takeaways
    assert block(GOLD, "### Common misconceptions") == p.misconceptions
    assert block(GOLD, "## Practice problems") == "\n\n".join(p.practice)
    assert block(GOLD, "## Further reading") == p.further_reading
    assert block(GOLD, "## References (from the paper)") == p.references
    assert p.warnings == "" and p.assets == ["F1.png"]


def test_a_section_in_its_pieces(chapter, analysis):
    s = render_chapter_parts(chapter, analysis=analysis, **OPTS).sections[0]
    assert (s.id, s.number, s.title) == ("s1", 1, "From scores to weights")
    assert s.pages == [1, 3]  # a page citation and a figure's caption
    assert s.md.startswith("> [!tip] Intuition\n" + quoted(s.intuition))
    assert s.body and s.body in s.md
    assert s.derivations and all(f"### Derivation: {d.title}\n\n{d.md}" in s.md for d in s.derivations)
    assert s.worked_examples
    for e in s.worked_examples:
        mark = {"verified": " ✅", "failed": " ❌", "error": " ➖", "skipped": " ⏸", None: ""}[e.check]
        assert quoted(f"[!example] Worked example: {e.title}{mark}\n{e.md}") in s.md
    assert s.check_questions and all(q.startswith("> [!question] Exercise ") and q in s.md for q in s.check_questions)


def test_what_the_analysis_adds(chapter, analysis):
    p = render_chapter_parts(chapter, analysis=analysis, **OPTS)
    assert p.one_line == analysis.one_sentence_summary
    assert p.new_or_surprising == "- A softmax-weighted average of values\n- A scaling rule for scores"
    assert (p.paper.title, p.paper.authors, p.paper.year, p.paper.field) == (
        chapter.paper_title, chapter.paper_authors, analysis.year, analysis.field)
    assert [(x.id, x.known, x.primed) for x in p.prerequisites] == [
        ("exponential-function", True, False), ("weighted-averages", False, True), ("vectors-dot-products", False, True)]
    assert all(x.name and x.why_needed and x.level for x in p.prerequisites)


def test_without_an_analysis_the_primers_still_name_the_prerequisites(chapter):
    p = render_chapter_parts(chapter, analysis=None, **OPTS)
    assert p.one_line == "" and p.new_or_surprising == "" and p.paper.year is None
    assert [(x.id, x.known, x.primed) for x in p.prerequisites] == [
        ("weighted-averages", False, True), ("vectors-dot-products", False, True), ("exponential-function", True, False)]


def test_every_fragment_is_inert(chapter, analysis):
    evil = ("Look <script>x</script> <% tp.file.create_new() %> `= this.file.name` `$= dv.current()`\n"
            "```dataviewjs\napp.vault.delete()\n```\n")
    ch = chapter.model_copy(deep=True)
    ch.intuition_md = ch.summary_md = ch.sections[0].body_md = ch.sections[0].intuition_md = evil
    ch.primers[0].explanation_md = ch.practice[0].prompt_md = ch.practice[0].explanation_md = evil
    ch.sections[0].title = ch.primers[0].title = ch.learning_objectives[0] = "T <% x %> <b>"
    ch.key_takeaways = ch.common_misconceptions = ch.warnings = [evil]
    a = analysis.model_copy(deep=True)
    a.one_sentence_summary, a.key_contributions = evil, [evil]
    a.prerequisites[0].name = a.prerequisites[0].why_needed = "N <% y %> <i>"
    for s in strings(render_chapter_parts(ch, analysis=a, **OPTS).model_dump()):
        assert "<%" not in s and "<script" not in s and "<b>" not in s and "<i>" not in s, s
        assert "`= " not in s and "`$= " not in s, s
        # a block runs only as a fence opening its line (inside callouts too); one-line text keeps it inline code
        assert not re.search(r"(?m)^(?:> ?)*[ \t]*(?:`{3,}|~{3,})[ \t]*dataviewjs", s), s


# --------------------------------------------------------------------------- page-link templates


def test_page_links_follow_the_template(chapter):
    md = render_chapter_markdown(chapter, page_link=ZOTERO, **OPTS).markdown
    assert "([p. 1](zotero://open-pdf/library/items/ABCD1234?page=1))" in md
    assert "(paper [p. 3](zotero://open-pdf/library/items/ABCD1234?page=3))" in md
    assert "#page=" not in md
    assert 'source_pdf: "[[Papers/sample.pdf]]"' in md  # the note still names its PDF
    cm = render_chapter_markdown(chapter, flavor="commonmark", page_link=ZOTERO).markdown
    assert "([p. 1](zotero://open-pdf/library/items/ABCD1234?page=1))" in cm


def test_parts_follow_the_template_too(chapter, analysis):
    p = render_chapter_parts(chapter, analysis=analysis, page_link=ZOTERO, **OPTS)
    assert "[p. 1](zotero://open-pdf/library/items/ABCD1234?page=1)" in p.sections[0].md
    assert not any("#page=" in s for s in strings(p.model_dump()))


# --------------------------------------------------------------------------- ids on the first page


def _ex(page1: str) -> Extraction:
    return Extraction(paper_id="x", filename="a.pdf", page_count=2, title_guess="",
                      pages=[PageText(page=1, markdown=page1), PageText(page=2, markdown="see 10.9999/other.2")])


@pytest.mark.parametrize("text, ids", [
    ("arXiv:2303.04137v5 [cs.RO] 14 Mar 2024", PaperIds(arxiv="2303.04137")),
    ("Preprint at arxiv.org/abs/2412.04453.", PaperIds(arxiv="2412.04453")),
    ("An old one, arXiv:cs/0501001v2.", PaperIds(arxiv="cs/0501001")),
    ("Published in RA-L. https://doi.org/10.1109/LRA.2023.3301234.", PaperIds(doi="10.1109/LRA.2023.3301234")),
    ("(DOI: 10.1145/3815113)", PaperIds(doi="10.1145/3815113")),
    ("doi 10.1000/abc\\_def, 2020", PaperIds(doi="10.1000/abc_def")),
    ("No identifier on this page.", PaperIds()),  # page 2's DOI is someone else's
])
def test_ids_on_the_first_page(text, ids):
    assert paper_ids(_ex(text)) == ids


# --------------------------------------------------------------------------- the endpoints


def test_parts_endpoint_matches_the_markdown(client, generated):
    pid, _ = generated
    params = {"asset_prefix": "softmax-", "pdf_link": "Papers/sample.pdf"}
    md = client.get(f"/api/papers/{pid}/export.md", params=params).json()["markdown"]
    r = client.get(f"/api/papers/{pid}/export.parts", params=params)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["version"] == 1 and d["paper_id"] == pid and d["assets"] == ["F1.png"]
    assert d["paper"]["page_count"] == 3 and d["paper"]["doi"] is None and d["paper"]["arxiv"] is None
    assert d["sections"] and all(block(md, f"## {s['number']}. {s['title']}") == s["md"] for s in d["sections"])
    assert d["one_line"] and d["prerequisites"][0]["known"] is True


def test_page_link_on_both_endpoints(client, generated):
    pid, _ = generated
    for ep in ("export.md", "export.parts"):
        r = client.get(f"/api/papers/{pid}/{ep}", params={"page_link": ZOTERO})
        assert r.status_code == 200, r.text
        assert "zotero://open-pdf/library/items/ABCD1234?page=1" in r.text


@pytest.mark.parametrize("bad", [
    "zotero://open-pdf/library/items/ABCD1234?page=1",  # no {page}
    "https://example.org/{page}/{page}",                # {page} twice
    "javascript:alert({page})",                         # not an allowed scheme
    "file:///C:/My Papers/a.pdf#page={page}",           # a space must be %20
    "https://example.org/a(b)?p={page}",                # brackets would end the Markdown link
    "https://example.org/" + "x" * 500 + "?p={page}",   # too long
])
def test_rejects_bad_page_links(client, generated, bad):
    pid, _ = generated
    for ep in ("export.md", "export.parts"):
        assert client.get(f"/api/papers/{pid}/{ep}", params={"page_link": bad}).status_code == 400


def test_parts_rejects_what_markdown_rejects(client, generated):
    pid, _ = generated
    for params in ({"asset_prefix": "../x"}, {"pdf_link": "a]]b"}):
        assert client.get(f"/api/papers/{pid}/export.parts", params=params).status_code == 400
