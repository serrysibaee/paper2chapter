# The chapter manifest

With *Chapter manifest* on (plugin 0.3.0 and later, *Settings → Paper2Chapter → Learning outputs*), the Obsidian
plugin writes one JSON file beside each chapter note it writes, at the path its template gives (default
`Paper chapters/manifests/{{paperSlug}}.json`). It is for tools that track what their reader knows: a spaced
repetition system, a learning road, a script that turns unknown prerequisites into notes to write. The plugin never
reads a manifest back and never writes one over another file (a second one gets ` 2`, as notes do).

```json
{
	"manifest": "paper2chapter-chapter-manifest",
	"version": 1,
	"note": "Paper chapters/Softmax Weighting for Robust Averaging.md",
	"written": "2026-10-27T12:00:00.000Z",
	"generated": "2026-10-26T17:51:48+00:00",
	"model": "claude-cli/sonnet",
	"audience": "graduate",
	"paper": {
		"title": "Softmax Weighting for Robust Averaging",
		"authors": ["Jane Doe"],
		"year": "2020",
		"ids": { "doi": "10.1234/x", "arxiv": null, "paper_id": "2ca5a031cb92" },
		"pdf": "Papers/softmax.pdf",
		"zotero": null,
		"note": "Reading/Papers/Softmax card.md"
	},
	"prerequisites": [
		{
			"id": "exponential-function", "name": "The exponential function", "level": "foundational",
			"why_needed": "Softmax exponentiates each score.",
			"note": "Concepts/Exponential function.md",
			"known": true, "known_by": "rule", "reason": "known by the rule axiom: true", "suggested": true,
			"primed": false
		}
	],
	"teaches": ["Concepts/Softmax.md"],
	"primers": [{ "prerequisite_id": "weighted-averages", "title": "Weighted averages" }],
	"exercises": [
		{
			"id": "p2", "where": "practice", "section": null, "prerequisite_id": null,
			"kind": "math", "difficulty": "medium",
			"prompt": "Compute $w_1$ for scores $z = (2, 0)$.", "choices": [], "correct_choice": null,
			"answer": "$w_1 \\approx 0.881$", "explanation": "…", "check": "verified"
		}
	]
}
```

| Field | |
|---|---|
| `manifest`, `version` | What the file is, and its format's version. The version goes up when a field changes meaning or goes away; a new field keeps it, so a reader ignores fields it does not know. |
| `note` | The chapter note, as a vault path. |
| `written`, `generated` | When the note was written, and when the backend generated the chapter. |
| `model`, `audience` | `provider/model`, and the audience the chapter was written for. |
| `paper` | Its title, authors and year; its DOI and arXiv id (from Zotero, the paper's own note, or the PDF's first page) and the backend's id; its PDF (a vault path, or a path on this computer); its Zotero item and PDF keys; the paper's own note in the vault, when *Find the paper's own note* found one. |
| `prerequisites` | Every prerequisite of the paper. `note`: the concept note it matched, as you confirmed it (null when none). `known`: whether the chapter was generated with you knowing it. `known_by`: why it was ticked, `rule`, `knowledge-os`, `dataview` or `reader`; `generation` for a chapter written without your review (*Import a chapter generated earlier*, or the batch writing a chapter the backend already had), which knows only that it was generated so; null when not known. `reason`: the same, in words. `suggested`: whether it was ticked before you looked (true with `known: false` means you unticked a suggestion). `primed`: whether the chapter teaches it in a primer. |
| `teaches` | The concept notes the chapter teaches, as you confirmed them. |
| `primers` | The primers the chapter opens with. |
| `exercises` | Every exercise, in the note's order: the primers' checks (`where: primer`, with `prerequisite_id`), the sections' questions (`where: section`, with the section's number) and the practice problems (`where: practice`). `kind` is `conceptual`, `multiple_choice`, `math` or `python`; `choices` and the 0-based `correct_choice` are for multiple choice; `check` is the backend's verification (`verified`, `failed`, `error`, `skipped`) or null. Every text is the note's own Markdown, made inert like the note. The answers are there whatever *Include solutions* says. |

Without concept matching, `note` is null for every prerequisite and `teaches` is empty. A backend before 0.4.0
gives no exercises.
