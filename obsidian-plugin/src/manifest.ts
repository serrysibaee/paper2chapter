/*
 * The chapter manifest: one JSON file per chapter note, for any tool that tracks what its reader knows. It records
 * the paper, each prerequisite with the note it matched and whether it was known and why, the primers, the concepts
 * the chapter teaches, and every exercise. Versioned; the format is in docs/MANIFEST.md.
 */
import { knownText, type ConceptNote, type ReviewRow } from './concepts.ts';
import type { ChapterParts, ExercisePart } from './types.ts';

export const MANIFEST_MARK = 'paper2chapter-chapter-manifest';
export const MANIFEST_VERSION = 1;

export interface ManifestPaper {
	title: string;
	authors: string[];
	year: string;
	doi: string;
	arxiv: string;
	paperId: string;
	pdf: string; // its vault path, or its path on this computer
	zotero: { item: string; pdf: string } | null;
	note: string | null; // the paper's own note in the vault
}

export interface ManifestInput {
	note: string; // the chapter note's path
	written: string; // ISO time
	parts: ChapterParts | null;
	rows: ReviewRow[];
	teaches: ConceptNote[];
	paper: ManifestPaper;
}

export type ManifestExercise = Omit<ExercisePart, 'starter_code' | 'solution_code'>;

export interface Manifest {
	manifest: typeof MANIFEST_MARK;
	version: number;
	note: string;
	written: string;
	generated: string | null;
	model: string | null;
	audience: string | null;
	paper: {
		title: string; authors: string[]; year: string | null;
		ids: { doi: string | null; arxiv: string | null; paper_id: string };
		pdf: string | null; zotero: { item: string; pdf: string } | null; note: string | null;
	};
	prerequisites: {
		id: string; name: string; level: string; why_needed: string;
		note: string | null; // the concept note it matched, as the reader confirmed it
		known: boolean;
		known_by: 'rule' | 'knowledge-os' | 'dataview' | 'reader' | 'generation' | null;
		reason: string;
		suggested: boolean; // pre-ticked before the reader looked (never for a chapter written without a review)
		primed: boolean; // the chapter teaches it in a primer
	}[];
	teaches: string[];
	primers: { prerequisite_id: string; title: string }[];
	exercises: ManifestExercise[];
}

export function buildManifest(i: ManifestInput): Manifest {
	const p = i.parts;
	const primed = new Set((p?.prerequisites ?? []).filter((x) => x.primed).map((x) => x.id));
	return {
		manifest: MANIFEST_MARK,
		version: MANIFEST_VERSION,
		note: i.note,
		written: i.written,
		generated: p?.generated_at ?? null,
		model: p ? `${p.provider}/${p.model}` : null,
		audience: p?.audience ?? null,
		paper: {
			title: i.paper.title, authors: i.paper.authors, year: i.paper.year || null,
			ids: { doi: i.paper.doi || null, arxiv: i.paper.arxiv || null, paper_id: i.paper.paperId },
			pdf: i.paper.pdf || null, zotero: i.paper.zotero, note: i.paper.note,
		},
		prerequisites: i.rows.map((r) => {
			const by = r.known ? (r.suggested?.by ?? 'reader') : null;
			return {
				id: r.id, name: r.name, level: r.level, why_needed: r.why, note: r.note?.path ?? null, known: r.known,
				known_by: by, reason: r.known ? knownText(r.suggested ?? { by: 'reader' }) : '',
				suggested: !!r.suggested && r.suggested.by !== 'generation',
				primed: primed.has(r.id),
			};
		}),
		teaches: [...new Set(i.teaches.map((n) => n.path))],
		primers: (p?.primers ?? []).map((x) => ({ prerequisite_id: x.prerequisite_id, title: x.title })),
		exercises: (p?.exercises ?? []).map((e) => {
			const { starter_code: _s, solution_code: _c, ...rest } = e;
			return rest;
		}),
	};
}

export function manifestText(m: Manifest): string {
	return JSON.stringify(m, null, '\t') + '\n';
}
