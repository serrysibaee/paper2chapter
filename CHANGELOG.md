# Changelog

## Obsidian plugin 0.1.1, backend fixes (2026-10-25)

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
