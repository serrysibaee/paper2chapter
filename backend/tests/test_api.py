"""End-to-end flow with the mock provider: upload -> extract -> analyze -> generate -> export."""

import time

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _wait(client, pid, until: set[str], timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        rec = client.get(f"/api/papers/{pid}").json()
        if rec["status"] in until | {"failed"}:
            return rec
        time.sleep(0.2)
    raise AssertionError(f"timed out waiting for {until}")


@pytest.fixture(scope="module")
def generated(client, sample_pdf):
    with open(sample_pdf, "rb") as f:
        r = client.post("/api/papers", files={"file": ("sample.pdf", f, "application/pdf")})
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    rec = _wait(client, pid, {"extracted"})
    assert rec["status"] == "extracted", rec

    assert client.post(f"/api/papers/{pid}/analyze").status_code == 200
    rec = _wait(client, pid, {"analyzed"})
    assert rec["status"] == "analyzed", rec["job"]

    analysis = client.get(f"/api/papers/{pid}/analysis").json()
    known = [analysis["prerequisites"][0]["id"]]
    r = client.post(f"/api/papers/{pid}/generate", json={"audience": "undergraduate", "known_prerequisites": known})
    assert r.status_code == 200, r.text
    rec = _wait(client, pid, {"ready"})
    assert rec["status"] == "ready", rec["job"]
    return pid, analysis


def test_full_pipeline_produces_verified_chapter(client, generated):
    pid, analysis = generated
    ch = client.get(f"/api/papers/{pid}/chapter").json()

    # prerequisites the reader did not mark as known are taught as primers
    taught = {p["prerequisite_id"] for p in ch["primers"]}
    assert taught == {p["id"] for p in analysis["prerequisites"][1:]}

    assert len(ch["sections"]) == 2
    v = ch["verification"]
    assert v["deriv:s1:0:1"]["status"] == "verified"
    assert v["example:s1:0"]["status"] == "verified"
    assert v["ex:p2"]["status"] == "verified"  # math answer
    assert v["ex:p3"]["status"] == "verified", v["ex:p3"]  # python reference solution passed tests
    assert v["ex:s1-q1"]["status"] == "verified"  # MCQ answer key structure

    # citations: R1 exists in the sample paper; p1 is a valid page
    assert "[@R1]" in ch["sections"][0]["body_md"]
    # figure placeholder F1 exists in the sample paper, so it is kept
    assert "{{fig:F1}}" in ch["sections"][0]["body_md"]
    assert ch["usage"]["calls"] >= 6


def test_export_html(client, generated):
    pid, _ = generated
    r = client.get(f"/api/papers/{pid}/export.html")
    assert r.status_code == 200
    html = r.text
    assert "katex" in html and "Softmax-Weighted Averages" in html
    assert "data:image/png;base64" in html  # figure inlined
    assert 'href="#ref-R1"' in html
    assert "<script>" not in html.split("</head>")[1]  # no raw scripts from content
    no_sol = client.get(f"/api/papers/{pid}/export.html?solutions=false").text
    assert "def softmax(z):\n    m = max(z)" not in no_sol


def test_extraction_and_assets(client, generated):
    pid, _ = generated
    ex = client.get(f"/api/papers/{pid}/extraction").json()
    assert "pages" not in ex and ex["text_tokens"] > 0
    assert client.get(f"/api/papers/{pid}/assets/F1.png").status_code == 200
    assert client.get(f"/api/papers/{pid}/assets/..%2Fpaper.json").status_code == 404
    assert client.get(f"/api/papers/{pid}/estimate").json()["model"] == "mock"


def test_rejects_bad_uploads_and_ids(client):
    r = client.post("/api/papers", files={"file": ("x.pdf", b"hello", "application/pdf")})
    assert r.status_code == 400
    assert client.get("/api/papers/../../etc").status_code == 404
    assert client.get("/api/papers/zzzzzzzzzzzz").status_code == 404


def test_settings_roundtrip(client):
    s = client.get("/api/settings").json()
    assert s["selection"]["provider"] == "mock"
    ids = {p["id"] for p in s["providers"]}
    assert {"anthropic", "openai", "gemini", "groq", "openrouter", "ollama"} <= ids
    anth = next(p for p in s["providers"] if p["id"] == "anthropic")
    assert anth["models"][0]["typical_chapter_cost_usd"] > 0
    assert "api_key" not in str(s).replace("api_key_env", "")  # keys are never returned

    r = client.put("/api/settings", json={"provider": "ollama", "model": "qwen3:8b", "effort": "low"})
    assert r.json()["selection"] == {"provider": "ollama", "model": "qwen3:8b", "effort": "low"}
    assert client.put("/api/settings", json={"provider": "nope", "model": "x"}).status_code == 400
    client.put("/api/settings", json={"provider": "mock", "model": "mock", "effort": "medium"})


def test_analyze_without_key_gives_clear_error(client, generated, monkeypatch):
    pid, _ = generated
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    client.put("/api/settings", json={"provider": "openai", "model": "gpt-6-luna", "effort": "low"})
    try:
        r = client.post(f"/api/papers/{pid}/analyze")
        assert r.status_code == 400 and "OPENAI_API_KEY" in r.json()["detail"]
    finally:
        client.put("/api/settings", json={"provider": "mock", "model": "mock", "effort": "medium"})
