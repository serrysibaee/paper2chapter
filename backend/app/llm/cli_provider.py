"""Providers that use a Claude or ChatGPT *subscription* through the vendors' own CLIs.

* `ClaudeCodeProvider` runs Claude Code headless (`claude -p --output-format json`), signed in
  with a Claude Pro/Max plan (or whatever account the CLI is logged in with).
* `CodexProvider` runs `codex exec` headless, signed in with a ChatGPT Plus/Pro plan.

The app never sees or stores a token: the CLI does its own sign-in, and this module only feeds
it a prompt on stdin and reads JSON back. Each call runs in an empty temporary directory with
no tools (Claude) or a read-only sandbox (Codex), no MCP servers and no project settings, so the
model generates text and cannot act on the machine. API keys are removed from the child's
environment so a subscription login is not silently replaced by API billing.
"""

import asyncio
import json
import re
import tempfile
from pathlib import Path

from ..models import Usage
from .base import LLMError, LLMProvider, LLMRequest, RawCompletion
from .cli_runner import CLIResult, child_env, cli_help, resolve_cli, run_cli
from .schema import schema_prompt, strict_schema

# Claude Code tools to deny when the CLI is too old for `--tools ""`.
_CLAUDE_TOOLS = ("Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task",
                 "NotebookEdit", "TodoWrite", "BashOutput", "KillShell", "SlashCommand",
                 "ExitPlanMode", "Skill", "AskUserQuestion")
_PDF_NOTE = ("The original paper is the file ./paper.pdf in the working directory. Read all of its "
             "pages with the Read tool before answering, and take equations, figures and page "
             "numbers from it.\n\n")


class CLIProvider(LLMProvider):
    """Shared plumbing: locate the CLI, cap concurrency, run each call in a temp directory."""

    cli_name = ""
    drop_env: tuple[str, ...] = ()
    install_hint = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        extra = self.preset.extra
        self.argv = resolve_cli(self.cli_name, extra.get("cli_path", ""))
        if not self.argv:
            raise LLMError(f"{self.preset.label}: the `{self.cli_name}` CLI was not found. {self.install_hint}")
        self.timeout = float(extra.get("timeout_s", 900))
        self.limit = int(self.preset.max_concurrency or 2)
        self.sem: asyncio.Semaphore | None = None  # made on first use, inside the job's event loop

    async def _complete(self, req: LLMRequest, prompt: str, max_tokens: int) -> RawCompletion:
        if self.sem is None:
            self.sem = asyncio.Semaphore(self.limit)
        async with self.sem:
            with tempfile.TemporaryDirectory(prefix="p2c-cli-") as tmp:
                return await self._call(req, prompt, Path(tmp))

    async def _call(self, req: LLMRequest, prompt: str, tmp: Path) -> RawCompletion:
        raise NotImplementedError

    async def _run(self, args: list[str], stdin: str, tmp: Path) -> CLIResult:
        try:
            res = await run_cli([*self.argv, *args], stdin=stdin, cwd=tmp, timeout=self.timeout,
                                env=child_env(self.drop_env))
        except OSError as exc:
            raise LLMError(f"{self.preset.label}: could not start `{self.cli_name}`: {exc}") from exc
        if res.timed_out:
            raise LLMError(f"{self.preset.label} did not answer within {int(self.timeout)} s "
                           "(CLI_TIMEOUT_S). Try a faster model or a lower effort.")
        return res


# --------------------------------------------------------------------------- Claude Code


class ClaudeCodeProvider(CLIProvider):
    cli_name = "claude"
    drop_env = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")
    install_hint = ("Install Claude Code (https://claude.com/claude-code), run `claude` once and "
                    "sign in with your Claude account, or set CLAUDE_CLI_PATH.")

    @property
    def accepts_pdf(self) -> bool:
        return bool(self.preset.extra.get("read_pdf"))

    async def _call(self, req: LLMRequest, prompt: str, tmp: Path) -> RawCompletion:
        help_text = await cli_help(self.argv)
        use_schema = self.mode == "json_schema" and "--json-schema" in help_text
        read_pdf = bool(req.pdf_bytes) and self.accepts_pdf

        args = ["-p", "--output-format", "json", "--model", self.model.id,
                "--setting-sources", "", "--strict-mcp-config", "--system-prompt", req.system]
        if read_pdf:
            (tmp / "paper.pdf").write_bytes(req.pdf_bytes)
            args += ["--allowedTools", "Read"]
            args += ["--disallowedTools", *[t for t in _CLAUDE_TOOLS if t != "Read"]]
        elif "--tools" in help_text:
            args += ["--tools", ""]
        else:
            args += ["--disallowedTools", *_CLAUDE_TOOLS]
        if use_schema:
            args += ["--json-schema", json.dumps(strict_schema(req.schema), separators=(",", ":"))]
        else:
            prompt = prompt + "\n\n" + schema_prompt(req.schema)

        stdin = (_PDF_NOTE if read_pdf else "") + (req.context + "\n\n" if req.context else "") + prompt
        res = await self._run(args, stdin, tmp)
        data = _last_json_object(res.stdout)
        if data is None:
            raise LLMError(_claude_error(res.stdout + "\n" + res.stderr) or
                           f"Claude Code returned no JSON result (exit {res.returncode}): "
                           f"{(res.stderr or res.stdout).strip()[:300]}")
        if data.get("is_error") or data.get("subtype", "success") != "success":
            msg = str(data.get("result") or data.get("subtype") or "")
            raise LLMError(_claude_error(msg) or f"Claude Code failed: {msg[:300]}")

        u = data.get("usage") or {}
        usage = Usage(
            calls=1,
            input_tokens=int(u.get("input_tokens") or 0),
            output_tokens=int(u.get("output_tokens") or 0),
            cache_read_tokens=int(u.get("cache_read_input_tokens") or 0),
            cache_write_tokens=int(u.get("cache_creation_input_tokens") or 0),
        )
        structured = data.get("structured_output")
        text = json.dumps(structured) if isinstance(structured, dict) else str(data.get("result") or "")
        return RawCompletion(text=text, usage=usage)


def _claude_error(text: str) -> str | None:
    low = text.lower()
    if any(k in low for k in ("/login", "not logged in", "invalid api key", "oauth token",
                              "authentication_error", "please log in")):
        return ("Claude Code is not signed in. Open a terminal, run `claude`, and sign in with "
                "your Claude account (/login), then retry.")
    if "usage limit" in low or "limit reached" in low or "rate_limit" in low or "rate limit" in low:
        when = ""
        m = re.search(r"\|(\d{10})", text)
        if m:
            when = " It resets at the time Claude shows in the app."
        return "Your Claude plan's usage limit was reached." + when + " Wait for it to reset, or switch model."
    if "credit balance" in low:
        return ("Claude Code is using an API account without credit. Sign in with your Claude "
                "subscription instead (`claude`, then /login).")
    if "model" in low and ("not found" in low or "not available" in low or "invalid" in low):
        return f"Claude Code cannot use this model: {text.strip()[:200]}"
    return None


# --------------------------------------------------------------------------- Codex


class CodexProvider(CLIProvider):
    cli_name = "codex"
    drop_env = ("OPENAI_API_KEY", "CODEX_API_KEY")
    install_hint = ("Install the Codex CLI (`npm install -g @openai/codex`), run `codex login` and "
                    "sign in with your ChatGPT account, or set CODEX_CLI_PATH.")

    async def _call(self, req: LLMRequest, prompt: str, tmp: Path) -> RawCompletion:
        (tmp / "schema.json").write_text(json.dumps(strict_schema(req.schema)), encoding="utf-8")
        out_file = tmp / "last-message.json"
        args = ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config",
                "--ignore-rules", "--sandbox", "read-only", "--color", "never", "--json",
                "-C", str(tmp), "--output-schema", str(tmp / "schema.json"),
                "-o", str(out_file)]
        if self.model.id != "default":
            args += ["-m", self.model.id]
        if self.model.reasoning:
            args += ["-c", f'model_reasoning_effort="{self.effort}"']
        args.append("-")

        stdin = (
            "You are used as a text generator. Do not run commands, read files or edit anything: "
            "answer from the text below only, with the single JSON object the output schema "
            "describes.\n\n# Instructions\n\n" + req.system + "\n\n"
            + (req.context + "\n\n" if req.context else "") + prompt
        )
        res = await self._run(args, stdin, tmp)
        events = [e for e in (_json_line(l) for l in res.stdout.splitlines()) if e]
        failure = next((e for e in reversed(events) if e.get("type") in ("turn.failed", "error")), None)
        text = out_file.read_text(encoding="utf-8", errors="replace") if out_file.is_file() else ""

        if not text.strip():
            detail = ""
            if failure:
                detail = str((failure.get("error") or {}).get("message") or failure.get("message") or "")
            raise LLMError(_codex_error(detail + "\n" + res.stderr) or
                           f"Codex returned no answer (exit {res.returncode}): "
                           f"{(detail or res.stderr).strip()[:300]}")

        usage = Usage(calls=1)
        for e in events:
            if e.get("type") == "turn.completed" and isinstance(e.get("usage"), dict):
                u = e["usage"]
                cached = int(u.get("cached_input_tokens") or 0)
                usage.input_tokens += max(0, int(u.get("input_tokens") or 0) - cached)
                usage.cache_read_tokens += cached
                usage.output_tokens += int(u.get("output_tokens") or 0)
        return RawCompletion(text=text, usage=usage)


def _codex_error(text: str) -> str | None:
    low = text.lower()
    if any(k in low for k in ("sign in again", "log out and sign in", "not logged in", "401",
                              "unauthorized", "login required", "codex login")):
        return ("Codex is not signed in (or its sign-in expired). Open a terminal, run "
                "`codex login`, sign in with your ChatGPT account, then retry.")
    if "usage limit" in low or "rate limit" in low or "429" in low:
        return "Your ChatGPT plan's Codex usage limit was reached. Wait for it to reset, or switch model."
    if "model" in low and ("not supported" in low or "not found" in low or "does not exist" in low):
        return f"Codex cannot use this model with your plan: {text.strip()[:200]}"
    return None


# --------------------------------------------------------------------------- helpers


def _json_line(line: str) -> dict | None:
    line = line.strip()
    if not line.startswith("{"):
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None
    return obj if isinstance(obj, dict) else None


def _last_json_object(stdout: str) -> dict | None:
    """Claude's `--output-format json` prints one object; tolerate banners or log lines around it."""
    text = stdout.strip()
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass
    for line in reversed(text.splitlines()):
        obj = _json_line(line)
        if obj and obj.get("type") == "result":
            return obj
    return None


async def check_cli(preset) -> dict:
    """Readiness for the Settings page: installed? version? signed in (Codex only)?"""
    name = "claude" if preset.id == "claude-cli" else "codex"
    argv = resolve_cli(name, preset.extra.get("cli_path", ""))
    if not argv:
        return {"installed": False, "version": None, "signed_in": None,
                "message": f"`{name}` was not found on PATH."}
    res = await run_cli([*argv, "--version"], timeout=60, env=child_env())
    version = (res.stdout or res.stderr).strip().splitlines()[0] if (res.stdout or res.stderr).strip() else None
    signed_in = None
    message = "Installed."
    if name == "codex":
        st = await run_cli([*argv, "login", "status"], timeout=60, env=child_env(("OPENAI_API_KEY",)))
        out = (st.stdout + st.stderr).strip()
        signed_in = st.returncode == 0 and "logged in" in out.lower() and "not logged in" not in out.lower()
        message = out.splitlines()[0] if out else message
    else:
        message = "Installed. Sign-in is checked on the first request (run `claude` and /login if needed)."
    return {"installed": True, "version": version, "signed_in": signed_in, "message": message}
