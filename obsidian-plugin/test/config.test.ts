import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	CHAPTER_ROWS, DEFAULT_SETTINGS, exportProfile, importProfile, isClassicNote, lines, migrate, SETTINGS_VERSION,
} from '../src/config.ts';

test('settings saved by 0.1.1 keep their values and gain the new defaults', () => {
	const old = {
		backendUrl: 'http://127.0.0.1:8765', backendDir: 'C:/code/p2c/backend', pythonPath: '', autoStart: false,
		outputFolder: 'Reading/Chapters', attachments: 'img', solutions: false, audience: 'graduate',
		includePython: false, openAfter: false, papers: { 'Papers/a.pdf': { paperId: 'abc', stamp: '1:2' } },
	};
	const s = migrate(old);
	assert.equal(s.settingsVersion, SETTINGS_VERSION);
	assert.equal(s.backendUrl, 'http://127.0.0.1:8765');
	assert.equal(s.outputFolder, 'Reading/Chapters');
	assert.equal(s.attachments, 'img');
	assert.equal(s.audience, 'graduate');
	assert.equal(s.autoStart, false);
	assert.deepEqual(s.papers, old.papers);
	assert.equal(s.layout, 'paper2chapter');
	assert.equal(s.propertiesMode, 'chapter');
	assert.ok(isClassicNote(s), 'an upgraded vault writes the same note as before');
});

test('nothing saved gives the defaults, which write the 0.1.1 note', () => {
	const s = migrate(null);
	assert.deepEqual({ ...s, propertyRows: [] }, { ...DEFAULT_SETTINGS, propertyRows: [] });
	assert.deepEqual(s.propertyRows, CHAPTER_ROWS);
	assert.ok(isClassicNote(s));
	assert.notEqual(s.propertyRows, DEFAULT_SETTINGS.propertyRows, 'a copy, so editing rows never edits the defaults');
});

test('values of the wrong type or outside their choices fall back, unknown keys go', () => {
	const s = migrate({ layout: 'fancy', audience: 7, headingLevel: 9, onExists: 'skip', junk: 1, propertyRows: [
		{ key: 'year', value: '{{year}}', type: 'number' }, { key: 'x', value: 'y', type: 'weird' }, { nope: true },
	] });
	assert.equal(s.layout, 'paper2chapter');
	assert.equal(s.audience, 'undergraduate');
	assert.equal(s.headingLevel, 2);
	assert.equal(s.onExists, 'skip');
	assert.ok(!('junk' in s));
	assert.deepEqual(s.propertyRows, [{ key: 'year', value: '{{year}}', type: 'number' }, { key: 'x', value: 'y', type: 'text' }]);
});

test('a profile carries the settings, not this computer\'s paths or the cache', () => {
	const mine = migrate({ backendDir: 'C:/me/backend', pythonPath: 'C:/py.exe', papers: { a: { paperId: 'p', stamp: 's' } },
		layout: 'textbook', noteName: '{{year}} {{paperTitle}}' });
	const text = exportProfile(mine);
	assert.ok(!text.includes('C:/me/backend') && !text.includes('py.exe') && !text.includes('"papers"'));
	const theirs = migrate({ backendDir: 'D:/them/backend', papers: { b: { paperId: 'q', stamp: 't' } } });
	const next = importProfile(text, theirs);
	assert.equal(next.layout, 'textbook');
	assert.equal(next.noteName, '{{year}} {{paperTitle}}');
	assert.equal(next.backendDir, 'D:/them/backend');
	assert.deepEqual(next.papers, { b: { paperId: 'q', stamp: 't' } });
});

test('a file that is not a profile is refused', () => {
	assert.throws(() => importProfile('not json', DEFAULT_SETTINGS), /not valid JSON/);
	assert.throws(() => importProfile('{"layout":"textbook"}', DEFAULT_SETTINGS), /not a paper2chapter settings profile/);
});

test('settings saved by 0.2.0 gain the reader, integration and batch settings, all off', () => {
	const s = migrate({ settingsVersion: 2, layout: 'textbook', noteName: '{{paperTitle}}' });
	assert.equal(s.settingsVersion, SETTINGS_VERSION);
	assert.equal(s.layout, 'textbook');
	for (const k of ['matchConcepts', 'knowledgeOs', 'noteRelatives', 'dataview', 'templater', 'manifest'] as const) assert.equal(s[k], false, k);
	assert.equal(s.flashcards, 'none');
	assert.equal(s.teachesKey, 'teaches');
	assert.equal(s.prerequisitesKey, 'prerequisites', 'never requires, the name a learning road may give its own edges');
	assert.deepEqual(s.queue, []);
	assert.ok(isClassicNote(migrate({ settingsVersion: 2 })));
});

test('each option that changes the note leaves the 0.1.1 note: matching, the two blocks, flashcards', () => {
	for (const over of [{ matchConcepts: true }, { noteRelatives: true }, { knowledgeOs: true }, { flashcards: 'spaced-repetition' as const }]) {
		assert.equal(isClassicNote({ ...DEFAULT_SETTINGS, ...over }), false, JSON.stringify(over));
	}
	for (const over of [{ manifest: true }, { afterCommands: 'editor:save-file' }, { dataview: true }, { templater: true }]) {
		assert.equal(isClassicNote({ ...DEFAULT_SETTINGS, ...over }), true, `${JSON.stringify(over)} leaves the note as it is`);
	}
});

test('the batch is kept, a paper that was running waits again, and a profile leaves the batch out', () => {
	const item = (status: string) => ({ key: `k-${status}`, name: 'a.pdf', kind: 'vault', status, added: '2026-10-27' });
	const s = migrate({ queue: [item('waiting'), item('running'), item('done'), { junk: 1 }, item('bogus')], queuePaused: true, introShown: true });
	assert.deepEqual(s.queue.map((q) => q.status), ['waiting', 'waiting', 'done']);
	assert.equal(s.queuePaused, true);
	const text = exportProfile(s);
	assert.ok(!text.includes('"queue"') && !text.includes('introShown'));
	const next = importProfile(text, migrate({ queue: [item('waiting')] }));
	assert.equal(next.queue.length, 1, 'this vault\'s batch stays');
});

test('a "links" property row migrates; an unknown type still falls back to text', () => {
	const s = migrate({ propertyRows: [{ key: 'teaches', value: '{{concepts}}', type: 'links' }] });
	assert.deepEqual(s.propertyRows, [{ key: 'teaches', value: '{{concepts}}', type: 'links' }]);
});

test('lines() reads one entry per line', () => {
	assert.deepEqual(lines(' a \r\n\n b\n'), ['a', 'b']);
});
