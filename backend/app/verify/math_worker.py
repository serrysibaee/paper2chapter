"""Child-process entry point for math checks: JSON list of jobs on stdin, results on stdout."""

import json
import sys

from .math_check import check_equivalence


def main() -> None:
    jobs = json.loads(sys.stdin.read())
    out = {}
    for job in jobs:
        try:
            r = check_equivalence(job["lhs"], job["rhs"], job.get("tolerance"))
            out[job["key"]] = {"status": r.status, "detail": r.detail}
        except Exception as exc:
            out[job["key"]] = {"status": "error", "detail": f"{type(exc).__name__}"}
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()
