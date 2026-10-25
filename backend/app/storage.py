"""File-based storage: one directory per paper holding the PDF and JSON artifacts.

Layout::

    data/
      settings.json
      papers/<paper_id>/
        paper.json        PaperRecord
        source.pdf
        extraction.json   Extraction
        analysis.json     PaperAnalysis
        chapter.json      Chapter
        assets/           figure and equation images

A database would add little for a single-user MVP; swapping this class out is the
migration path if multi-user support is needed.
"""

import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from .models import PaperRecord

T = TypeVar("T", bound=BaseModel)

PAPER_ID_RE = re.compile(r"^[a-f0-9]{12}$")
ASSET_RE = re.compile(r"^[A-Za-z0-9_.-]+\.png$")


class NotFound(Exception):
    pass


def _atomic_write(path: Path, data: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=path.suffix)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(data)
    # On Windows os.replace can fail transiently while another thread reads the file.
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.05 * (attempt + 1))


class Store:
    def __init__(self, root: Path):
        self.root = root
        self.papers_dir = root / "papers"
        self.papers_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ papers

    def paper_dir(self, paper_id: str) -> Path:
        if not PAPER_ID_RE.match(paper_id):
            raise NotFound(paper_id)
        return self.papers_dir / paper_id

    def assets_dir(self, paper_id: str) -> Path:
        d = self.paper_dir(paper_id) / "assets"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def asset_path(self, paper_id: str, name: str) -> Path:
        if not ASSET_RE.match(name):
            raise NotFound(name)
        path = self.paper_dir(paper_id) / "assets" / name
        if not path.is_file():
            raise NotFound(name)
        return path

    def pdf_path(self, paper_id: str) -> Path:
        return self.paper_dir(paper_id) / "source.pdf"

    def create_paper(self, filename: str, pdf_bytes: bytes) -> PaperRecord:
        paper_id = uuid.uuid4().hex[:12]
        d = self.paper_dir(paper_id)
        d.mkdir(parents=True)
        (d / "source.pdf").write_bytes(pdf_bytes)
        rec = PaperRecord(id=paper_id, filename=filename)
        self.save_paper(rec)
        return rec

    def save_paper(self, rec: PaperRecord) -> None:
        with self._lock:
            _atomic_write(self.paper_dir(rec.id) / "paper.json", rec.model_dump_json(indent=2))

    def get_paper(self, paper_id: str) -> PaperRecord:
        return self.load(paper_id, "paper", PaperRecord)

    def list_papers(self) -> list[PaperRecord]:
        out = []
        for d in self.papers_dir.iterdir():
            if d.is_dir() and PAPER_ID_RE.match(d.name) and (d / "paper.json").exists():
                try:
                    out.append(self.get_paper(d.name))
                except Exception:  # a corrupt record should not break the listing
                    continue
        return sorted(out, key=lambda r: r.created_at, reverse=True)

    def delete_paper(self, paper_id: str) -> None:
        d = self.paper_dir(paper_id)
        if not d.exists():
            raise NotFound(paper_id)
        shutil.rmtree(d)

    # ------------------------------------------------------------------ JSON artifacts

    def save(self, paper_id: str, name: str, obj: BaseModel) -> None:
        _atomic_write(self.paper_dir(paper_id) / f"{name}.json", obj.model_dump_json(indent=2))

    def load(self, paper_id: str, name: str, cls: type[T]) -> T:
        path = self.paper_dir(paper_id) / f"{name}.json"
        if not path.exists():
            raise NotFound(f"{paper_id}/{name}")
        return cls.model_validate_json(path.read_text(encoding="utf-8"))

    def exists(self, paper_id: str, name: str) -> bool:
        return (self.paper_dir(paper_id) / f"{name}.json").exists()

    # ------------------------------------------------------------------ app settings

    def load_settings(self) -> dict:
        path = self.root / "settings.json"
        if not path.exists():
            return {}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}

    def save_settings(self, data: dict) -> None:
        _atomic_write(self.root / "settings.json", json.dumps(data, indent=2))
