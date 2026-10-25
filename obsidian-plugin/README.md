# Paper2Chapter for Obsidian

Right-click a research-paper PDF in your vault → **Generate a chapter** → a textbook-style note:
intuition first, primers for the prerequisites you lack, step-by-step derivations, worked examples,
exercises with folded solutions, and citations that open the PDF at the right page. Math, numeric
answers, Python solutions and citations are checked automatically by the
[paper2chapter](https://github.com/serrysibaee/paper2chapter) backend, which this plugin drives.

Works with a **Claude Pro/Max or ChatGPT Plus/Pro subscription** (through the Claude Code or Codex CLI,
no API key), an API key, or a local Ollama model.

- **Desktop only.** The plugin starts the Python backend on your machine and stops it again.
- **Setup:** see [docs/OBSIDIAN.md](../docs/OBSIDIAN.md): set up the backend once, set *Backend folder*,
  pick a model.
- **Network use:** the plugin talks only to the backend address you configure (default
  `http://127.0.0.1:8000`). The backend sends the paper's text to the model provider you choose.
- **Files:** it creates notes and images only in the chapters folder you configure, and never
  overwrites a file.

## Develop

```bash
npm install
npm run dev        # watch build to main.js
npm test           # node --test; includes an end-to-end run against ../backend (needs backend/.venv)
npm run lint
npm run build
```

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/paper2chapter/` to try
a build. Releases: bump `version` in `package.json`, `npm version <x.y.z>` updates `manifest.json` and
`versions.json`; pushing the tag `<x.y.z>` builds and attaches the files (`.github/workflows/plugin-release.yml`).

| File | What it does |
|---|---|
| `src/main.ts` | Commands, file menu, ribbon, status bar; runs generations; desktop process helpers |
| `src/api.ts` | Backend client on an injected transport (`requestUrl` in Obsidian, `fetch` in tests) |
| `src/run.ts` | One PDF's way to a note: upload or reuse, extract, analyze, generate, write |
| `src/backend.ts` | Finds Python, starts and stops `uvicorn` |
| `src/writer.ts` | Note and attachments into the vault, unique names, Templater defused |
| `src/modal.ts`, `src/settings.ts` | The generate window and the settings tab |
| `src/multipart.ts`, `src/text.ts` | Multipart upload body; small UI text helpers |

License: AGPL-3.0, like the rest of the repository.
