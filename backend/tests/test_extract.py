import os
from pathlib import Path

import pytest

from app.pdf_extract import ExtractionError, extract_pdf, parse_references


def test_extracts_title_figure_and_references(sample_pdf, tmp_path):
    ex = extract_pdf(sample_pdf, "abc123abc123", "sample.pdf", tmp_path)
    assert ex.page_count == 3
    assert ex.title_guess == "Softmax Weighting for Robust Averaging"
    assert "softmax over relevance scores" in ex.full_text()

    assert len(ex.figures) == 1
    fig = ex.figures[0]
    assert fig.page == 3
    assert fig.caption.startswith("Figure 1")
    assert (tmp_path / fig.image_file).is_file()

    assert [r.id for r in ex.references] == ["R1", "R2", "R3"]
    assert ex.references[1].text.startswith("B. Builder")


def test_rejects_non_pdf(tmp_path):
    bad = tmp_path / "x.pdf"
    bad.write_bytes(b"not a pdf")
    with pytest.raises(ExtractionError):
        extract_pdf(bad, "abc123abc123", "x.pdf", tmp_path)


def test_parse_references_numbered_and_author_year():
    numbered = "Text.\n\n## References\n\n1. Alpha A. A paper title here. 2020.\n2. Beta B. Another paper title. 2021.\n3. Gamma G. Third paper title here. 2022.\n"
    assert [r.number for r in parse_references(numbered)] == [1, 2, 3]

    author_year = ("## Bibliography\n\n- Smith, J. (2020). A long enough reference title.\n\n"
                   "- Jones, K. (2019). Another long enough reference title.\n")
    refs = parse_references(author_year)
    assert len(refs) == 2 and refs[0].text.startswith("Smith")

    assert parse_references("No reference section in this text.") == []


def test_inline_bold_references_heading():
    text = "thanks for comments. **References** [1] First Author. Title one is long. 2017.\n\n- [2] Second Author. Title two is long. 2018.\n\n- [3] Third Author. Title three is long. 2019."
    assert len(parse_references(text)) == 3


@pytest.mark.skipif(not os.environ.get("P2C_SAMPLE_PDF"), reason="set P2C_SAMPLE_PDF to a real paper")
def test_real_paper(tmp_path):
    ex = extract_pdf(Path(os.environ["P2C_SAMPLE_PDF"]), "abc123abc123", "real.pdf", tmp_path)
    assert ex.page_count > 0 and ex.references and ex.figures
