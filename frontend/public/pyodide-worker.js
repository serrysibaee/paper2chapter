/* Pyodide worker: executes Python sent from the page and reports stdout / errors. */
const PYODIDE_VERSION = "0.29.5";
importScripts(`https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`);

let ready = null;
function init() {
  if (!ready) {
    ready = loadPyodide({ indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/` });
  }
  return ready;
}

self.onmessage = async (event) => {
  const { id, code } = event.data;
  let stdout = "";
  try {
    const py = await init();
    py.setStdout({ batched: (s) => { stdout += s + "\n"; } });
    py.setStderr({ batched: (s) => { stdout += s + "\n"; } });
    await py.loadPackagesFromImports(code); // e.g. numpy, fetched on first use
    // fresh namespace per run so earlier attempts don't leak state
    const ns = py.globals.get("dict")();
    try {
      await py.runPythonAsync(code, { globals: ns });
    } finally {
      ns.destroy();
    }
    self.postMessage({ id, ok: true, stdout });
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    // keep the useful tail of Python tracebacks
    const lines = msg.trim().split("\n");
    self.postMessage({ id, ok: false, stdout, error: lines.slice(-6).join("\n") });
  }
};
