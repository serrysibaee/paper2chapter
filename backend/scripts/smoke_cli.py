"""Live smoke test: one paper through the whole API with a real provider.

Spends real tokens (or plan usage), so it is never run by pytest. Examples, from backend/:

    .venv/Scripts/python scripts/smoke_cli.py --provider claude-cli --model haiku
    .venv/Scripts/python scripts/smoke_cli.py --provider codex-cli --model gpt-6-luna --pdf paper.pdf

Without --pdf it uses the three-page sample paper from the test suite. Results (chapter JSON,
HTML and Markdown exports, a summary) go to --out (default: a temp folder, printed at the end).
"""

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", required=True)
    ap.add_argument("--model", default="")
    ap.add_argument("--effort", default="low", choices=["low", "medium", "high"])
    ap.add_argument("--pdf", type=Path)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--no-python", action="store_true", help="skip Python exercises")
    args = ap.parse_args()

    out = args.out or Path(tempfile.mkdtemp(prefix="p2c-smoke-"))
    out.mkdir(parents=True, exist_ok=True)
    os.environ["DATA_DIR"] = str(out / "data")
    os.environ.setdefault("SANDBOX_BACKEND", "subprocess")

    from fastapi.testclient import TestClient

    from app.main import app

    if args.pdf:
        pdf = args.pdf.read_bytes()
    else:
        sys.path.insert(0, str(HERE.parent / "tests"))
        from conftest import make_sample_pdf

        pdf = make_sample_pdf(out / "sample.pdf").read_bytes()

    t0 = time.monotonic()
    with TestClient(app) as c:
        model = args.model
        sel = c.put("/api/settings", json={"provider": args.provider, "model": model or "x", "effort": args.effort})
        if not model:
            prov = next(p for p in sel.json()["providers"] if p["id"] == args.provider)
            model = prov["models"][0]["id"]
            c.put("/api/settings", json={"provider": args.provider, "model": model, "effort": args.effort})
        print(f"provider={args.provider} model={model} effort={args.effort}")
        if args.provider.endswith("-cli"):
            print("check:", c.get(f"/api/providers/{args.provider}/check").json())

        rec = c.post("/api/papers", files={"file": ("paper.pdf", pdf, "application/pdf")}).json()
        pid = rec["id"]
        wait(c, pid, "extracted")
        c.post(f"/api/papers/{pid}/analyze")
        wait(c, pid, "analyzed")
        analysis = c.get(f"/api/papers/{pid}/analysis").json()
        print(f"analysis: {analysis['title']!r}, {len(analysis['prerequisites'])} prerequisites")
        known = [p["id"] for p in analysis["prerequisites"][1:]]  # learn only the first
        c.post(f"/api/papers/{pid}/generate", json={"known_prerequisites": known,
                                                    "include_python": not args.no_python})
        final = wait(c, pid, "ready")
        chapter = c.get(f"/api/papers/{pid}/chapter").json()
        (out / "chapter.json").write_text(json.dumps(chapter, indent=1), encoding="utf-8")
        (out / "chapter.html").write_text(c.get(f"/api/papers/{pid}/export.html").text, encoding="utf-8")
        md = c.get(f"/api/papers/{pid}/export.md")
        if md.status_code == 200:
            (out / "chapter.md").write_text(md.json()["markdown"], encoding="utf-8")

    statuses: dict[str, int] = {}
    for v in chapter["verification"].values():
        statuses[v["status"]] = statuses.get(v["status"], 0) + 1
    summary = {
        "provider": args.provider, "model": model, "seconds": round(time.monotonic() - t0),
        "usage": final["usage"], "sections": len(chapter["sections"]), "primers": len(chapter["primers"]),
        "practice": len(chapter["practice"]), "verification": statuses, "warnings": chapter["warnings"],
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps(summary, indent=1))
    print(f"output: {out}")
    return 0


def wait(c, pid: str, want: str, timeout: float = 3600) -> dict:
    t0 = time.monotonic()
    last = ""
    while time.monotonic() - t0 < timeout:
        rec = c.get(f"/api/papers/{pid}").json()
        job = rec.get("job") or {}
        line = f"  [{rec['status']}] {job.get('stage', '')} {job.get('progress', 0):.0%} {job.get('message', '')}"
        if line != last:
            print(line, flush=True)
            last = line
        if rec["status"] == want:
            return rec
        if rec["status"] == "failed" or job.get("status") == "failed":
            raise SystemExit(f"job failed: {job.get('error')}")
        time.sleep(2)
    raise SystemExit(f"timed out waiting for {want}")


if __name__ == "__main__":
    sys.exit(main())
