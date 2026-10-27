/*
 * Concept notes and what the reader knows: the notes a vault keeps for concepts, matched to a paper's prerequisites
 * by name, title and aliases; the rules that mark a concept as known; and the review the reader confirms before a
 * chapter is written. Matching suggests and the reader confirms: nothing is ticked as known without a reason the
 * review shows (a rule, the Knowledge OS, a Dataview source), and a name that fits two notes picks neither.
 * Free of the obsidian module, so it is unit-tested.
 */
import { inFolders } from './paperNote.ts';
import type { Prerequisite } from './types.ts';

export interface ConceptNote {
	path: string; // vault path, with .md
	basename: string;
	linktext: string; // how a link names it from anywhere in the vault
	frontmatter: Record<string, unknown>;
	tags: string[]; // without '#'
}

export type Rule =
	| { kind: 'folder'; folder: string }
	| { kind: 'tag'; tag: string }
	| { kind: 'property'; key: string; values: string[] };

const RULE_HELP = 'write folder: …, tag: …, or a property and its values (status: mastered, evergreen).';

/** One rule per line: `folder: Concepts`, `tag: known` (or `#known`), `status: mastered, evergreen`. */
export function parseRules(text: string): { rules: Rule[]; problems: string[] } {
	const rules: Rule[] = [];
	const problems: string[] = [];
	text.split(/\r?\n/).forEach((raw, i) => {
		const line = raw.trim();
		if (!line) return;
		if (/^#[^\s#]+$/.test(line)) {
			rules.push({ kind: 'tag', tag: line.slice(1) });
			return;
		}
		const m = line.match(/^([^:]+):\s*(.*)$/);
		const key = m?.[1]?.trim() ?? '';
		const value = m?.[2]?.trim() ?? '';
		if (!m || !key || !value) {
			problems.push(`Line ${i + 1}: ${RULE_HELP}`);
			return;
		}
		if (key === 'folder') rules.push({ kind: 'folder', folder: value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') });
		else if (key === 'tag') rules.push({ kind: 'tag', tag: value.replace(/^#/, '') });
		else rules.push({ kind: 'property', key, values: value.split(',').map((v) => v.trim()).filter(Boolean) });
	});
	return { rules, problems };
}

export function ruleText(r: Rule): string {
	if (r.kind === 'folder') return `folder: ${r.folder}`;
	if (r.kind === 'tag') return `tag: ${r.tag}`;
	return `${r.key}: ${r.values.join(', ')}`;
}

function propValues(fm: Record<string, unknown>, key: string): string[] {
	const v = fm[key];
	const one = (x: unknown) => (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' ? [String(x)] : []);
	return Array.isArray(v) ? v.flatMap(one) : one(v);
}

export function matchesRule(n: ConceptNote, r: Rule): boolean {
	if (r.kind === 'folder') return inFolders(n.path, [r.folder]);
	if (r.kind === 'tag') {
		const t = r.tag.toLowerCase();
		return n.tags.some((x) => {
			const y = x.replace(/^#/, '').toLowerCase();
			return y === t || y.startsWith(t + '/');
		});
	}
	const want = r.values.map((v) => v.toLowerCase());
	return propValues(n.frontmatter, r.key).some((v) => want.includes(v.trim().toLowerCase()));
}

/** A concept note: in one of the folders (none: anywhere), and holding every filter rule. */
export function isConceptNote(n: ConceptNote, folders: string[], filter: Rule[]): boolean {
	return inFolders(n.path, folders) && filter.every((r) => matchesRule(n, r));
}

/**
 * A name reduced to what matching compares: no accents, case or punctuation, a parenthesis and a leading article
 * dropped, the last word singular.
 */
export function conceptKey(name: string): string {
	const words = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
		.replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
	if (!words.length) return '';
	if (words.length > 1 && ['the', 'a', 'an'].includes(words[0]!)) words.shift();
	const last = words[words.length - 1]!;
	words[words.length - 1] = last.length <= 3 ? last
		: /ies$/.test(last) ? last.slice(0, -3) + 'y'
			: /(ss|us|is)$/.test(last) ? last
				: /(s|x|z|ch|sh)es$/.test(last) ? last.slice(0, -2)
					: /s$/.test(last) ? last.slice(0, -1) : last;
	return words.join(' ');
}

function namesOf(n: ConceptNote): string[] {
	const names = [n.basename, ...propValues(n.frontmatter, 'title')];
	for (const key of ['aliases', 'alias']) names.push(...propValues(n.frontmatter, key));
	return names;
}

/** Concept notes by the keys of their names, titles and aliases. */
export class ConceptIndex {
	private byKey = new Map<string, ConceptNote[]>();
	private notes: ConceptNote[];

	constructor(notes: ConceptNote[]) {
		this.notes = notes;
		for (const n of notes) {
			for (const k of new Set(namesOf(n).map(conceptKey).filter(Boolean))) {
				const list = this.byKey.get(k) ?? [];
				list.push(n);
				this.byKey.set(k, list);
			}
		}
	}

	all(): ConceptNote[] {
		return this.notes;
	}

	/** Every note whose name, title or alias is this name. */
	find(name: string): ConceptNote[] {
		const keys = new Set([conceptKey(name), conceptKey(name.replace(/\s*\([^)]*\)\s*/g, ' '))]);
		const out: ConceptNote[] = [];
		for (const k of keys) for (const n of this.byKey.get(k) ?? []) if (!out.includes(n)) out.push(n);
		return out;
	}
}

/**
 * Why a concept was pre-ticked as known; null: it was not. `generation`: a chapter written without a review (an
 * import, or the batch writing a chapter the backend had) knows only that it was known when it was generated.
 */
export type KnownBy =
	| { by: 'rule'; rule: string }
	| { by: 'knowledge-os'; state: string }
	| { by: 'dataview' }
	| { by: 'reader' }
	| { by: 'generation' }
	| null;

export interface KosStatus {
	state: string; // granted, provisional, passed, mastered, ready, locked, to-read, …
	stands: boolean; // it, and everything it rests on, stands
	note?: string;
}

export interface KnownSources {
	rules: Rule[];
	kos?: Record<string, KosStatus> | null; // the Knowledge OS's standing, by concept name
	dataview?: Set<string> | null; // paths a Dataview source returns
}

/** The Knowledge OS decides a concept it knows; else a Dataview source; else the rules. */
export function knownFor(note: ConceptNote | null, name: string, src: KnownSources): KnownBy {
	const st = src.kos ? (note ? src.kos[note.basename] : undefined) ?? src.kos[name] : undefined;
	if (st) return st.stands ? { by: 'knowledge-os', state: st.state } : null;
	if (!note) return null;
	if (src.dataview?.has(note.path)) return { by: 'dataview' };
	const r = src.rules.find((x) => matchesRule(note, x));
	return r ? { by: 'rule', rule: ruleText(r) } : null;
}

export function knownText(k: KnownBy): string {
	if (!k) return '';
	if (k.by === 'rule') return `known by the rule ${k.rule}`;
	if (k.by === 'knowledge-os') return `the Knowledge OS: ${k.state}`;
	if (k.by === 'dataview') return 'known by the Dataview source';
	if (k.by === 'generation') return 'known when the chapter was generated';
	return 'ticked by you';
}

export interface ReviewRow {
	id: string;
	name: string;
	level: string;
	why: string;
	candidates: ConceptNote[]; // the notes the name matches
	note: ConceptNote | null; // the reader's pick: the one candidate by default, none when two fit
	known: boolean; // ticked
	suggested: KnownBy; // why it was pre-ticked
	touched?: boolean; // the reader set the tick: picking another note leaves it
}

export interface ReviewEnv {
	notes: () => ConceptNote[]; // the concept notes, already filtered by folder and rules
	rules: Rule[];
	knowledge?: (names: string[]) => Promise<Record<string, KosStatus> | null>;
	dataview?: () => Set<string> | null;
}

/**
 * Each prerequisite with its match and its known state, ready for the reader to confirm or change, and the sources
 * that decided it, so a note the reader picks later is judged the same way.
 */
export async function reviewFor(prereqs: Prerequisite[], env: ReviewEnv): Promise<{ rows: ReviewRow[]; sources: KnownSources }> {
	const index = new ConceptIndex(env.notes());
	const found = prereqs.map((p) => {
		const candidates = index.find(p.name);
		return { p, candidates, note: candidates.length === 1 ? candidates[0]! : null };
	});
	let kos: Record<string, KosStatus> | null = null;
	if (env.knowledge) {
		const names = [...new Set(found.map((r) => r.note?.basename ?? r.p.name))];
		try { kos = await env.knowledge(names); } catch { kos = null; }
	}
	let dataview: Set<string> | null = null;
	try { dataview = env.dataview?.() ?? null; } catch { dataview = null; }
	const sources: KnownSources = { rules: env.rules, kos, dataview };
	const rows = found.map(({ p, candidates, note }) => {
		const suggested = knownFor(note, p.name, sources);
		return { id: p.id, name: p.name, level: p.level, why: p.why_needed, candidates, note, known: !!suggested, suggested };
	});
	return { rows, sources };
}

export async function suggestReview(prereqs: Prerequisite[], env: ReviewEnv): Promise<ReviewRow[]> {
	return (await reviewFor(prereqs, env)).rows;
}

/**
 * The reader picks another note for a prerequisite (or none): it is judged as a match would be, its known state
 * suggested with its reason, unless the reader set the tick already. The Knowledge OS is asked about a note it was
 * not asked about before.
 */
export async function repick(row: ReviewRow, note: ConceptNote | null, sources: KnownSources, env?: ReviewEnv): Promise<void> {
	row.note = note;
	if (note && env?.knowledge && !(sources.kos && note.basename in sources.kos)) {
		try {
			const more = await env.knowledge([note.basename]);
			if (more && Object.keys(more).length) sources.kos = { ...(sources.kos ?? {}), ...more };
		} catch { /* the rules decide */ }
	}
	if (row.touched) return;
	row.suggested = knownFor(note, row.name, sources);
	row.known = !!row.suggested;
}

/** The concept a paper is named for: its title, or the part before a colon or a dash. */
export function teachSuggestions(title: string, index: ConceptIndex): ConceptNote[] {
	const tries = [title, title.split(/:|\s[-–—]\s/)[0] ?? ''].map((t) => t.trim()).filter(Boolean);
	const out: ConceptNote[] = [];
	for (const t of tries) for (const n of index.find(t)) if (!out.includes(n)) out.push(n);
	return out;
}

export interface ConceptLinks {
	teaches: string[]; // linktexts of the concept notes the chapter teaches
	primed: string[]; // matched prerequisites the chapter teaches in a primer
	assumed: string[]; // every matched prerequisite
	known: string[]; // matched prerequisites the reader knew
}

export function conceptLinks(rows: ReviewRow[], teaches: ConceptNote[], primed: Set<string>): ConceptLinks {
	const uniq = (notes: (ConceptNote | null)[]) => {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const n of notes) {
			if (n && !seen.has(n.path)) {
				seen.add(n.path);
				out.push(n.linktext);
			}
		}
		return out;
	};
	return {
		teaches: uniq(teaches),
		primed: uniq(rows.filter((r) => primed.has(r.id)).map((r) => r.note)),
		assumed: uniq(rows.map((r) => r.note)),
		known: uniq(rows.filter((r) => r.known).map((r) => r.note)),
	};
}
