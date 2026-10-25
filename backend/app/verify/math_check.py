"""Check claimed identities `lhs == rhs` written in SymPy syntax.

The LLM attaches optional machine checks to derivation steps, worked examples and math
exercises. Each check is verified numerically: both sides are evaluated at random points
(or directly, if there are no free symbols). Random-point testing is fast, cannot hang on
`simplify`, and catches the algebra slips we care about; it is evidence, not proof, and the UI
labels it that way.

Security: `sympy.parse_expr` uses `eval`. LLM output may be influenced by text inside the
uploaded PDF, so expressions are restricted to a strict character/identifier whitelist and
evaluated with an empty `__builtins__`. Checks run in a separate worker process
(`math_worker.py`) with a hard timeout.
"""

import json
import random
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import sympy
from sympy.parsing.sympy_parser import (
    auto_number,
    auto_symbol,
    convert_xor,
    factorial_notation,
    parse_expr,
    repeated_decimals,
)

MAX_LEN = 600
_ALLOWED_CHARS = re.compile(r"^[A-Za-z0-9_+\-*/^().,\s]*$")
_ATTR_ACCESS = re.compile(r"[A-Za-z_)\]]\s*\.\s*[A-Za-z_]")
_CALL = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*\(")
_KEYWORDS = re.compile(r"\b(lambda|import|exec|eval|class|def|for|while|yield|await|async)\b")

FUNCTIONS = {
    "exp": sympy.exp, "log": sympy.log, "ln": sympy.log, "sqrt": sympy.sqrt,
    "sin": sympy.sin, "cos": sympy.cos, "tan": sympy.tan, "asin": sympy.asin,
    "acos": sympy.acos, "atan": sympy.atan, "atan2": sympy.atan2, "sinh": sympy.sinh,
    "cosh": sympy.cosh, "tanh": sympy.tanh, "Abs": sympy.Abs, "abs": sympy.Abs,
    "factorial": sympy.factorial, "binomial": sympy.binomial, "gamma": sympy.gamma,
    "erf": sympy.erf, "Min": sympy.Min, "Max": sympy.Max, "min": sympy.Min, "max": sympy.Max,
    "floor": sympy.floor, "ceiling": sympy.ceiling, "Sum": sympy.Sum, "Product": sympy.Product,
    "Rational": sympy.Rational, "Integral": sympy.Integral, "diff": sympy.diff,
    "Derivative": sympy.Derivative, "limit": sympy.limit, "sign": sympy.sign,
}
CONSTANTS = {"pi": sympy.pi, "E": sympy.E, "oo": sympy.oo, "I": sympy.I}
_TRANSFORMS = (auto_symbol, repeated_decimals, auto_number, factorial_notation, convert_xor)
_GLOBALS = {
    "__builtins__": {},
    "Symbol": sympy.Symbol, "Integer": sympy.Integer, "Float": sympy.Float,
    "Rational": sympy.Rational, "Function": sympy.Function,
}


class UnsafeExpression(ValueError):
    pass


@dataclass
class CheckOutcome:
    status: str  # verified | failed | error
    detail: str


def safe_parse(expr: str) -> sympy.Expr:
    if len(expr) > MAX_LEN:
        raise UnsafeExpression("expression too long")
    if not _ALLOWED_CHARS.match(expr) or "__" in expr or _ATTR_ACCESS.search(expr):
        raise UnsafeExpression("expression contains disallowed characters")
    if _KEYWORDS.search(expr):
        raise UnsafeExpression("expression contains a Python keyword")
    for name in _CALL.findall(expr):
        if name not in FUNCTIONS:
            raise UnsafeExpression(f"function '{name}' is not allowed")
    local = {**FUNCTIONS, **CONSTANTS}
    return parse_expr(expr, local_dict=local, global_dict=dict(_GLOBALS), transformations=_TRANSFORMS)


def _numeric(value) -> complex | None:
    try:
        v = complex(sympy.N(value, 30))
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    if v != v or abs(v) == float("inf"):  # NaN / inf
        return None
    return v


def _has_float(expr: sympy.Expr) -> bool:
    return any(isinstance(a, sympy.Float) for a in sympy.preorder_traversal(expr))


def check_equivalence(lhs: str, rhs: str, tolerance: float | None = None, trials: int = 12) -> CheckOutcome:
    try:
        left, right = safe_parse(lhs), safe_parse(rhs)
    except UnsafeExpression as exc:
        return CheckOutcome("error", f"rejected: {exc}")
    except Exception as exc:  # SymPy syntax errors come in several types
        return CheckOutcome("error", f"could not parse: {type(exc).__name__}")

    # Rounded decimals in the claim (e.g. 0.8808) need a looser tolerance.
    rel_tol = tolerance if tolerance is not None else (2e-3 if _has_float(left) or _has_float(right) else 1e-9)
    symbols = sorted(left.free_symbols | right.free_symbols, key=lambda s: s.name)

    if not symbols:
        a, b = _numeric(left), _numeric(right)
        if a is None or b is None:
            return CheckOutcome("error", "could not evaluate numerically")
        if _close(a, b, rel_tol, absolute=tolerance is not None):
            return CheckOutcome("verified", f"evaluates to {_fmt(a)} on both sides")
        return CheckOutcome("failed", f"left side = {_fmt(a)}, right side = {_fmt(b)}")

    rng = random.Random(1234)
    valid = 0
    for _ in range(trials * 3):
        point = {s: sympy.Float(rng.uniform(0.3, 2.5), 20) for s in symbols}
        a, b = _numeric(left.subs(point)), _numeric(right.subs(point))
        if a is None or b is None:
            continue
        if not _close(a, b, rel_tol):
            where = ", ".join(f"{s}={float(v):.3g}" for s, v in point.items())
            return CheckOutcome("failed", f"sides differ at {where}: {_fmt(a)} vs {_fmt(b)}")
        valid += 1
        if valid >= trials:
            break
    if valid < 4:
        return CheckOutcome("error", "too few valid evaluation points")
    return CheckOutcome("verified", f"sides agree at {valid} random points")


def _close(a: complex, b: complex, tol: float, absolute: bool = False) -> bool:
    if absolute:
        return abs(a - b) <= tol
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def _fmt(v: complex) -> str:
    return f"{v.real:.6g}" if abs(v.imag) < 1e-12 else f"{v:.4g}"


# ---------------------------------------------------------------------- worker process


@dataclass
class CheckJob:
    key: str
    lhs: str
    rhs: str
    tolerance: float | None = None


def run_checks(jobs: list[CheckJob], timeout_s: float = 60.0) -> dict[str, CheckOutcome]:
    """Evaluate checks in a child process so a pathological expression cannot hang the API."""
    if not jobs:
        return {}
    payload = json.dumps([j.__dict__ for j in jobs])
    backend_dir = Path(__file__).resolve().parents[2]
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "app.verify.math_worker"],
            input=payload,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout_s,
            cwd=backend_dir,
        )
    except subprocess.TimeoutExpired:
        return {j.key: CheckOutcome("error", "math check timed out") for j in jobs}
    if proc.returncode != 0:
        return {j.key: CheckOutcome("error", "math worker crashed") for j in jobs}
    results = json.loads(proc.stdout)
    return {k: CheckOutcome(**v) for k, v in results.items()}
