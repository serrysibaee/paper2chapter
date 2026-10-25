# The Obsidian plugin

Turn a research-paper PDF in your vault into a chapter note in the same vault: intuition first, primers
for the background you lack, derivations, worked examples, exercises with folded solutions, and
citations that open the PDF at the right page.

The plugin is a client of the paper2chapter backend. The backend does the PDF extraction, talks to
the model, and checks the math, the numeric answers, the Python solutions and the citations; the
plugin uploads the PDF, asks you what you already know, and writes the result as a note. On desktop
it can start the backend for you.

## Install

Requirements: Obsidian 1.13 or later on desktop (Windows, macOS, Linux), Python 3.11+, and a model
provider (a Claude or ChatGPT subscription, an API key, or a local Ollama model).

1. **Set up the backend** once, as in the [README](../README.md#quick-start):

   ```bash
   cd backend
   python -m venv .venv
   .venv/Scripts/activate          # Windows; macOS/Linux: source .venv/bin/activate
   pip install -r requirements.txt
   ```

   You do not need to start it or install the web frontend: the plugin starts the backend itself.

2. **Install the plugin**, either:
   - with [BRAT](https://github.com/TfTHacker/obsidian42-brat): *Add beta plugin* →
     `serrysibaee/paper2chapter`; or
   - by hand: download `main.js`, `manifest.json` and `styles.css` from the latest release
     (its tag is the plugin version, e.g. `0.1.0`) into `<vault>/.obsidian/plugins/paper2chapter/`; or
   - from source: `cd obsidian-plugin && npm install && npm run build`, then copy the same three
     files.

   Then enable **Paper2Chapter** under *Settings → Community plugins*.

3. **Point it at the backend**: *Settings → Paper2Chapter → Backend folder* = the `backend/` folder
   of your checkout (for example `C:\code\paper2chapter\backend`). Click **Connect**. The plugin
   finds the backend's `.venv` itself; set *Python* only if you use another interpreter.

4. **Choose a model** in the same tab, then **Save model**. (Every setting is also found by Obsidian's
   settings search, e.g. typing *subscription*.) The choice is stored by the backend, so
   the web app and the plugin share it.

## Use a subscription instead of an API key

| You have | Choose | One-time setup |
|---|---|---|
| Claude Pro or Max | *Claude subscription (Claude Code)* | Install [Claude Code](https://claude.com/claude-code), run `claude` in a terminal and sign in (`/login`). |
| ChatGPT Plus or Pro | *ChatGPT subscription (Codex)* | `npm install -g @openai/codex`, then `codex login`. |

**Check the tool** confirms the CLI is found (and, for Codex, signed in). No key is stored anywhere:
the vendor's own CLI holds the sign-in, and the backend only sends it prompts. Details, limits and
terms are in [PROVIDERS.md](PROVIDERS.md#subscriptions-claude-code-and-codex).

## Generate a chapter

1. Right-click a PDF in the file explorer → **Generate a chapter**. (Or, with the PDF open, run
   *Paper2Chapter: Generate a chapter from this PDF* from the command palette; or *…from a PDF…* to
   pick one; or the ribbon icon.)
2. The PDF is uploaded, its text, figures, tables and references are extracted, and the model
   analyses it. This takes about a minute.
3. **Tick what you already know.** Every prerequisite you leave unticked gets a short primer at the
   start of the chapter (up to six). Pick the audience, whether to include Python exercises, and an
   optional focus. The window shows the cost, or *included in your plan* for a subscription.
4. **Generate chapter.** A chapter takes a few minutes. You can close the window: generation runs in
   the plugin, the status bar shows its progress, and the note is written and opened when it is
   ready.

Running it again on the same, unchanged PDF reuses the extraction and analysis, so only the chapter
is generated again. Each run makes a new note; nothing is overwritten.

*Import a chapter generated earlier* writes any chapter the backend already has (for example one made
in the web app) into the vault.

## The note

One note in the chapters folder (default `Paper chapters/`), named after the paper, with its figures
in `attachments/` beside it, each prefixed with the note's name so two chapters never collide.

```markdown
---
title: "Softmax-Weighted Averages"
paper: "Softmax Weighting for Robust Averaging"
authors:
  - "Jane Doe"
source_pdf: "[[Papers/Softmax weighting.pdf]]"
generated: "2026-10-25T11:22:10+00:00"
generator: "paper2chapter"
model: "claude-cli/sonnet"
audience: "undergraduate"
paper_id: "d73ff6b39832"
tags:
  - paper2chapter
---

# Softmax-Weighted Averages

> [!info] About this chapter
> ... Marks: ✅ checked automatically · ❌ check failed · ➖ not checkable.

> [!abstract] Learning objectives
## Intuition first
## Prerequisites          (one primer per concept you did not tick, each with a check question)
## Notation
## 1. <section>           (intuition callout, body, derivations step by step, worked examples)
## Summary / Key takeaways / Common misconceptions
## Practice problems      (> [!question] callouts, solutions folded in > [!success]-)
## Further reading
## References (from the paper)   (each with a ^ref-R12 block id)
```

- Math is `$…$` and `$$…$$`, rendered by Obsidian's MathJax.
- `(p. 4)` links to `[[the PDF#page=4]]`, which opens the PDF at that page; `(1)` links to the
  reference list.
- ✅/❌ marks are the backend's automatic checks: SymPy for derivation steps and numeric answers,
  a sandbox run of each Python solution against its tests. A step without a mark was not checkable.
  Read critically: the prose is machine-written.

### Safety

A PDF's text can steer a model. Before a note reaches your vault, the backend makes model output
inert: HTML tags are escaped, Templater tags (`<% … %>`) and Dataview inline queries
(`` `= …` ``, `` `$= …` ``) are broken with an invisible character, and a code block in any language
outside a fixed list (python, latex, json, bash, …) becomes plain text, so a ```` ```dataviewjs ````
block cannot run. The plugin defuses Templater tags once more as it writes, because Templater can run
on every new file.

## Settings

| Setting | Default | |
|---|---|---|
| Backend address | `http://127.0.0.1:8000` | A remote backend works too, but only a local one can be started by the plugin. |
| Start the backend automatically | on | Started with `python -m uvicorn app.main:app` in the backend folder. Stopped when the plugin unloads, and only if the plugin started it; it also exits by itself once the Obsidian process that started it is gone (`P2C_PARENT_PID`), so a crash or a window reload leaves nothing running after Obsidian quits. |
| Backend folder | | The `backend/` folder of your checkout. |
| Python interpreter | automatic | `backend/.venv`, else `python` / `python3` on PATH. |
| Provider, model, effort | from the backend | Saved to the backend with **Save model**. |
| Folder / Figures subfolder | `Paper chapters` / `attachments` | |
| Default audience, Python exercises, Include solutions, Open the note | | |

## Troubleshooting

| Message | What to do |
|---|---|
| *Set "Backend folder" …* | Point it at `…/paper2chapter/backend` (the folder with `app/main.py`). |
| *The backend exited while starting* + `No module named …` | The venv lacks the requirements: `pip install -r requirements.txt` in it, or set *Python*. The full output is under *Backend log* in the settings. |
| *Claude Code is not signed in* | Run `claude` in a terminal and `/login` with your Claude account. |
| *Codex is not signed in (or its sign-in expired)* | `codex logout`, then `codex login`. |
| *… usage limit was reached* | Your plan's limit; wait for it to reset, or pick a lighter model (Haiku, GPT-6 Luna). |
| *… did not answer within 900 s* | Raise `CLI_TIMEOUT_S` in the backend's `.env`, or use a faster model or lower effort. |
| Port 8000 is taken | Change *Backend address* to another port, e.g. `http://127.0.0.1:8765`; the plugin starts the backend there. |

The plugin is desktop-only: starting the backend and the subscription CLIs need a desktop.
