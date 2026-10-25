"""Subscription providers (Claude Code, Codex) against a fake CLI: no real CLI is ever run."""

import asyncio
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.config import Settings
from app.llm import LLMError, ProviderSelection, get_provider
from app.llm import cli_provider, cli_runner
from app.llm.base import LLMRequest
from app.llm.registry import get_presets

FAKE = Path(__file__).with_name("fake_cli.py")


class Item(BaseModel):
    name: str
    count: int


@pytest.fixture
def fake(monkeypatch, tmp_path):
    """Point both providers at fake_cli.py and return a reader for what it received."""
    record = tmp_path / "record.json"
    monkeypatch.setenv("FAKE_CLI_RECORD", str(record))
    monkeypatch.setenv("FAKE_CLI_MODE", "ok")
    monkeypatch.delenv("FAKE_CLI_SCHEMA", raising=False)
    monkeypatch.delenv("FAKE_CLI_TOOLS", raising=False)
    monkeypatch.setattr(cli_provider, "resolve_cli",
                        lambda name, override="": [sys.executable, str(FAKE), name])
    cli_runner._help_cache.clear()

    def calls() -> list[dict]:
        rows = json.loads(record.read_text(encoding="utf-8")) if record.exists() else []
        return [r for r in rows if "--help" not in r["args"]]

    return calls


def provider(pid: str, model: str = "", **settings):
    s = Settings(**settings)
    preset = get_presets(s)[pid]
    return get_provider(s, ProviderSelection(pid, model or preset.models[0].id, "high"))


def req(**kw):
    return LLMRequest(task="t", system="SYSTEM TEXT", prompt="make an item", schema=Item,
                      context="PAPER TEXT", **kw)


# --------------------------------------------------------------------------- Claude Code


def test_claude_prompt_mode_reads_result_text(fake):
    p = provider("claude-cli")
    res = asyncio.run(p.generate(req()))
    assert res.value == Item(name="widget", count=3)
    call = fake()[0]
    args = call["args"]
    assert args[:4] == ["-p", "--output-format", "json", "--model"] and "sonnet" in args
    assert args[args.index("--system-prompt") + 1] == "SYSTEM TEXT"
    assert "--strict-mcp-config" in args and "--setting-sources" in args
    assert "Bash" in args and "Read" in args  # old CLI: every tool denied by name
    assert "--effort" not in args and "--no-session-persistence" not in args  # not offered by this CLI
    # paper, prompt and schema travel on stdin, never on the command line
    assert call["stdin"].startswith("PAPER TEXT") and "JSON Schema" in call["stdin"]
    assert not any("PAPER TEXT" in a for a in args)
    assert call["files"] == []  # empty temp working directory
    assert res.usage.input_tokens == 120 and res.usage.cache_read_tokens == 1000
    assert res.usage.cost_usd == 0.0  # included in the plan


def test_claude_uses_json_schema_and_tools_flags_when_available(fake, monkeypatch):
    monkeypatch.setenv("FAKE_CLI_SCHEMA", "1")
    monkeypatch.setenv("FAKE_CLI_TOOLS", "1")
    res = asyncio.run(provider("claude-cli").generate(req()))
    assert res.value.count == 3
    args = fake()[0]["args"]
    schema = json.loads(args[args.index("--json-schema") + 1])
    assert schema["additionalProperties"] is False
    assert args[args.index("--tools") + 1] == ""
    assert args[args.index("--effort") + 1] == "high" and "--no-session-persistence" in args
    assert "--disallowedTools" not in args
    assert "JSON Schema" not in fake()[0]["stdin"]


def test_claude_strips_api_keys_from_child_env(fake, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-leak")
    asyncio.run(provider("claude-cli").generate(req()))
    assert fake()[0]["env_has_anthropic_key"] is False


def test_claude_pdf_is_read_from_temp_dir_when_enabled(fake):
    p = provider("claude-cli", claude_cli_read_pdf=True)
    assert p.accepts_pdf
    asyncio.run(p.generate(req(pdf_bytes=b"%PDF-1.4 fake")))
    call = fake()[0]
    assert call["files"] == ["paper.pdf"]
    assert call["args"][call["args"].index("--allowedTools") + 1] == "Read"
    assert "./paper.pdf" in call["stdin"]


def test_claude_pdf_with_a_new_cli_offers_only_the_read_tool(fake, monkeypatch):
    monkeypatch.setenv("FAKE_CLI_TOOLS", "1")
    asyncio.run(provider("claude-cli", claude_cli_read_pdf=True).generate(req(pdf_bytes=b"%PDF-1.4 fake")))
    args = fake()[0]["args"]
    assert args[args.index("--tools") + 1] == "Read" and "--disallowedTools" not in args


def test_claude_pdf_off_by_default(fake):
    assert not provider("claude-cli").accepts_pdf


@pytest.mark.parametrize("mode,needle", [
    ("auth", "not signed in"),
    ("limit", "usage limit"),
    ("garbage", "no JSON result"),
])
def test_claude_errors_are_user_facing(fake, monkeypatch, mode, needle):
    monkeypatch.setenv("FAKE_CLI_MODE", mode)
    with pytest.raises(LLMError, match=needle):
        asyncio.run(provider("claude-cli").generate(req()))


def test_claude_invalid_output_is_repaired(fake, monkeypatch):
    monkeypatch.setenv("FAKE_CLI_MODE", "invalid")
    res = asyncio.run(provider("claude-cli").generate(req()))
    assert res.value.count == 3 and res.usage.calls == 2
    assert "invalid output" in fake()[1]["stdin"]


def test_timeout_kills_and_reports(fake, monkeypatch):
    monkeypatch.setenv("FAKE_CLI_MODE", "slow")
    p = provider("claude-cli", cli_timeout_s=2)
    with pytest.raises(LLMError, match="did not answer within 2 s"):
        asyncio.run(p.generate(req()))


# --------------------------------------------------------------------------- Codex


def test_codex_output_schema_and_usage(fake, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-not-leak")
    p = provider("codex-cli")
    res = asyncio.run(p.generate(req()))
    assert res.value == Item(name="widget", count=3)
    call = fake()[0]
    args = call["args"]
    assert args[0] == "exec" and args[-1] == "-"
    assert ["--sandbox", "read-only"] == args[args.index("--sandbox"):args.index("--sandbox") + 2]
    assert "--ephemeral" in args and "--ignore-user-config" in args and "--skip-git-repo-check" in args
    assert args[args.index("-m") + 1] == "gpt-6.1-sol"
    assert 'model_reasoning_effort="high"' in args
    assert "SYSTEM TEXT" in call["stdin"] and "PAPER TEXT" in call["stdin"]
    assert call["env_has_openai_key"] is False
    assert res.usage.input_tokens == 500 and res.usage.cache_read_tokens == 1000
    assert res.usage.output_tokens == 60 and res.usage.cost_usd == 0.0


def test_codex_default_model_passes_no_model_flag(fake):
    asyncio.run(provider("codex-cli", model="default").generate(req()))
    assert "-m" not in fake()[0]["args"]


@pytest.mark.parametrize("mode,needle", [("auth", "codex login"), ("limit", "usage limit"),
                                         ("garbage", "no answer")])
def test_codex_errors_are_user_facing(fake, monkeypatch, mode, needle):
    monkeypatch.setenv("FAKE_CLI_MODE", mode)
    with pytest.raises(LLMError, match=needle):
        asyncio.run(provider("codex-cli").generate(req()))


def test_codex_invalid_output_is_repaired(fake, monkeypatch):
    monkeypatch.setenv("FAKE_CLI_MODE", "invalid")
    res = asyncio.run(provider("codex-cli").generate(req()))
    assert res.value.count == 3 and res.usage.calls == 2


# --------------------------------------------------------------------------- shared


def test_missing_cli_is_a_clear_error(monkeypatch):
    monkeypatch.setattr(cli_provider, "resolve_cli", lambda name, override="": None)
    with pytest.raises(LLMError, match="was not found"):
        provider("claude-cli")


def test_concurrency_cap(fake, monkeypatch):
    p = provider("claude-cli", cli_max_concurrency=1)
    assert p.preset.max_concurrency == 1

    async def both():
        return await asyncio.gather(p.generate(req()), p.generate(req()))

    assert len(asyncio.run(both())) == 2


def test_npm_shim_is_resolved_to_node_script(tmp_path):
    script = tmp_path / "node_modules" / "@anthropic-ai" / "claude-code" / "cli.js"
    script.parent.mkdir(parents=True)
    script.write_text("// cli")
    (tmp_path / "node.exe").write_text("")
    shim = tmp_path / "claude.cmd"
    shim.write_text('@ECHO off\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\n'
                    '"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n')
    assert cli_runner._resolve_npm_shim(shim) == [str(tmp_path / "node.exe"), str(script.resolve())]


def test_npm_shim_to_a_native_binary_runs_the_binary(tmp_path):
    """Claude Code 2.1+ ships claude.exe; a local node_modules/.bin shim points at it through `..`."""
    exe = tmp_path / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe"
    exe.parent.mkdir(parents=True)
    exe.write_text("")
    shim = tmp_path / "node_modules" / ".bin" / "claude.cmd"
    shim.parent.mkdir(parents=True)
    shim.write_text('@ECHO off\r\nCALL :find_dp0\r\n"%dp0%\\..\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n')
    assert cli_runner._resolve_npm_shim(shim) == [str(exe.resolve())]


def test_resolve_cli_override_and_missing(tmp_path):
    exe = tmp_path / "claude"
    exe.write_text("")
    assert cli_runner.resolve_cli("claude", str(exe)) == [str(exe)]
    assert cli_runner.resolve_cli("claude", str(tmp_path / "nope")) is None
    assert cli_runner.resolve_cli("definitely-not-a-cli-p2c") is None


def test_settings_api_lists_subscriptions_and_checks_them(fake, monkeypatch):
    from app.main import app

    with TestClient(app) as client:
        data = client.get("/api/settings").json()
        subs = {p["id"]: p for p in data["providers"] if p["kind"] == "cli"}
        assert set(subs) == {"claude-cli", "codex-cli"}
        assert all(m["tier"] == "subscription" for p in subs.values() for m in p["models"])
        assert all(m["typical_chapter_cost_usd"] == 0 for p in subs.values() for m in p["models"])
        assert subs["claude-cli"]["setup_hint"]

        monkeypatch.setattr(cli_provider, "resolve_cli",
                            lambda name, override="": [sys.executable, str(FAKE), name])
        r = client.get("/api/providers/codex-cli/check").json()
        assert r["installed"] and r["signed_in"] is True and r["version"] == "codex-cli 9.9.9"
        monkeypatch.setenv("FAKE_CLI_MODE", "auth")
        assert client.get("/api/providers/codex-cli/check").json()["signed_in"] is False
        assert client.get("/api/providers/claude-cli/check").json()["installed"] is True
        assert client.get("/api/providers/nope/check").status_code == 404
        assert client.get("/api/providers/mock/check").json()["message"] == "Ready."
