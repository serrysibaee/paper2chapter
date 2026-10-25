/**
 * Runs learner Python code in a Web Worker with Pyodide (CPython compiled to WebAssembly).
 * The code executes entirely in the reader's browser sandbox, so learner code never reaches
 * the server. A timeout terminates the worker (and starts a fresh one on the next run).
 */

export interface RunResult {
  ok: boolean;
  stdout: string;
  error: string | null;
  timedOut: boolean;
}

let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker {
  if (!worker) worker = new Worker("/pyodide-worker.js");
  return worker;
}

export function runPython(code: string, timeoutMs = 30_000): Promise<RunResult> {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      w.removeEventListener("message", onMessage);
      w.terminate();
      worker = null;
      resolve({ ok: false, stdout: "", error: "Timed out (infinite loop?). The Python runtime was restarted.", timedOut: true });
    }, timeoutMs);
    function onMessage(e: MessageEvent) {
      if (e.data?.id !== id) return;
      clearTimeout(timer);
      w.removeEventListener("message", onMessage);
      resolve({ ok: e.data.ok, stdout: e.data.stdout ?? "", error: e.data.error ?? null, timedOut: false });
    }
    w.addEventListener("message", onMessage);
    w.postMessage({ id, code });
  });
}

/** Learner code followed by the exercise tests, mirroring the server-side check. */
export const withTests = (code: string, tests: string) => `${code.trimEnd()}\n\n# ---- tests ----\n${tests}`;
