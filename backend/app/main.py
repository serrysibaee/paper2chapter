"""HTTP API. Run with: uvicorn app.main:app --reload (from the backend/ directory)."""

import logging
import re
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

from .config import get_settings
from .estimate import estimate_chapter, paper_tokens
from .export import render_chapter_html
from .export_md import render_chapter_markdown
from .jobs import JobManager, UserFacingError
from .llm import LLMError, get_provider, resolve_selection
from .llm.registry import get_presets
from .models import Chapter, Extraction, GenerationOptions, PaperAnalysis, PaperRecord
from .pipeline import run_analyze, run_extract, run_generate
from .storage import NotFound, Store
from .verify.sandbox import get_sandbox

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()
TYPICAL_PAPER_TOKENS = 12_000  # ~15-page paper


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.store = Store(settings.data_dir)
    app.state.jobs = JobManager(app.state.store)
    app.state.jobs.mark_interrupted()
    yield


app = FastAPI(title="paper2chapter", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(NotFound)
async def _not_found(request: Request, exc: NotFound):
    return JSONResponse(status_code=404, content={"detail": "Not found"})


@app.exception_handler(UserFacingError)
async def _user_error(request: Request, exc: UserFacingError):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(LLMError)
async def _llm_error(request: Request, exc: LLMError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


def store(request: Request) -> Store:
    return request.app.state.store


def jobs(request: Request) -> JobManager:
    return request.app.state.jobs


def _provider(request: Request):
    return get_provider(settings, resolve_selection(settings, store(request).load_settings()))


# --------------------------------------------------------------------------- settings


class SettingsUpdate(BaseModel):
    provider: str
    model: str
    effort: Literal["low", "medium", "high"] = "medium"


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/settings")
def get_app_settings(request: Request):
    sel = resolve_selection(settings, store(request).load_settings())
    sandbox = get_sandbox(settings)
    providers = []
    for p in get_presets(settings).values():
        models = []
        for m in p.models:
            est = estimate_chapter(p, m, TYPICAL_PAPER_TOKENS, 150_000)
            models.append({
                "id": m.id, "label": m.label, "tier": m.tier, "context_tokens": m.context_tokens,
                "input_price": m.input_price, "output_price": m.output_price,
                "cache_read_price": m.cache_read_price, "notes": m.notes,
                "typical_chapter_cost_usd": est["cost_with_cache_usd"] if est["cost_with_cache_usd"] is not None else est["cost_usd"],
            })
        providers.append({
            "id": p.id, "label": p.label, "kind": p.kind, "configured": p.is_configured(),
            "api_key_env": p.api_key_env, "key_required": p.key_required, "free_note": p.free_note,
            "pricing_note": p.pricing_note, "docs_url": p.docs_url, "supports_pdf": p.supports_pdf,
            "setup_hint": p.setup_hint, "models": models,
        })
    return {
        "selection": {"provider": sel.provider, "model": sel.model, "effort": sel.effort},
        "providers": providers,
        "sandbox": {"backend": sandbox.name if sandbox else "disabled",
                    "isolated": bool(sandbox and sandbox.is_isolated)},
        "native_pdf": settings.use_native_pdf,
    }


@app.put("/api/settings")
def put_app_settings(update: SettingsUpdate, request: Request):
    presets = get_presets(settings)
    if update.provider not in presets:
        raise HTTPException(400, f"Unknown provider '{update.provider}'")
    if not re.fullmatch(r"[A-Za-z0-9._:/@-]{1,120}", update.model):
        raise HTTPException(400, "Invalid model id")
    store(request).save_settings(update.model_dump())
    return get_app_settings(request)


@app.get("/api/providers/{provider_id}/check")
async def check_provider(provider_id: str):
    """Is a subscription CLI installed (and, for Codex, signed in)? Spends no tokens."""
    preset = get_presets(settings).get(provider_id)
    if preset is None:
        raise HTTPException(404, f"Unknown provider '{provider_id}'")
    if preset.kind != "cli":
        return {"installed": None, "version": None, "signed_in": None,
                "message": "Ready." if preset.is_configured() else f"Set {preset.api_key_env}."}
    from .llm.cli_provider import check_cli

    return await check_cli(preset)


# --------------------------------------------------------------------------- papers


@app.get("/api/papers", response_model=list[PaperRecord])
def list_papers(request: Request):
    return store(request).list_papers()


@app.post("/api/papers", response_model=PaperRecord)
async def upload_paper(request: Request, file: UploadFile = File(...)):
    limit = settings.max_upload_mb * 2**20
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File is larger than {settings.max_upload_mb} MB")
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "The file is not a PDF")
    filename = re.sub(r"[^\w.\- ]", "_", file.filename or "paper.pdf")[:200]
    rec = store(request).create_paper(filename, data)
    s = store(request)
    return jobs(request).start(rec.id, "extract", lambda p: run_extract(s, rec.id, p))


@app.get("/api/papers/{paper_id}", response_model=PaperRecord)
def get_paper(paper_id: str, request: Request):
    return store(request).get_paper(paper_id)


@app.delete("/api/papers/{paper_id}")
def delete_paper(paper_id: str, request: Request):
    if jobs(request).is_running(paper_id):
        raise HTTPException(409, "Wait for the running job to finish before deleting.")
    store(request).delete_paper(paper_id)
    return {"ok": True}


@app.get("/api/papers/{paper_id}/extraction")
def get_extraction(paper_id: str, request: Request, full: bool = False):
    ex = store(request).load(paper_id, "extraction", Extraction)
    data = ex.model_dump(exclude=None if full else {"pages"})
    data["text_tokens"] = paper_tokens(ex.full_text())
    return data


@app.post("/api/papers/{paper_id}/extract", response_model=PaperRecord)
async def re_extract(paper_id: str, request: Request):
    s = store(request)
    s.get_paper(paper_id)
    return jobs(request).start(paper_id, "extract", lambda p: run_extract(s, paper_id, p))


@app.post("/api/papers/{paper_id}/analyze", response_model=PaperRecord)
async def analyze(paper_id: str, request: Request):
    s = store(request)
    if not s.exists(paper_id, "extraction"):
        raise HTTPException(409, "The paper has not been extracted yet.")
    provider = _provider(request)
    return jobs(request).start(paper_id, "analyze", lambda p: run_analyze(s, settings, provider, paper_id, p))


@app.get("/api/papers/{paper_id}/analysis", response_model=PaperAnalysis)
def get_analysis(paper_id: str, request: Request):
    return store(request).load(paper_id, "analysis", PaperAnalysis)


@app.get("/api/papers/{paper_id}/estimate")
def estimate(paper_id: str, request: Request):
    s = store(request)
    ex = s.load(paper_id, "extraction", Extraction)
    provider = _provider(request)
    est = estimate_chapter(provider.preset, provider.model, paper_tokens(ex.full_text()), provider.input_budget_tokens)
    return {"provider": provider.preset.id, "model": provider.model.id, "tier": provider.model.tier, **est}


@app.post("/api/papers/{paper_id}/generate", response_model=PaperRecord)
async def generate(paper_id: str, options: GenerationOptions, request: Request):
    s = store(request)
    if not s.exists(paper_id, "analysis"):
        raise HTTPException(409, "Analyze the paper before generating a chapter.")
    provider = _provider(request)
    return jobs(request).start(
        paper_id, "generate", lambda p: run_generate(s, settings, provider, paper_id, options, p)
    )


@app.get("/api/papers/{paper_id}/chapter", response_model=Chapter)
def get_chapter(paper_id: str, request: Request):
    return store(request).load(paper_id, "chapter", Chapter)


@app.get("/api/papers/{paper_id}/assets/{name}")
def get_asset(paper_id: str, name: str, request: Request):
    return FileResponse(store(request).asset_path(paper_id, name), media_type="image/png")


@app.get("/api/papers/{paper_id}/pdf")
def get_pdf(paper_id: str, request: Request):
    path = store(request).pdf_path(paper_id)
    if not path.exists():
        raise NotFound(paper_id)
    return FileResponse(path, media_type="application/pdf")


@app.get("/api/papers/{paper_id}/export.html")
def export_html(paper_id: str, request: Request, solutions: bool = True, download: bool = True):
    s = store(request)
    chapter = s.load(paper_id, "chapter", Chapter)
    html = render_chapter_html(chapter, s.paper_dir(paper_id) / "assets", include_solutions=solutions)
    slug = re.sub(r"[^a-z0-9]+", "-", chapter.title.lower()).strip("-")[:60] or "chapter"
    headers = {"Content-Disposition": f'attachment; filename="{slug}.html"'} if download else {}
    return HTMLResponse(html, headers=headers)


@app.get("/api/papers/{paper_id}/export.md")
def export_markdown(
    paper_id: str, request: Request, solutions: bool = True,
    flavor: Literal["obsidian", "commonmark"] = "obsidian",
    asset_prefix: str = "", pdf_link: str = "",
):
    """The chapter as one Markdown note (the Obsidian plugin's format) and the assets it embeds.

    `asset_prefix` is prepended to every embedded asset name, so figures from different papers
    do not collide in one vault; `pdf_link` is the PDF's vault path, for page links.
    """
    if not re.fullmatch(r"[\w .\-]{0,80}", asset_prefix):
        raise HTTPException(400, "Invalid asset_prefix")
    if len(pdf_link) > 300 or re.search(r"[\[\]|#^\n\r]", pdf_link):
        raise HTTPException(400, "Invalid pdf_link")
    chapter = store(request).load(paper_id, "chapter", Chapter)
    out = render_chapter_markdown(chapter, flavor=flavor, asset_prefix=asset_prefix,
                                  pdf_link=pdf_link or None, include_solutions=solutions)
    slug = re.sub(r"[^\w\- ]+", "", chapter.title).strip()[:100] or "Chapter"
    return {"markdown": out.markdown, "assets": out.assets, "title": chapter.title, "filename": f"{slug}.md"}
