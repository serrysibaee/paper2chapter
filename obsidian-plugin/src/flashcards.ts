/*
 * Flashcards from a chapter's exercises: the primers' checks, the sections' questions and the practice problems.
 * In the Spaced Repetition plugin's syntax (the deck tag once, then each card as its question, a line with "?", and
 * its answer, cards apart by a blank line, so no blank line inside a card), or one card per a line template.
 */
import type { FlashcardsMode } from './config.ts';
import type { ExercisePart } from './types.ts';

export interface FlashcardOptions {
	mode: FlashcardsMode;
	tag: string; // the deck tag, with or without '#'; empty: none
	template: string; // custom: {{question}}, {{answer}}, {{kind}}, {{difficulty}}
}

const letter = (i: number) => String.fromCharCode(65 + i);

function question(e: ExercisePart): string {
	const opts = e.choices.map((c, i) => `${letter(i)}. ${c}`);
	return [e.prompt, ...(opts.length ? [opts.join('\n')] : [])].join('\n');
}

function answer(e: ExercisePart): string {
	const right = e.correct_choice !== null && e.choices[e.correct_choice] !== undefined
		? `**${letter(e.correct_choice)}.** ${e.choices[e.correct_choice]}` : '';
	return [right, e.answer, e.explanation].filter((x) => x.trim()).join('\n\n');
}

const noBlankLines = (s: string) => s.split('\n').filter((l) => l.trim() !== '').join('\n');

export function flashcards(exercises: ExercisePart[], o: FlashcardOptions): string {
	if (o.mode === 'none' || !exercises.length) return '';
	const tag = o.tag.trim().replace(/^#+/, '');
	const head = tag ? `#${tag}\n\n` : '';
	const cards = exercises.map((e) => {
		if (o.mode === 'spaced-repetition') return `${noBlankLines(question(e))}\n?\n${noBlankLines(answer(e))}`;
		const vals: Record<string, string> = { question: question(e), answer: answer(e), kind: e.kind, difficulty: e.difficulty };
		return o.template.replace(/\{\{(question|answer|kind|difficulty)\}\}/g, (_m, k: string) => vals[k] ?? '').trim();
	});
	return head + cards.join('\n\n') + '\n';
}
