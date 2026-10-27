# Plan: note settings for the Obsidian plugin

Started 2026-10-26. This file is the tracker: each item is ticked in the commit that finishes it.

## Goal

The plugin writes one fixed note into one folder. Vaults differ: where the papers are (in the vault, in a folder
elsewhere, in Zotero), how a paper's own note is found, folder and naming conventions, frontmatter properties, the
layout of a note, and the tools a reader uses to track what they know. The goal is that **every such choice is a
setting**, so the plugin fits a vault instead of a vault fitting the plugin, and that **the defaults reproduce the
0.1.1 note exactly**, so no existing user sees a change they did not ask for.

## Decisions

| # | Decision | Why |
|---|---|---|
| N1 | The backend gives the chapter as **parts** (`export.parts`), each fragment already made inert; the plugin assembles them with a template. | The safety pass that makes model output inert stays in one place, in Python. A TypeScript copy would be a second implementation to keep in step. |
| N2 | The defaults reproduce the 0.1.1 note byte for byte, pinned by snapshot tests in the backend and, from S2, in the plugin. | Existing notes and habits keep working. |
| N3 | Page citations can follow a URL template (`page_link`, with `{page}`). | A PDF kept outside the vault (Zotero, a folder) cannot be linked as a vault path. |
| N4 | What a reader knows, and their progress, is never written into a chapter note; an integration that tracks it draws it live. | It changes with every study session; a written copy is stale the next day. |
| N5 | The plugin never edits an existing note or another plugin's settings. Every integration is optional and detected; when its plugin is missing, the settings say what it adds and how to get it, and the first-run notice says so once. Nothing is installed for the user. | Robust in any vault, and no nagging. |
| N6 | Two of the S3 integrations, **Knowledge OS** and **Note Relatives**, are written by the author of this contribution. They are listed beside the third-party integrations with the same wording, and the maintainer decides in review whether they stay. | Said plainly, so the maintainer can judge it. |
| N8 | The tokens for matched prerequisites are `{{assumedConcepts}}` (every one), `{{primedConcepts}}` and `{{knownConcepts}}`, beside `{{concepts}}` (what it teaches); the property that holds them is `prerequisites` by default. | `{{prerequisites}}` is already a template piece (the list of prerequisites with their state); one name with two meanings would confuse. |
| N9 | The backend gives every exercise as data in `export.parts` (`exercises`, backend 0.4.0, parts still `version: 1`). | Flashcards and the manifest need the question, the options and the answer apart; parsing them back out of rendered callouts would be fragile. |
| N10 | The Knowledge OS is used only through an API its plugin publishes (`api.version` ≥ 1, `status(names)`), and its block names the two properties it reads. Without that API nothing is asked and no block is written; the API and the block's renderer are the Knowledge OS's own work, in its repository. | A vault without it, or with an older version, never shows a raw code block or a broken call. |
| N11 | A batch is not reviewed: each paper is generated with what the rules, the Knowledge OS or Dataview say is known, and a prerequisite links to a note only when its name fits one. | A queue that waits for the reader at every paper is no batch; the single-paper window stays the place to confirm. |
| N12 | Unmatched prerequisites (a line in a note, or stub notes) are left for later. | Not asked for in this phase; a vault can read them from the manifest. |

## Phases (one pull request each)

### S1. Backend: parts and page links

- [x] Snapshot tests pin `export.md` in four variants (Obsidian with a PDF link, Obsidian, CommonMark, no solutions)
      from one mock chapter (`backend/tests/fixtures/`).
- [x] The renderer builds every piece once, in the note's order; `export.md` assembles them as before and
      `export.parts` returns them (`ChapterParts`, `version: 1`).
- [x] `page_link` on both endpoints: allowed schemes zotero, file, http(s), obsidian; `{page}` once; at most 500
      characters; nothing that would end a Markdown link.
- [x] The DOI and arXiv id printed on a PDF's first page, in the parts' paper metadata (`identifiers.py`).
- [x] Tests: each fragment equals the note's text in that place; a section's pieces; prerequisites known and
      primed; every fragment inert; page links; ids; both endpoints and their 400s.

### S2. Plugin: sources, output, format, properties

- [x] Sources: PDFs in the vault (as now), folders outside the vault (desktop), Zotero through its local API (read
      in Zotero 10's `server_localAPI.js`: items, children, `…/file/view/url`); the paper's own note found by
      properties (PDF path, Zotero key, DOI, arXiv id, title, the note's own name), exactly one or none.
- [x] Output: folder and note-name templates, where figures go (including Obsidian's attachment setting), what to
      do when a name is taken, quiet hours.
- [x] Format: layouts (today's note; a textbook layout), a template note with placeholders, page-link styles,
      heading level and numbering, worked examples inline or gathered.
- [x] Properties: rows of key, value template and type; tokens. Written as YAML in the note itself, every string
      double-quoted, rather than with `processFrontMatter` after the note exists: one write, and testable in Node
      (N7).
- [x] Preview with a bundled sample chapter (no model call, no write), validation as typed, settings export and
      import, migration from 0.1.1's settings.
- [x] Tests: the defaults' snapshot (the 0.1.1 note and path, byte for byte); each layout, properties, templates,
      page links, quiet hours, name clashes and figure modes on a scripted backend; the Textbook layout end to end
      on the real backend (mock provider).
- [x] Tag `0.2.0` (go-ahead given 2026-10-27): https://github.com/serrysibaee/paper2chapter/releases/tag/0.2.0,
      marked Latest; `main.js`, `manifest.json` and `styles.css` byte-identical to a local build.

N7: the preview and the writer share one code path. The preview runs the real `ChapterRun.write` against the
bundled sample (`src/sample.ts`, made by `backend/scripts/plugin_sample.py` from the backend's test fixture) and a
vault in memory, so what it shows is what a chapter gets.

### S3. Plugin: reader profile, integrations, chapter manifest

- [x] Known concepts from rules (folder, tag, property values; a Dataview source when Dataview is installed);
      prerequisites matched to notes by name, title and aliases, confirmed by the reader in the review table.
- [x] A prerequisites property, beside the concepts a chapter teaches (N8).
- [x] Integrations, each detected and each recommended when missing: Zotero (S2), Templater (the template's own
      tags only), Dataview, Spaced Repetition (cards from the exercises, N9), commands to run after writing,
      Knowledge OS (known concepts, and a live progress block, N10), Note Relatives (its block, and a check that it
      shows the chapter's properties). One notice, once, names those not installed.
- [x] A chapter manifest (JSON, `docs/MANIFEST.md`) for tools that track learning: the paper, each prerequisite
      with its match and whether it was known and why, the primers, the concepts, the exercises.
- [x] Batch: a queue of papers, one at a time, kept across restarts (N11).
- [x] `docs/OBSIDIAN.md` documents every setting.

## Results log

| Date | What | Result |
|---|---|---|
| 2026-10-26 | Backend before S1 | 112 passed, 1 skipped |
| 2026-10-26 | Backend after S1 | 139 passed, 1 skipped (4 snapshot tests, 23 parts tests) |
| 2026-10-26 | Plugin on the S1 backend | 26 passed, the end-to-end test included |
| 2026-10-26 | Plugin after S2 | 67 passed (41 new), the end-to-end test included; lint 0 errors 0 warnings; tsc clean; main.js 86 KB (the sample chapter is 21 KB of it) |
| 2026-10-27 | Live in Obsidian 1.15.0 (scratch vault, 0.1.1's saved settings) | settings migrated (backend folder kept); every group renders, settings search finds the new rows; a check shows its reason as typed; preview renders and sees the vault's existing notes; Textbook with a heading template, gathered examples and a custom row; import of a real chapter (GPT-6 Luna, 47 KB) wrote the note with 48 page links and its figure; Zotero off and not running: a clear message; the picker lists the vault PDF and a PDF from a folder outside the vault; reset works; no console errors; closing the window stopped the backend |
| 2026-10-27 | Found live, fixed | a failed Zotero search raised a notice per keystroke (now one message in place of the results); the model's own `##` headings sat beside the sections (now moved below, in the template layouts only); property rows did not line up (fixed widths) |
| 2026-10-27 | Release 0.2.0 | tag `0.2.0`; the release workflow passed and published it, marked Latest; its three assets byte-identical to a local build |
| 2026-10-27 | Backend after S3 | 142 passed, 1 skipped (2 new: exercises as data, answers kept without solutions; the inert test covers them) |
| 2026-10-27 | Plugin after S3 | 112 passed (69 before), the end-to-end test writing concepts, both blocks, flashcards and a manifest through the real backend; lint 0 errors 0 warnings; tsc clean. Not yet checked in a running Obsidian |
| 2026-10-27 | Live in Obsidian 1.15.0 (scratch vault, 0.2.0's saved settings; Note Relatives and Dataview enabled, Knowledge OS 1.0.0 installed and off, Templater and Spaced Repetition absent) | settings migrated to version 3; the one-time notice named only the two absent plugins; the new groups and their checks (rules, property names, command ids, a bad value not saved); each integration row's state, *Get it* opening Templater's community page, Note Relatives' missing-row warning and *Open its settings*; the preview with both concept properties and the nav block; the review window on the real paper (one match ticked by Dataview, two candidates, no match, *Another note…*, *What does it teach?* add and remove) with no model call; an import writing both properties, the nav block, flashcards and a 23-exercise manifest, the command after writing run; the batch skipping a paper whose note is there, and writing the backend's chapter (not generating) when it is not |
| 2026-10-27 | Found live, fixed | a ready row said "X is on" beside its own switch, off (now "installed and enabled"); a note the reader picks was not judged as a match is (now `repick`: ticked with its reason unless the reader set the tick); a multiple-choice card repeated its answer, and a coding card lacked its solution; an imported chapter (and the batch writing one the backend had) gave today's reasons for the ticks it was generated with (now `known_by: generation`). Plugin 117 passed |
