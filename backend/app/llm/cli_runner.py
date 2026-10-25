"""Find and run a vendor CLI (Claude Code, Codex) as a child process.

Prompts are large (a paper is ~40K characters), so they always go through stdin, never the
command line. On Windows, npm installs a CLI as a `.cmd` shim; running a shim goes through
cmd.exe, which caps the command line at 8,191 characters and re-parses quotes and newlines. The
shim is therefore resolved to `node <script.js>` and run directly.
"""

import asyncio
import os
import re
import shutil
import signal
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

# The target an npm .cmd shim runs: a JS entry point (run with node) or, for CLIs that ship a native
# binary such as Claude Code 2.1+, an .exe. Global shims say `%dp0%\node_modules\...`, local
# node_modules/.bin shims `%dp0%\..\...`.
_SHIM_TARGET_RE = re.compile(r'"%dp0%\\([^"%]+?\.(?:c?js|mjs|exe))"', re.I)
_help_cache: dict[tuple[str, ...], str] = {}


@dataclass
class CLIResult:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False


def resolve_cli(name: str, override: str = "") -> list[str] | None:
    """Return the argv prefix that runs CLI `name`, or None when it is not installed.

    `override` is a path from the environment (e.g. CLAUDE_CLI_PATH) and wins over PATH.
    """
    path = override.strip().strip('"') if override else ""
    found = path if path and Path(path).exists() else (None if path else shutil.which(name))
    if not found:
        return None
    if sys.platform == "win32" and found.lower().endswith((".cmd", ".bat")):
        return _resolve_npm_shim(Path(found)) or [found]
    if found.lower().endswith((".js", ".cjs", ".mjs")):
        node = shutil.which("node")
        return [node, found] if node else None
    return [found]


def _resolve_npm_shim(shim: Path) -> list[str] | None:
    try:
        text = shim.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    # the shim's own node.exe test also matches the pattern; the target is the last quoted path
    targets = [t for t in _SHIM_TARGET_RE.findall(text) if t.lower() != "node.exe"]
    if not targets:
        return None
    script = shim.parent.joinpath(*targets[-1].split("\\")).resolve()  # the shim writes Windows separators
    if not script.is_file():
        return None
    if script.suffix.lower() == ".exe":
        return [str(script)]
    local_node = shim.parent / "node.exe"
    node = str(local_node) if local_node.is_file() else shutil.which("node")
    return [node, str(script)] if node else None


def child_env(drop: tuple[str, ...] = ()) -> dict[str, str]:
    """The current environment minus `drop`.

    API keys are removed so a CLI signed in with a subscription does not silently switch to
    billing an API key that the backend happens to have in its environment.
    """
    env = {k: v for k, v in os.environ.items() if k not in drop}
    env.setdefault("PYTHONUTF8", "1")
    env["NO_COLOR"] = "1"
    return env


async def run_cli(
    argv: list[str],
    stdin: str = "",
    cwd: str | Path | None = None,
    timeout: float = 900.0,
    env: dict[str, str] | None = None,
) -> CLIResult:
    """Run `argv`, feed `stdin`, wait up to `timeout` seconds; kill the whole tree on timeout.

    The process runs in a worker thread (like the verification sandbox) rather than through
    asyncio's subprocess API, which needs the Proactor event loop on Windows; uvicorn does not
    always run with it.
    """
    return await asyncio.to_thread(_run_sync, argv, stdin, cwd, timeout, env)


def _run_sync(argv: list[str], stdin: str, cwd, timeout: float, env) -> CLIResult:
    kwargs: dict = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "CREATE_NO_WINDOW", 0)
    else:
        kwargs["start_new_session"] = True
    proc = subprocess.Popen(
        argv,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(cwd) if cwd else None,
        env=env,
        **kwargs,
    )
    try:
        out, err = proc.communicate(stdin.encode("utf-8"), timeout=timeout)
    except subprocess.TimeoutExpired:
        _kill_tree(proc.pid)
        try:
            out, err = proc.communicate(timeout=10)
        except (subprocess.TimeoutExpired, ValueError):
            out, err = b"", b""
        return CLIResult(proc.returncode if proc.returncode is not None else -1,
                         _decode(out), _decode(err), timed_out=True)
    return CLIResult(proc.returncode or 0, _decode(out), _decode(err))


def _decode(data: bytes | None) -> str:
    return (data or b"").decode("utf-8", errors="replace")


def _kill_tree(pid: int) -> None:
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)],
                           capture_output=True, timeout=15, check=False)
        else:
            os.killpg(pid, signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        pass


async def cli_help(argv: list[str], sub: tuple[str, ...] = ()) -> str:
    """`<cli> [sub] --help`, cached per binary, for feature detection ('' if it fails)."""
    key = tuple(argv) + sub
    if key not in _help_cache:
        try:
            res = await run_cli([*argv, *sub, "--help"], timeout=60, env=child_env())
            _help_cache[key] = res.stdout + res.stderr
        except OSError:
            _help_cache[key] = ""
    return _help_cache[key]
