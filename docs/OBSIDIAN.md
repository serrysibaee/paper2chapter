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
   With *Match concept notes* on (below), each prerequisite shows the concept note it matches, which
   you can change, and comes ticked when a rule, the Knowledge OS or Dataview says you know it, with
   the reason beside it; and *What does it teach?* lists the concept notes the chapter teaches.
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
on every new file. The one exception is your own template note with the Templater integration on: its
own tags are left for Templater to run, while every piece of the chapter and every token from the paper
is still defused.

## Settings

| Setting | Default | |
|---|---|---|
| Backend address | `http://127.0.0.1:8000` | A remote backend works too, but only a local one can be started by the plugin. |
| Start the backend automatically | on | Started with `python -m uvicorn app.main:app` in the backend folder. Stopped when the plugin unloads, and only if the plugin started it; it also exits by itself once the Obsidian process that started it is gone (`P2C_PARENT_PID`), so a crash or a window reload leaves nothing running after Obsidian quits. |
| Backend folder | | The `backend/` folder of your checkout. |
| Python interpreter | automatic | `backend/.venv`, else `python` / `python3` on PATH. |
| Provider, model, effort | from the backend | Saved to the backend with **Save model**. |

Everything below is optional. **The defaults write the same note, in the same place, as plugin 0.1.1**, and
settings saved by 0.1.1 are carried over as they were.

### Sources

| Setting | Default | |
|---|---|---|
| PDFs in the vault | on | Offered in the paper picker (*Generate a chapter from a PDF…*). Right-clicking a PDF always works. |
| Folders outside the vault | none | Folders on this computer, one per line, whose PDFs the picker offers. The PDF is read and uploaded to the backend; it is never copied into the vault. Page citations link to the file (`file:///…#page=4`). |
| Zotero | off | Adds *Search Zotero…* to the picker: type a title, an author or a year. Needs Zotero 7 or later running with its local API on (*Zotero → Settings → Advanced → Allow other applications on this computer to communicate with Zotero*). **Check Zotero** says whether it answers. Read-only: nothing in Zotero changes. Page citations open the PDF in Zotero's reader (`zotero://open-pdf/…?page=4`). |
| Zotero address | `http://127.0.0.1:23119` | |
| Find the paper's own note | off | If your vault keeps a note for each paper (a literature note, a reference card), the properties to find it by, one per line, tried in order, for example `doi`, `arxiv`, `zotero`, `source`, `title`; `file.name` is the note's own name. A property may hold the DOI (with or without `https://doi.org/`), the arXiv id or URL, a Zotero key or `zotero://` link, the PDF's path, or the title. The first property that matches **exactly one** note wins. The note it finds gives the tokens `{{paperNote}}` and `{{paperNoteFolder}}`. |
| Look for it in these folders | the whole vault | |

### Prerequisites and concepts

| Setting | Default | |
|---|---|---|
| Match concept notes | off | Match the paper's prerequisites to the notes your vault keeps for concepts, by the note's name, its `title` and its `aliases` (case, accents, punctuation, a leading article and a plural aside: *Markov decision processes (MDPs)* matches *Markov decision process*). A name that fits two notes picks neither; you choose in the review. Adds two properties to the chapter (below). |
| Concept note folders | the whole vault | One per line. |
| A concept note holds | | Rules, one per line, **all** of which a concept note holds: a tag (`tag: concept` or `#concept`) or a property and its values (`type: concept`). |
| Known concepts | | Rules, one per line, **any** of which marks a concept note as known, so the review ticks it and says why: a folder (`folder: Concepts/Mastered`), a tag (`#known`), or a property and its values (`status: mastered, evergreen`; `axiom: true`). |
| Property for what it teaches | `teaches` | The concept notes the chapter teaches, a list of links. |
| Property for what it assumes | `prerequisites` | Every prerequisite matched to a concept note, a list of links. A learning tool may already use `requires` for the edges between concepts; this is a different relation, so pick another name. |

Matching suggests and you confirm. Nothing is ticked as known without a reason the review shows (a rule,
the Knowledge OS, or the Dataview source), and nothing is ticked from a name alone. A paper's progress
(what you know today) is never written into its chapter: it changes with every study session, and the
Knowledge OS integration draws it live instead.

With *Properties* on paper2chapter's own rows, the two properties are added after them; with your own rows,
**Add the concept rows** adds them for you. The tokens `{{concepts}}` (what it teaches), `{{primedConcepts}}`
(matched prerequisites the chapter teaches in a primer), `{{assumedConcepts}}` (every matched prerequisite) and
`{{knownConcepts}}` (the ones you knew) hold the notes as link targets.

A note you pick in the review is judged as a match would be: it comes ticked, with its reason, when a rule, the
Knowledge OS or Dataview says you know it, unless you have set that tick yourself.

A chapter imported later, or made by the batch, is matched again when it is written: only a name that fits one
note links it, and what was known is what the chapter was generated with (the manifest says so, rather than
giving today's reason).

### Chapters

| Setting | Default | |
|---|---|---|
| Folder | `Paper chapters` | A template: `Reading/{{year}}`, `{{paperNoteFolder}}/chapters`, … |
| Note name | `{{paperTitle}}` | A template: `{{firstAuthor}} {{year}} - {{paperTitle}}`, `{{paperNote}} - Chapter`, … |
| Figures | in a subfolder beside the note | Or where Obsidian puts attachments (*Settings → Files and links*), or a fixed folder. Each figure's name starts with the note's name, so two chapters never share one. |
| When the name is taken | write a second note, numbered | Or write nothing (the chapter stays on the backend; *Import a chapter generated earlier* writes it later). |
| Quiet hours | none | For example `23:00-06:00`: no note is written then (useful when other tools work in the vault at night); a chapter that finishes in them waits for their end. |
| Default audience, Python exercises, Include solutions, Open the note | | |

**Tokens** fill folder, name, heading, page-link and property templates: `{{title}}` (the chapter's),
`{{paperTitle}}`, `{{authors}}`, `{{firstAuthor}}`, `{{year}}`, `{{field}}`, `{{doi}}`, `{{arxiv}}`,
`{{zoteroKey}}`, `{{zoteroPdfKey}}`, `{{pdf}}`, `{{pdfLink}}`, `{{paperNote}}`, `{{paperNoteFolder}}`,
`{{paperSlug}}`, `{{paperId}}`, `{{provider}}`, `{{model}}`, `{{audience}}`, `{{generated}}`, the concept tokens
`{{concepts}}`, `{{primedConcepts}}`, `{{assumedConcepts}}` and `{{knownConcepts}}` (above), and
`{{date:FORMAT}}` (a [moment.js format](https://momentjs.com/docs/#/displaying/format/), e.g.
`{{date:YYYY-MM-DD}}`). A token the paper has no value for is empty; a name that is no token is left as you
typed it, and the settings point it out.

### Note format

| Setting | Default | |
|---|---|---|
| Layout | paper2chapter | **paper2chapter**: the note as the backend writes it (above). **Textbook**: the one-line summary, what the paper adds, objectives, intuition, *What it assumes* (the prerequisites, then their primers), notation, the sections, summary, practice, references. **My template note**: your own. |
| Template note | | A note with placeholders for the chapter's pieces and with tokens (below). |
| Section heading | `{{n}}. {{title}}` | With `{{page}}` (the first page the section cites) and `{{pages}}`, e.g. `1.{{n}} {{title}}{{#page}} — p. {{page}}{{/page}}`. |
| Section heading level | `##` | Derivations, primers and *Check your understanding* sit one level below. |
| Worked examples | in their sections | Or gathered in one place, where the template puts `{{workedExamples}}`. |
| Page links | automatic | To the PDF in the vault, its Zotero item, or the file on this computer; or a URL template with `{page}` and tokens (percent-encoded), e.g. `zotero://open-pdf/library/items/{{zoteroPdfKey}}?page={page}`; or plain page numbers. |

A **template note** is Markdown with two kinds of placeholder:

- **Pieces of the chapter**: `{{about}}`, `{{oneLine}}`, `{{newOrSurprising}}`, `{{objectives}}`, `{{intuition}}`,
  `{{prerequisites}}`, `{{primers}}`, `{{notation}}`, `{{sections}}`, `{{workedExamples}}`, `{{summary}}`,
  `{{takeaways}}`, `{{misconceptions}}`, `{{practice}}`, `{{furtherReading}}`, `{{references}}`, `{{warnings}}`,
  and from the integrations `{{progress}}` (the Knowledge OS's live block) and `{{flashcards}}`.
  A piece alone on its line brings its lines; after `> ` (inside a callout) each of its lines gets the same
  prefix; an empty piece removes its line. A block the template does not place goes after the frontmatter
  (`{{progress}}`) or into a *Flashcards* section at the end (`{{flashcards}}`).
- **Tokens**, as above, filled in the template's own text only, never inside a piece.

`{{#name}} … {{/name}}` keeps what it encloses only when that piece or token is not empty, on lines of their own
or within a line. The template's own frontmatter is not used: a note's properties come from the next section.

```markdown
# {{title}}

{{#oneLine}}
> [!abstract] In one line
> {{oneLine}}

{{/oneLine}}
## Arc

{{sections}}

## Worked examples

{{workedExamples}}

## Practice

{{practice}}
```

### Properties

| Setting | Default | |
|---|---|---|
| Properties | paper2chapter's | The frontmatter shown above, or **my own**: rows of a name, a type and a value template. |

A row's types are text, list, link, links, number, date and checkbox. A list row gives one item per author (or per
line of its value); a link row wraps its value in `[[…]]` (a list when there are several); a links row is always a
list of links, even with one; a row whose value comes out empty is left out. Rows can be added, removed and
reordered, and *Start from paper2chapter's rows* fills in the default ones to edit.

### Integrations

Each of these works with another plugin. Each is optional: its row says whether that plugin is on, installed but
turned off, or not installed, what it adds, and where to get it (**Get it** opens its page in Obsidian's community
directory, or BRAT when the plugin is not listed there and BRAT is installed, or the project's page). Nothing is
installed for you, and another plugin's settings are only read. The first time the plugin loads, one notice names
the ones not installed, once.

Two of them, **Knowledge OS** and **Note Relatives**, are written by a contributor to this plugin; they are listed
here like the others.

| Integration | Default | What it adds |
|---|---|---|
| Knowledge OS | off | With *Match concept notes* on: what counts as known comes from the Knowledge OS's own standing (a concept stands when it and everything it rests on are granted, passed, mastered or placed), with the rules as the fallback for concepts it does not know; and each chapter gets its live block, which draws what the chapter teaches and assumes with their state today. Needs the Knowledge OS plugin 1.1 or later (desktop, Python, and a vault with a learning road). |
| Note Relatives | off | Its block after the frontmatter (the block name is read from Note Relatives), which shows the chapter's paper, what it teaches and what it assumes as links. The row says which of those properties Note Relatives draws no row for, and opens its settings. |
| Dataview | off | A Dataview source (`"Concepts/Mastered"`, `#known`, …) whose notes count as known, beside the rules. |
| Templater | off | Runs your template note's own Templater tags after the note is written. Text from the paper and the model is never run. |
| Spaced Repetition | | **Flashcards**: none, Spaced Repetition's syntax (the deck tag once, then each exercise as its question, a line `?`, and its answer, options and the right one included), or your own card template with `{{question}}`, `{{answer}}`, `{{kind}}` and `{{difficulty}}`. From the primers' checks, the sections' questions and the practice problems (backend 0.4.0 or later). |
| Commands after writing | none | Obsidian command ids, one per line, run in order once the new note is open (a linter's *Lint the current file*, for example). They act on the open note, so nothing runs when *Open the note when it is ready* is off, or for the batch. |

**For plugin authors.** The Knowledge OS is used only through what its plugin publishes, version 1:

```ts
app.plugins.plugins['knowledge-os'].api = {
	version: 1,
	// the standing of concepts, by note name; names it does not know are left out
	status(names: string[]): Promise<Record<string, { state: string; stands: boolean; note?: string }>>,
	open?(action: 'check' | 'teach' | 'place' | 'explore', concept: string): void,
};
```

and its block, which names the two properties it draws from:

````markdown
```knowledge-os
progress
teaches: teaches
assumes: prerequisites
```
````

Without that API (an older Knowledge OS), the plugin asks it nothing and writes no block.

### Learning outputs

| Setting | Default | |
|---|---|---|
| Chapter manifest | off | Beside each chapter, a JSON file for tools that track what you know: the paper and its ids, each prerequisite with the note it matched and whether you knew it and why (a rule, the Knowledge OS, Dataview, or your tick), the primers, the concepts it teaches, and every exercise. Its format is in [MANIFEST.md](MANIFEST.md). Never written over another file, and not written for a note that was not. |
| Manifest path | `Paper chapters/manifests/{{paperSlug}}.json` | A template with tokens. |

### Batch

Queue papers and they become chapters one at a time: right-click a PDF → *Add to the chapter batch*, or the
commands *Add this PDF to the chapter batch*, *Add the PDF files of a folder to the chapter batch…* (a vault folder,
or a folder outside the vault from *Sources*) and *Add a Zotero collection to the chapter batch…*. *Show the chapter
batch* lists each paper with its state, and pauses, resumes, retries the failed and clears the finished.

- A paper whose chapter note is already there is skipped; one the backend has already written is imported, not
  generated again.
- Nobody reviews a batch: each paper is generated with what the rules, the Knowledge OS or Dataview say you know.
  Open a paper on its own to confirm its matches.
- The queue is kept when Obsidian closes, and goes on when it opens again (a paper that was running starts over).
  Pausing lets the paper in hand finish.

### Settings profile

- **Preview** (also the command *Preview the chapter note these settings write*): the note your settings write for
  a sample chapter, rendered or as Markdown, with its path. No model is asked and nothing is written; it is made
  by the same code that writes a real note.
- **Export settings** copies them as JSON, without this computer's paths or the plugin's cache; **Import
  settings** pastes them back, here or in another vault. **Reset the note settings** returns everything but the
  backend and the model to the defaults.
- Every folder, template and URL is checked as you type it, with the reason shown beside it.

## Troubleshooting

| Message | What to do |
|---|---|
| *Set "Backend folder" …* | Point it at `…/paper2chapter/backend` (the folder with `app/main.py`). |
| *The backend exited while starting* + `No module named …` | The venv lacks the requirements: `pip install -r requirements.txt` in it, or set *Python*. The full output is under *Backend log* in the settings. |
| *Claude Code is not signed in* | Run `claude` in a terminal and `/login` with your Claude account. |
| *Codex is not signed in (or its sign-in expired)* | `codex logout`, then `codex login`. |
| *… usage limit was reached* | Your plan's limit; wait for it to reset, or pick a lighter model (Haiku, GPT-6 Luna). |
| *… did not answer within 900 s* | Raise `CLI_TIMEOUT_S` in the backend's `.env`, or use a faster model or lower effort. |
| *Zotero is not answering …* | Start Zotero, or check *Zotero address*. |
| *Zotero's local API is off* | Zotero → Settings → Advanced → *Allow other applications on this computer to communicate with Zotero*. |
| *The template note … does not exist* | Pick the template again under *Note format*; it must be a note in this vault. |
| *This version of Knowledge OS has no API for other plugins yet* | Update the Knowledge OS plugin to 1.1 or later; until then the rules decide what is known, and no block is written. |
| *Note Relatives draws no row for …* | In Note Relatives' settings, add a forward or an inverse row for each property it names. |
| *These commands did not run* | The command ids under *Commands after writing*: each must be one Obsidian knows (the settings check them as you type). |
| Port 8000 is taken | Change *Backend address* to another port, e.g. `http://127.0.0.1:8765`; the plugin starts the backend there. |

The plugin is desktop-only: starting the backend and the subscription CLIs need a desktop.
