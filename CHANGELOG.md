# Changelog

## Obsidian plugin 0.4.0 (2026-10-27, released)

Three things a template could not say ([docs/PLAN-note-settings.md](docs/PLAN-note-settings.md), S4). Nothing a
0.3.0 template writes changes, and the defaults still write the 0.1.1 note.

### Added
- **A line per value**: a section over a list token whose text uses `{{.}}` is written once per value, `{{.}}` being
  the value (`{{#concepts}}` / `- [[{{.}}]]` / `{{/concepts}}` gives one linked line per concept), on lines of its own
  or within a line. A value is written as it is, never filled as a template. A section without `{{.}}` shows or hides
  as before, and the template check names a `{{.}}` outside a section over a list.
- **`{{pages}}` and `{{pageCount}}`**: the paper's pages, `1–N` from its page count, and the count, in every template.
  In a section heading, `{{pages}}` stays the pages the section cites.
- **`{{a|b}}`**: the first of its tokens that has a value, in folders, names, properties and notes
  (`{{paperNote|paperTitle}} - Chapter`). Each name in it is checked as it is typed.

## Obsidian plugin 0.3.0 (2026-10-27, released)

The third step toward note settings ([docs/PLAN-note-settings.md](docs/PLAN-note-settings.md), S3). The defaults
still write the 0.1.1 note in the same place, byte for byte, and 0.2.0's saved settings carry over, every new
option off. Flashcards and the manifest's exercises need backend 0.4.0.

### Added
- **Prerequisites and concepts**: the paper's prerequisites matched to your concept notes (folders and rules
  for what a concept note is), by name, title and aliases; rules for what counts as known (a folder, a tag, a
  property and its values). In the generation window, each prerequisite shows its note, which you can change, and
  comes ticked only with a reason it shows; *What does it teach?* lists the concept notes the chapter teaches. Two
  properties for them, `teaches` and `prerequisites` by default (names are settings), and the tokens
  `{{concepts}}`, `{{primedConcepts}}`, `{{assumedConcepts}}` and `{{knownConcepts}}`. A `links` property type.
- **Integrations**, each detected, with what it adds and where to get it, and one notice, once, naming those
  not installed: **Knowledge OS** (what is known from its standing, and a live progress block, through its
  published API, version 1), **Note Relatives** (its block, and which chapter properties it draws no row for),
  **Dataview** (a source of known notes), **Templater** (your template note's own tags run after writing; text from
  the paper never), **Spaced Repetition** (flashcards from the exercises, or your own card template), and
  **commands after writing**. Knowledge OS and Note Relatives are by a contributor to this plugin and are listed
  like the others.
- **Chapter manifest**: a JSON file beside each chapter for tools that track learning
  ([docs/MANIFEST.md](docs/MANIFEST.md)).
- **Batch**: papers from a PDF's menu, a folder or a Zotero collection, one at a time, kept across restarts, with
  pause, resume and retry; a paper whose note is there is skipped, and one the backend has already written is
  imported rather than generated again.

## Backend 0.4.0 (2026-10-27)

### Added
- `export.parts` gives **every exercise as data** (`exercises`): the primers' checks, the sections' questions and
  the practice problems, each with its kind, difficulty, prompt, choices, answer, explanation, code and its
  check, every text made inert. The answers are there whatever `include_solutions` says. The parts keep
  `version: 1`: a new field does not change it.

## Obsidian plugin 0.2.0 (2026-10-27, released)

The second step toward note settings ([docs/PLAN-note-settings.md](docs/PLAN-note-settings.md), S2). The defaults
write the 0.1.1 note in the same place, byte for byte, and 0.1.1's saved settings carry over. Needs backend 0.3.0
for the Textbook and template layouts and for page-link templates.

### Added
- **Sources**: folders outside the vault (desktop) and Zotero 7 or later through its local API (read-only), in one
  paper picker with the vault's PDFs. **Find the paper's own note** by properties tried in order (DOI, arXiv id,
  Zotero key, PDF path, title, or the note's own name), which must match exactly one note.
- **Chapters**: folder and note-name templates with tokens (`{{year}}`, `{{firstAuthor}}`, `{{paperNote}}`,
  `{{paperNoteFolder}}`, `{{date:FORMAT}}`, …); figures beside the note, where Obsidian puts attachments, or in a
  fixed folder; when the name is taken, a numbered note or none; quiet hours.
- **Note format**: layouts (paper2chapter, Textbook, your own template note with placeholders for the chapter's
  pieces, conditional blocks and tokens), the section heading's template and level, worked examples inline or
  gathered, and page links to the vault PDF, Zotero, the file on this computer, a URL template, or none. In these
  layouts the model's own headings go below the heading that holds them (a section body's "## …" becomes "### …").
- **Properties**: paper2chapter's frontmatter, or your own rows of a name, a type (text, list, link, number, date,
  checkbox) and a value template; added, removed and reordered in the settings.
- **Preview** of the note your settings write, from a bundled sample chapter, by the same code that writes real
  notes (no model, no write); **settings profiles** (export, import, reset); checks as you type for every folder,
  template and URL; a settings version, and migration from 0.1.1.

## Backend 0.3.0 (2026-10-27)

The first of three steps toward note settings in the Obsidian plugin ([docs/PLAN-note-settings.md](docs/PLAN-note-settings.md)).
`export.md` is unchanged byte for byte, pinned by a snapshot test.

### Added
- **`GET /api/papers/{id}/export.parts`**: the chapter as the note's pieces, for a client that builds its own note
  from a template: the about line, the one-line summary and the contributions (from the analysis), objectives,
  intuition, each primer, notation, each section (and inside it its intuition, body, derivations, worked examples
  and questions, the pages it cites), summary, takeaways, misconceptions, practice, further reading, references,
  warnings and the figures it embeds. Also the paper's metadata (title, authors, year, field, page count, and the
  DOI and arXiv id when the first page prints them) and each prerequisite with whether the reader knew it and
  whether a primer teaches it. Every fragment is made inert by the same pass as `export.md` and is exactly the
  text `export.md` has in that place. The response carries `version: 1`.
- **`page_link`** on `export.md` and `export.parts`: a URL template with `{page}` for page citations, for a PDF
  kept outside the vault, for example `zotero://open-pdf/library/items/<KEY>?page={page}` or
  `file:///C:/Papers/x.pdf#page={page}`. Allowed schemes: zotero, file, http(s), obsidian; spaces and brackets must
  be percent-encoded. With both, `page_link` makes the page links and `pdf_link` still names the note's PDF.

## Obsidian plugin 0.1.1, backend fixes (2026-10-25, released)

### Changed
- The plugin's settings tab uses Obsidian's declarative settings API, so its settings appear in
  Obsidian's settings search; the plugin now needs Obsidian 1.13 or later. Lint is clean (no errors,
  no warnings), with UI text reworded to sentence case.
- The model's note follows the selected model.
- Web app Settings: the intro says a subscription needs no API key.

### Fixed
- Windows: an npm shim that runs a native binary (Claude Code 2.1+ ships `claude.exe`), or a local
  `node_modules/.bin` shim, is now run directly instead of through cmd.exe.
- Claude Code: `--effort` and `--no-session-persistence` are passed when the CLI has them; with
  `CLAUDE_CLI_READ_PDF`, a CLI with `--tools` is offered only the Read tool.
- The parent watchdog logs the PID it watches.

## Backend 0.2.0, Obsidian plugin 0.1.0 (2026-10-25)

### Added
- **Subscriptions instead of API keys.** Providers `claude-cli` (Claude Pro/Max through Claude Code)
  and `codex-cli` (ChatGPT Plus/Pro through the Codex CLI). The CLI runs headless in an empty temp
  folder, with no tools, MCP servers or project settings; prompts go through stdin; API keys are
  removed from its environment. New settings: `CLAUDE_CLI_PATH`, `CODEX_CLI_PATH`, `CLI_TIMEOUT_S`,
  `CLI_MAX_CONCURRENCY`, `CLAUDE_CLI_READ_PDF`.
- `GET /api/providers/{id}/check`: is a subscription CLI installed and signed in.
- **Markdown export**: `GET /api/papers/{id}/export.md`, one Obsidian-flavoured (or CommonMark) note
  with frontmatter, math, callouts, folded solutions, figure embeds and page links. Model output is
  made inert (HTML escaped, Templater and Dataview syntax broken, unknown code languages to text).
- **Obsidian plugin** (`obsidian-plugin/`): generate a chapter from a PDF in the vault, tick known
  prerequisites, write one note with its figures; starts and stops the backend; reuses an unchanged
  PDF's extraction and analysis; imports chapters generated earlier.
- Settings page: the subscription tier, *included in your plan*, a CLI check button and setup hints.
- `backend/scripts/smoke_cli.py`: one real paper end to end with any provider.
- Parent watchdog (`P2C_PARENT_PID`): a backend started by the plugin exits once Obsidian is gone.
- CI for the backend, frontend and plugin; a release workflow for the plugin.

### Changed
- Per-provider `max_concurrency` (subscriptions default to 2 parallel requests).

## 0.1.0 (2026-10-25)
- Initial MVP: PDF extraction, analysis, prerequisites, chapter generation with verification,
  web reader, HTML export.
