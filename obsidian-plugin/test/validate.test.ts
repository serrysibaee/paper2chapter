/* The checks the new settings run as they are typed: each says what is wrong in one sentence, or nothing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	checkCommands, checkFlashcardTag, checkFlashcardTemplate, checkManifestPath, checkPropertyName, checkRulesText,
} from '../src/validate.ts';

test('rules: each line a folder, a tag or a property with its values', () => {
	assert.equal(checkRulesText('folder: Concepts\n#known\nstatus: mastered, evergreen'), '');
	assert.match(checkRulesText('status mastered'), /^Line 1: /);
	assert.equal(checkRulesText(''), '');
});

test('a property name for the concept properties', () => {
	assert.equal(checkPropertyName('assumes'), '');
	assert.match(checkPropertyName(''), /needs a name/);
	assert.match(checkPropertyName('two words!'), /letters, digits/);
});

test('the manifest path: tokens it knows, inside the vault', () => {
	assert.equal(checkManifestPath('x/reports/paper-chapters/{{paperSlug}}.json'), '');
	assert.match(checkManifestPath('{{slugg}}.json'), /Unknown tokens: \{\{slugg\}\}/);
	assert.match(checkManifestPath('../out.json'), /above the vault/);
	assert.match(checkManifestPath(' '), /Type a path/);
});

test('flashcards: a deck tag with no space, and a template with the question and the answer', () => {
	assert.equal(checkFlashcardTag('#flashcards/papers'), '');
	assert.equal(checkFlashcardTag(''), '');
	assert.match(checkFlashcardTag('my cards'), /no spaces/);
	assert.equal(checkFlashcardTemplate('{{question}}::{{answer}}'), '');
	assert.match(checkFlashcardTemplate('{{question}}'), /\{\{answer\}\}/);
});

test('commands after writing: each id one Obsidian knows', () => {
	const known = (id: string) => ['editor:save-file', 'obsidian-linter:lint-file'].includes(id);
	assert.equal(checkCommands('obsidian-linter:lint-file\n\neditor:save-file', known), '');
	assert.equal(checkCommands('lint-it\nobsidian-linter:lint-file', known), 'No command with the id lint-it.');
	assert.equal(checkCommands('a\nb', known), 'No commands with the ids a, b.');
});
