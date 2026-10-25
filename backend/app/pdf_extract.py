"""PDF ingestion: text, figures, tables, equation regions and references.

Uses PyMuPDF + pymupdf4llm layout analysis, which classifies page regions (text, section-header,
picture, caption, table, formula, ...) and renders tables as Markdown. Figures are rendered from
their layout box, so vector graphics are captured as well as embedded bitmaps.

Known limitations (documented, not hidden):
  * Equations cannot be recovered as LaTeX from PDF text. We keep the raw text plus a cropped
    image of each formula region; the analysis step asks the LLM to reconstruct LaTeX, and
    providers that accept PDF input receive the original file for higher fidelity.
  * Scanned PDFs need OCR (pymupdf4llm uses RapidOCR when it is installed).

License note: PyMuPDF is AGPL-3.0 (or commercial). Everything PDF-specific is isolated in this
module so it can be swapped for a permissively licensed parser if needed.
"""

import logging
import re
from pathlib import Path

import pymupdf

from .models import EquationRegion, Extraction, Figure, PageText, Reference, Table

log = logging.getLogger(__name__)

MIN_FIGURE_PT = 40  # ignore pictures smaller than this (logos, glyphs)
FIGURE_DPI = 150
MAX_REFERENCES = 400

_PICTURE_TEXT_RE = re.compile(r"<!-- (Start|End) of picture text -->")
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_FIG_CAPTION_RE = re.compile(r"^\W*(fig(ure)?\.?)\s*\d+", re.I)
_TAB_CAPTION_RE = re.compile(r"^\W*table\s*[\dIVX]+", re.I)
_REF_WORDS = r"(?:References|REFERENCES|Bibliography|BIBLIOGRAPHY|Works Cited|Literature Cited)"
# Either a heading on its own line, or a bold run anywhere (layout engines sometimes inline it).
_REF_HEADING_RE = re.compile(
    r"(?:(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?[ \t]*(?:\d+\.?[ \t]*)?"
    + _REF_WORDS
    + r"[ \t]*(?:\*\*|__)?[ \t]*(?=\n))|(?:\*\*[ \t]*(?:\d+\.?[ \t]*)?"
    + _REF_WORDS
    + r"[ \t]*\*\*)"
)
_CAPTION_LINE_RE = re.compile(r"(?:^|\n)\W*((?:Figure|Fig\.)\s*\d+\s*[:.].{3,300})")
_APPENDIX_RE = re.compile(
    r"\n[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?[ \t]*(?:[A-H](?:\.\d+)?[ \t]+)?"
    r"(Appendix|APPENDIX|Supplementary Material|Supplemental Material)\b"
)


class ExtractionError(Exception):
    pass


def _clean_markdown(md: str) -> str:
    md = _PICTURE_TEXT_RE.sub("", md)
    md = _COMMENT_RE.sub("", md)
    md = md.replace("<br>", "\n")
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip()


def _box_text(page_text: str, box: dict) -> str:
    pos = box.get("pos")
    if not pos:
        return ""
    return _clean_markdown(page_text[pos[0] : pos[1]])


def _strip_md(s: str) -> str:
    s = re.sub(r"[*_`]+", "", s)
    s = re.sub(r"</?(sup|sub|u|b|i)>", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _nearest_caption(box: dict, captions: list[tuple[dict, str]], pattern: re.Pattern) -> str:
    """Caption whose vertical distance to the box is smallest, restricted to a caption style."""
    x0, y0, x1, y1 = box["bbox"]
    best, best_d = "", float("inf")
    for cbox, text in captions:
        if not pattern.match(_strip_md(text)):
            continue
        cy0, cy1 = cbox["bbox"][1], cbox["bbox"][3]
        d = cy0 - y1 if cy0 >= y1 else (y0 - cy1 if cy1 <= y0 else 0)
        # captions in multi-column layouts may sit beside the figure; penalise horizontal gaps
        cx0, cx1 = cbox["bbox"][0], cbox["bbox"][2]
        if cx1 < x0 or cx0 > x1:
            d += 200
        if d < best_d:
            best, best_d = text, d
    return _strip_md(best) if best_d < 400 else ""


def parse_references(full_text: str) -> list[Reference]:
    matches = list(_REF_HEADING_RE.finditer(full_text))
    if not matches:
        return []
    start = matches[-1].end()
    body = full_text[start:]
    appendix = _APPENDIX_RE.search(body)
    if appendix:
        body = body[: appendix.start()]
    body = re.sub(r"<!-- page \d+ -->", "\n", body)
    body = re.sub(r"\n[ \t]*\d{1,3}[ \t]*\n", "\n", body)  # bare page numbers

    refs: list[Reference] = []
    bracketed = list(re.finditer(r"\[(\d{1,3})\]", body))
    numbered = list(re.finditer(r"(?:^|\n)[ \t]*(?:-[ \t]+)?(\d{1,3})\.[ \t]+(?=[A-Z])", body))
    if len(bracketed) >= 3:
        for i, m in enumerate(bracketed):
            end = bracketed[i + 1].start() if i + 1 < len(bracketed) else len(body)
            refs.append(Reference(id="", number=int(m.group(1)), text=body[m.end() : end]))
    elif len(numbered) >= 3:
        for i, m in enumerate(numbered):
            end = numbered[i + 1].start() if i + 1 < len(numbered) else len(body)
            refs.append(Reference(id="", number=int(m.group(1)), text=body[m.end() : end]))
    else:  # author-year style: one entry per list item / paragraph
        parts = re.split(r"\n[ \t]*-[ \t]+|\n[ \t]*\n", body)
        refs = [Reference(id="", number=None, text=p) for p in parts]

    out: list[Reference] = []
    for r in refs:
        text = _strip_md(re.sub(r"^\s*-\s+", "", r.text))
        text = re.sub(r"\s+-\s*$", "", text).strip()
        if len(text) < 20:
            continue
        out.append(Reference(id=f"R{len(out) + 1}", number=r.number, text=text[:1000]))
        if len(out) >= MAX_REFERENCES:
            break
    return out


def _render_clip(page: pymupdf.Page, bbox, path: Path) -> tuple[int, int]:
    rect = pymupdf.Rect(bbox) & page.rect
    pix = page.get_pixmap(clip=rect, dpi=FIGURE_DPI)
    pix.save(str(path))
    return pix.width, pix.height


def _layout_chunks(doc: pymupdf.Document) -> list[dict] | None:
    try:
        import pymupdf4llm

        return pymupdf4llm.to_markdown(doc, page_chunks=True, show_progress=False)
    except Exception as exc:  # layout engine failure: fall back to plain text
        log.warning("pymupdf4llm failed (%s); falling back to plain text extraction", exc)
        return None


def extract_pdf(pdf_path: Path, paper_id: str, filename: str, assets_dir: Path) -> Extraction:
    try:
        doc = pymupdf.open(pdf_path)
    except Exception as exc:
        raise ExtractionError(f"Could not open PDF: {exc}") from exc
    if doc.needs_pass:
        raise ExtractionError("The PDF is password-protected.")
    if doc.page_count == 0:
        raise ExtractionError("The PDF has no pages.")

    warnings: list[str] = []
    if doc.page_count > 60:
        warnings.append(
            f"Long document ({doc.page_count} pages); generation will use summaries of parts "
            "of the text, so some details may be missed."
        )

    chunks = _layout_chunks(doc)
    pages: list[PageText] = []
    figures: list[Figure] = []
    tables: list[Table] = []
    equations: list[EquationRegion] = []

    if chunks is None:
        warnings.append("Layout analysis failed; figures and tables were not extracted.")
        for i, page in enumerate(doc):
            pages.append(PageText(page=i + 1, markdown=page.get_text("text")))
    else:
        for i, chunk in enumerate(chunks):
            page = doc[i]
            raw = chunk.get("text", "")
            pages.append(PageText(page=i + 1, markdown=_clean_markdown(raw)))
            boxes = chunk.get("page_boxes", []) or []
            captions = [(b, _box_text(raw, b)) for b in boxes if b.get("class") == "caption"]
            for b in boxes:
                cls = b.get("class")
                x0, y0, x1, y1 = b["bbox"]
                if cls == "picture":
                    if (x1 - x0) < MIN_FIGURE_PT or (y1 - y0) < MIN_FIGURE_PT:
                        continue
                    fid = f"F{len(figures) + 1}"
                    name = f"{fid}.png"
                    try:
                        w, h = _render_clip(page, b["bbox"], assets_dir / name)
                    except Exception as exc:
                        warnings.append(f"Could not render figure on page {i + 1}: {exc}")
                        continue
                    figures.append(
                        Figure(
                            id=fid,
                            page=i + 1,
                            caption=_nearest_caption(b, captions, _FIG_CAPTION_RE),
                            image_file=name,
                            width=w,
                            height=h,
                        )
                    )
                elif cls == "table":
                    md = _box_text(raw, b)
                    if md:
                        tables.append(
                            Table(
                                id=f"T{len(tables) + 1}",
                                page=i + 1,
                                caption=_nearest_caption(b, captions, _TAB_CAPTION_RE),
                                markdown=md,
                            )
                        )
                elif cls == "formula":
                    eid = f"X{len(equations) + 1}"
                    name = f"{eid}.png"
                    try:
                        _render_clip(page, b["bbox"], assets_dir / name)
                    except Exception:
                        name = None
                    equations.append(
                        EquationRegion(id=eid, page=i + 1, raw_text=_box_text(raw, b), image_file=name)
                    )

    total_chars = sum(len(p.markdown) for p in pages)
    if total_chars < 200 * doc.page_count:
        warnings.append(
            "Very little text was found. The PDF may be scanned; results will be poor without OCR."
        )

    extraction = Extraction(
        paper_id=paper_id,
        filename=filename,
        page_count=doc.page_count,
        title_guess=_guess_title(pages, doc.metadata or {}, filename),
        pages=pages,
        figures=figures,
        tables=tables,
        equations=equations,
        references=[],
        warnings=warnings,
    )
    _fill_missing_captions(extraction)
    extraction.references = parse_references(extraction.full_text())
    if not extraction.references:
        extraction.warnings.append("No reference list was detected; citations to the paper's sources are unavailable.")
    doc.close()
    return extraction


def _fill_missing_captions(extraction: Extraction) -> None:
    """Assign 'Figure N: ...' lines from the page text to figures whose caption box was missed."""
    used = {f.caption for f in extraction.figures if f.caption}
    for page in extraction.pages:
        missing = [f for f in extraction.figures if f.page == page.page and not f.caption]
        if not missing:
            continue
        candidates = [
            c for c in (_strip_md(m.group(1)) for m in _CAPTION_LINE_RE.finditer(page.markdown))
            if c not in used
        ]
        # several sub-pictures often share one caption; reuse the last candidate
        for idx, fig in enumerate(missing):
            if candidates:
                fig.caption = candidates[min(idx, len(candidates) - 1)]


def _guess_title(pages: list[PageText], metadata: dict, filename: str) -> str:
    if pages:
        m = re.search(r"^#{1,2}\s+(.+)$", pages[0].markdown, re.M)
        if m:
            title = _strip_md(m.group(1))
            if 5 <= len(title) <= 300:
                return title
    title = (metadata.get("title") or "").strip()
    if len(title) >= 5:
        return title
    return Path(filename).stem
