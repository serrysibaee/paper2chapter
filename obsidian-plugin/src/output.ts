/*
 * Where a chapter note goes: the folder and note-name templates filled with the paper's tokens, and quiet hours,
 * during which no note is written (a chapter that finishes then waits for their end).
 */
import { fill, type FormatDate, type Tokens } from './tokens.ts';
import { normalizeFolder, safeName } from './writer.ts';

/** A folder from its template: each segment made safe, empty segments dropped. */
export function resolveFolder(template: string, tokens: Tokens, formatDate: FormatDate): string {
	const filled = fill(template, tokens, formatDate, ' ');
	return normalizeFolder(filled).split('/')
		.map((seg) => seg.replace(/[\\:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, ''))
		.filter(Boolean).join('/');
}

/** A note's name from its template, made safe; empty falls back to `fallback`. */
export function resolveName(template: string, tokens: Tokens, formatDate: FormatDate, fallback: string): string {
	const filled = fill(template, tokens, formatDate, ', ').trim();
	return safeName(filled || fallback);
}

const QUIET_RE = /^\s*([01]\d|2[0-3]):([0-5]\d)\s*[-–]\s*([01]\d|2[0-3]):([0-5]\d)\s*$/;

export function parseQuiet(spec: string): { from: number; to: number } | null {
	const m = spec.match(QUIET_RE);
	if (!m) return null;
	return { from: Number(m[1]) * 60 + Number(m[2]), to: Number(m[3]) * 60 + Number(m[4]) };
}

/** Milliseconds until the quiet hours end, or 0 when `now` is outside them (or none are set). */
export function quietDelay(now: Date, spec: string): number {
	const q = parseQuiet(spec);
	if (!q || q.from === q.to) return 0;
	const minutes = now.getHours() * 60 + now.getMinutes();
	const inside = q.from < q.to ? minutes >= q.from && minutes < q.to : minutes >= q.from || minutes < q.to;
	if (!inside) return 0;
	const end = new Date(now);
	end.setHours(Math.floor(q.to / 60), q.to % 60, 0, 0);
	if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1);
	return end.getTime() - now.getTime();
}
