"""A paper's DOI and arXiv id, when its first page prints them.

Used by the parts export, so that a client can find the paper's own note (by DOI or arXiv id) or a reference
manager's item. Only the first page is read: a paper's identifiers are stamped there (the journal header, arXiv's
margin), while later pages cite other papers. Either id may be absent, and a first page can name another paper's DOI
(a "published as" note on a preprint), so a client should treat a match as a suggestion.
"""

import re

from pydantic import BaseModel

from .models import Extraction

_DOI_RE = re.compile(r"\b10\.\d{4,9}/[^\s\"<>]+")
_ARXIV_RE = re.compile(
    r"\barxiv(?:\.org/(?:abs|pdf)/|:\s?)(\d{4}\.\d{4,5}|[a-z][a-z\-]*(?:\.[a-z]{2})?/\d{7})", re.I)


class PaperIds(BaseModel):
    doi: str | None = None
    arxiv: str | None = None


def _trim_doi(doi: str) -> str:
    """Drop the punctuation a sentence leaves after a DOI, and a closing bracket the DOI did not open."""
    while doi:
        if doi[-1] in ".,;:'":
            doi = doi[:-1]
        elif doi[-1] in ")]}" and doi.count({")": "(", "]": "[", "}": "{"}[doi[-1]]) < doi.count(doi[-1]):
            doi = doi[:-1]
        else:
            break
    return doi


def paper_ids(ex: Extraction) -> PaperIds:
    if not ex.pages:
        return PaperIds()
    first = min(ex.pages, key=lambda p: p.page)
    text = first.markdown.replace("\\", "")  # Markdown escapes (`\_`) are not part of an id
    doi = _DOI_RE.search(text)
    arxiv = _ARXIV_RE.search(text)
    return PaperIds(doi=_trim_doi(doi.group(0)) if doi else None, arxiv=arxiv.group(1) if arxiv else None)
