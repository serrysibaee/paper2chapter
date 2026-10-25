import pytest

from app.verify import citations
from app.verify.math_check import CheckJob, check_equivalence, run_checks
from app.verify.sandbox import SubprocessSandbox, child_env, static_screen


@pytest.mark.parametrize(
    "lhs,rhs",
    [
        ("(x+1)^2", "x**2 + 2*x + 1"),
        ("exp(z1)/(exp(z1)+exp(z2))", "1/(1+exp(z2-z1))"),
        ("Sum(k, (k, 1, n))", "n*(n+1)/2"),
        ("diff(x**3, x)", "3*x**2"),
        ("exp(2)/(exp(2)+1)", "0.8808"),  # rounded decimal answer
        ("sqrt(d_k)**2", "d_k"),
    ],
)
def test_true_identities_verify(lhs, rhs):
    assert check_equivalence(lhs, rhs).status == "verified"


@pytest.mark.parametrize("lhs,rhs", [("(x+1)**2", "x**2 + 1"), ("2+2", "5"), ("exp(2)/(exp(2)+1)", "0.85")])
def test_false_identities_fail(lhs, rhs):
    assert check_equivalence(lhs, rhs).status == "failed"


@pytest.mark.parametrize(
    "expr",
    ["open(1)", "__import__('os')", "x.__class__", "preview(x)", "(lambda: 1)()", "a[0]", "'s'", "eval(1)"],
)
def test_unsafe_expressions_rejected(expr):
    out = check_equivalence(expr, "1")
    assert out.status == "error"


def test_absolute_tolerance():
    assert check_equivalence("1/3", "0.33", tolerance=0.01).status == "verified"
    assert check_equivalence("1/3", "0.30", tolerance=0.01).status == "failed"


def test_worker_process_runs_batch():
    res = run_checks([CheckJob("a", "x*(x+1)", "x^2+x"), CheckJob("b", "2+2", "5")])
    assert res["a"].status == "verified" and res["b"].status == "failed"


# ---------------------------------------------------------------- sandbox


def test_sandbox_pass_and_fail():
    sb = SubprocessSandbox()
    ok = sb.run_tests("def f(x):\n    return 2*x\n", "assert f(2) == 4\n", 10)
    assert ok.ok, ok.stderr
    bad = sb.run_tests("def f(x):\n    return x\n", "assert f(2) == 4, 'f(2) should be 4'\n", 10)
    assert not bad.ok and "should be 4" in bad.summary()


def test_sandbox_timeout():
    r = SubprocessSandbox().run("while True:\n    pass\n", 1.5)
    assert r.timed_out and not r.ok


def test_sandbox_numpy_allowed():
    r = SubprocessSandbox().run("import numpy as np\nassert np.allclose(np.ones(3).sum(), 3)\n", 20)
    assert r.ok, r.stderr


@pytest.mark.parametrize(
    "code",
    [
        "import os\nos.system('echo hi')",
        "import subprocess",
        "from socket import socket",
        "open('x.txt', 'w').write('x')",
        "().__class__.__base__.__subclasses__()",
        "__builtins__",
        "eval('1')",
    ],
)
def test_static_screen_blocks(code):
    assert static_screen(code)
    assert not SubprocessSandbox().run(code, 5).ok


def test_sandbox_env_is_scrubbed(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "secret-should-not-leak")
    env = child_env()
    assert "ANTHROPIC_API_KEY" not in env
    assert set(env) <= {"PYTHONIOENCODING", "PYTHONHASHSEED", "PATH", "SYSTEMROOT"}


# ---------------------------------------------------------------- citations


def test_citations_resolve_and_flag():
    data = {
        "body_md": "Claim [@R1]. Page [@p2]. Bad [@R9; @p99]. {{fig:F1}}\n{{fig:F7}}\n{{table:T1}}",
        "title": "[@R9] not markdown field",
    }
    fixed, stats, warnings = citations.check_and_fix(
        data, ref_ids={"R1"}, page_count=3, figure_ids={"F1"}, table_ids=set()
    )
    assert "[@R1]" in fixed["body_md"] and "[@p2]" in fixed["body_md"]
    assert "[@?R9; @?p99]" in fixed["body_md"]
    assert "{{fig:F1}}" in fixed["body_md"] and "F7" not in fixed["body_md"] and "T1" not in fixed["body_md"]
    assert fixed["title"] == data["title"]
    assert stats == {"citations": 4, "unresolved": 2, "placeholders_removed": 2}
    assert warnings and "R9" in warnings[0]
