"""Execution of LLM-generated Python (reference solutions + tests) on the server.

Threat model: the code comes from an LLM whose input includes the uploaded PDF, so a crafted
paper could try to inject malicious code. Learner code never runs here; it runs in the
browser via Pyodide (WebAssembly).

Backends:
  * DockerSandbox (recommended, required for shared deployments): no network, read-only root
    filesystem, dropped capabilities, non-root user, memory/CPU/PID limits.
  * SubprocessSandbox (local single-user fallback): separate interpreter in isolated mode with a
    timeout, empty temp working dir, scrubbed environment, POSIX resource limits, and an AST
    screen that rejects imports outside an allowlist and introspection tricks. This raises the
    bar but is NOT a security boundary; the UI and docs say so.
"""

import ast
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass

from ..config import Settings

log = logging.getLogger(__name__)

OUTPUT_LIMIT = 20_000

ALLOWED_MODULES = {
    "math", "cmath", "random", "statistics", "itertools", "functools", "collections",
    "fractions", "decimal", "heapq", "bisect", "string", "re", "typing", "dataclasses",
    "operator", "numpy", "copy", "enum", "abc",
}
BLOCKED_CALLS = {
    "open", "exec", "eval", "compile", "__import__", "input", "breakpoint", "globals",
    "locals", "vars", "getattr", "setattr", "delattr", "memoryview", "help", "exit", "quit",
}


@dataclass
class SandboxResult:
    ok: bool
    stdout: str
    stderr: str
    timed_out: bool
    backend: str

    def summary(self) -> str:
        if self.timed_out:
            return "timed out"
        if self.ok:
            return "all tests passed"
        lines = [ln for ln in self.stderr.strip().splitlines() if ln.strip()]
        return (lines[-1] if lines else "failed")[:300]


def static_screen(code: str) -> list[str]:
    """Reject code that obviously reaches outside a pure computation."""
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return [f"syntax error: {exc.msg} (line {exc.lineno})"]
    problems = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] not in ALLOWED_MODULES:
                    problems.append(f"import of '{alias.name}' is not allowed")
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] not in ALLOWED_MODULES or node.level:
                problems.append(f"import from '{node.module}' is not allowed")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in BLOCKED_CALLS:
                problems.append(f"call to '{node.func.id}' is not allowed")
        elif isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            problems.append(f"access to '{node.attr}' is not allowed")
        elif isinstance(node, ast.Name) and node.id.startswith("__") and node.id != "__name__":
            problems.append(f"use of '{node.id}' is not allowed")
    return problems


class Sandbox(ABC):
    name = "sandbox"
    is_isolated = False

    @abstractmethod
    def run(self, code: str, timeout_s: float) -> SandboxResult: ...

    def run_tests(self, solution: str, tests: str, timeout_s: float) -> SandboxResult:
        return self.run(solution.rstrip() + "\n\n# ---- tests ----\n" + tests, timeout_s)


def _truncate(s: str) -> str:
    return s if len(s) <= OUTPUT_LIMIT else s[:OUTPUT_LIMIT] + "\n...[truncated]"


class SubprocessSandbox(Sandbox):
    name = "subprocess"
    is_isolated = False

    def run(self, code: str, timeout_s: float) -> SandboxResult:
        problems = static_screen(code)
        if problems:
            return SandboxResult(False, "", "Rejected by static screen: " + "; ".join(problems), False, self.name)
        with tempfile.TemporaryDirectory(prefix="p2c-sbx-") as tmp:
            path = os.path.join(tmp, "main.py")
            with open(path, "w", encoding="utf-8") as f:
                f.write(code)
            env = child_env()
            kwargs: dict = {}
            if os.name == "nt":
                kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
            else:
                kwargs["preexec_fn"] = _posix_limits(timeout_s)
                kwargs["start_new_session"] = True
            try:
                proc = subprocess.run(
                    [sys.executable, "-I", path],
                    cwd=tmp, env=env, capture_output=True, text=True, encoding="utf-8",
                    errors="replace", timeout=timeout_s, stdin=subprocess.DEVNULL, **kwargs,
                )
            except subprocess.TimeoutExpired as exc:
                return SandboxResult(False, _truncate(_s(exc.stdout)), _truncate(_s(exc.stderr)), True, self.name)
            return SandboxResult(proc.returncode == 0, _truncate(proc.stdout), _truncate(proc.stderr), False, self.name)


def child_env() -> dict[str, str]:
    """Minimal environment for sandboxed code: no API keys or other secrets are inherited."""
    env = {"PYTHONIOENCODING": "utf-8", "PYTHONHASHSEED": "0", "PATH": os.environ.get("PATH", "")}
    if os.name == "nt":
        env["SYSTEMROOT"] = os.environ.get("SYSTEMROOT", r"C:\Windows")
    return env


def _s(v) -> str:
    if v is None:
        return ""
    return v.decode("utf-8", "replace") if isinstance(v, bytes) else v


def _posix_limits(timeout_s: float):
    def apply() -> None:  # runs in the child before exec
        import resource

        cpu = int(timeout_s) + 1
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
        resource.setrlimit(resource.RLIMIT_AS, (1024 * 2**20, 1024 * 2**20))
        resource.setrlimit(resource.RLIMIT_FSIZE, (2**20, 2**20))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))

    return apply


class DockerSandbox(Sandbox):
    name = "docker"
    is_isolated = True

    def __init__(self, image: str):
        self.image = image

    @staticmethod
    def available(image: str) -> bool:
        if not shutil.which("docker"):
            return False
        try:
            r = subprocess.run(["docker", "image", "inspect", image], capture_output=True, timeout=10)
            return r.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False

    def run(self, code: str, timeout_s: float) -> SandboxResult:
        name = f"p2c-{uuid.uuid4().hex[:10]}"
        cmd = [
            "docker", "run", "--rm", "-i", "--name", name,
            "--network", "none", "--read-only", "--tmpfs", "/tmp:size=16m",
            "--memory", "256m", "--memory-swap", "256m", "--cpus", "1", "--pids-limit", "64",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--user", "65534:65534", self.image, "python", "-I", "-",
        ]
        try:
            proc = subprocess.run(
                cmd, input=code, capture_output=True, text=True, encoding="utf-8",
                errors="replace", timeout=timeout_s + 10,  # container start-up overhead
            )
        except subprocess.TimeoutExpired as exc:
            subprocess.run(["docker", "kill", name], capture_output=True)
            return SandboxResult(False, _truncate(_s(exc.stdout)), _truncate(_s(exc.stderr)), True, self.name)
        return SandboxResult(proc.returncode == 0, _truncate(proc.stdout), _truncate(proc.stderr), False, self.name)


def get_sandbox(settings: Settings) -> Sandbox | None:
    choice = settings.sandbox_backend
    if choice == "disabled":
        return None
    if choice in ("auto", "docker") and DockerSandbox.available(settings.sandbox_docker_image):
        return DockerSandbox(settings.sandbox_docker_image)
    if choice == "docker":
        log.warning("Docker sandbox requested but image %s is unavailable", settings.sandbox_docker_image)
        return None
    return SubprocessSandbox()
