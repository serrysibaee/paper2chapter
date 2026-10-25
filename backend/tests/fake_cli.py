"""A stand-in for the `claude` and `codex` CLIs, used by tests/test_cli_provider.py.

Run as `python fake_cli.py claude|codex <args...>`. It records what it received to the file
named by FAKE_CLI_RECORD and answers the way the real CLI does, according to FAKE_CLI_MODE:

  ok       a valid answer           auth     the sign-in has expired
  limit    the plan's limit is hit  garbage  output that is not JSON
  slow     sleeps past any timeout  invalid  JSON that fails the schema, then a valid one
"""

import json
import os
import sys
import time
from pathlib import Path

ANSWER = {"name": "widget", "count": 3}


def record(cli: str, args: list[str], stdin: str) -> None:
    path = os.environ.get("FAKE_CLI_RECORD")
    if not path:
        return
    rows = json.loads(Path(path).read_text(encoding="utf-8")) if Path(path).exists() else []
    rows.append({"cli": cli, "args": args, "stdin": stdin, "cwd": os.getcwd(),
                 "files": sorted(p.name for p in Path.cwd().iterdir()),
                 "env_has_anthropic_key": "ANTHROPIC_API_KEY" in os.environ,
                 "env_has_openai_key": "OPENAI_API_KEY" in os.environ})
    Path(path).write_text(json.dumps(rows), encoding="utf-8")


def answer(mode: str) -> dict | str:
    if mode == "invalid":
        counter = Path(os.environ["FAKE_CLI_RECORD"] + ".n")
        n = int(counter.read_text()) if counter.exists() else 0
        counter.write_text(str(n + 1))
        return {"name": "widget"} if n == 0 else ANSWER
    return ANSWER


def claude(args: list[str], stdin: str, mode: str) -> int:
    if "--help" in args:
        print("Usage: claude [options]\n  --output-format <format>\n  --system-prompt <prompt>\n"
              + ("  --json-schema <schema>\n" if os.environ.get("FAKE_CLI_SCHEMA") else "")
              + ("  --tools <tools...>\n  --effort <level>\n  --no-session-persistence\n"
                 if os.environ.get("FAKE_CLI_TOOLS") else ""))
        return 0
    if "--version" in args:
        print("9.9.9 (Claude Code)")
        return 0
    if mode == "slow":
        time.sleep(30)
    if mode == "garbage":
        print("this is not json")
        return 1
    usage = {"input_tokens": 120, "output_tokens": 40, "cache_read_input_tokens": 1000,
             "cache_creation_input_tokens": 50}
    if mode == "auth":
        print(json.dumps({"type": "result", "subtype": "success", "is_error": True,
                          "result": "Invalid API key · Please run /login", "usage": usage}))
        return 1
    if mode == "limit":
        print(json.dumps({"type": "result", "subtype": "success", "is_error": True,
                          "result": "Claude AI usage limit reached|1793000000", "usage": usage}))
        return 1
    data = answer(mode)
    out = {"type": "result", "subtype": "success", "is_error": False, "usage": usage,
           "total_cost_usd": 0.01}
    if "--json-schema" in args:
        out["structured_output"] = data
        out["result"] = ""
    else:
        out["result"] = "```json\n" + json.dumps(data) + "\n```"
    print("[warn] a banner line before the result")
    print(json.dumps(out))
    return 0


def codex(args: list[str], stdin: str, mode: str) -> int:
    if "--version" in args:
        print("codex-cli 9.9.9")
        return 0
    if args[:2] == ["login", "status"]:
        print("Not logged in" if mode == "auth" else "Logged in using ChatGPT")
        return 1 if mode == "auth" else 0
    if mode == "slow":
        time.sleep(30)
    out = Path(args[args.index("-o") + 1])
    schema = json.loads(Path(args[args.index("--output-schema") + 1]).read_text(encoding="utf-8"))
    assert schema["additionalProperties"] is False
    print(json.dumps({"type": "thread.started", "thread_id": "t1"}))
    if mode == "auth":
        print(json.dumps({"type": "error", "message": "workspace routing discovery unauthorized (401)"}))
        print(json.dumps({"type": "turn.failed", "error": {"message": "unauthorized (401)"}}))
        print("ERROR: Your access token could not be refreshed. Please log out and sign in again.",
              file=sys.stderr)
        return 1
    if mode == "limit":
        print(json.dumps({"type": "turn.failed", "error": {"message": "You've hit your usage limit."}}))
        return 1
    if mode == "garbage":
        return 1
    out.write_text(json.dumps(answer(mode)), encoding="utf-8")
    print(json.dumps({"type": "turn.completed",
                      "usage": {"input_tokens": 1500, "cached_input_tokens": 1000, "output_tokens": 60}}))
    return 0


def main() -> int:
    cli, args = sys.argv[1], sys.argv[2:]
    stdin = "" if "--help" in args or "--version" in args or args[:1] == ["login"] else sys.stdin.read()
    record(cli, args, stdin)
    mode = os.environ.get("FAKE_CLI_MODE", "ok")
    return claude(args, stdin, mode) if cli == "claude" else codex(args, stdin, mode)


if __name__ == "__main__":
    sys.exit(main())
