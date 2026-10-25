import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defuse, normalizeFolder, safeName, writeChapter } from '../src/writer.ts';
import { MemoryVault } from './helpers.ts';

const files = (md = '# Chapter\n\n![[{prefix}F1.png]]', assets = ['F1.png']) => ({
	prefixes: [] as string[],
	async markdown(prefix: string) {
		this.prefixes.push(prefix);
		return { markdown: md.replace('{prefix}', prefix), assets };
	},
	async asset(name: string) {
		return new TextEncoder().encode('png:' + name).buffer;
	},
});

test('safeName keeps a readable, linkable title', () => {
	assert.equal(safeName('Attention: Is it [all] you need? #1 / v2'), 'Attention Is it all you need 1 v2');
	assert.equal(safeName('  ...trailing dots...  '), 'trailing dots');
	assert.equal(safeName('\u0000'), 'Chapter');
	assert.equal(safeName('مرشح كالمان'), 'مرشح كالمان');
	assert.equal(normalizeFolder('\\Paper chapters\\2026/'), 'Paper chapters/2026');
});

test('a chapter becomes one note and its figures, in the right folders', async () => {
	const vault = new MemoryVault();
	const f = files();
	const res = await writeChapter(vault, f, { folder: 'Paper chapters/AI', attachments: 'attachments', title: 'Softmax: weighting' });
	assert.equal(res.notePath, 'Paper chapters/AI/Softmax weighting.md');
	assert.deepEqual(res.assetPaths, ['Paper chapters/AI/attachments/Softmax weighting - F1.png']);
	assert.ok(vault.folders.has('Paper chapters') && vault.folders.has('Paper chapters/AI/attachments'));
	assert.equal(vault.text(res.notePath), '# Chapter\n\n![[Softmax weighting - F1.png]]');
});

test('never overwrites: a second chapter of the same paper gets its own note and figures', async () => {
	const vault = new MemoryVault();
	await writeChapter(vault, files(), { folder: 'out', attachments: 'att', title: 'Paper' });
	const f = files();
	const res = await writeChapter(vault, f, { folder: 'out', attachments: 'att', title: 'Paper' });
	assert.equal(res.notePath, 'out/Paper 2.md');
	assert.deepEqual(f.prefixes, ['Paper 2 - ']);
	assert.ok(vault.files.has('out/att/Paper - F1.png') && vault.files.has('out/att/Paper 2 - F1.png'));
});

test('Templater tags are defused on the way into the vault', async () => {
	assert.equal(defuse('a <% tp.file.title %> b'), 'a <⁠% tp.file.title %> b');
	const vault = new MemoryVault();
	const res = await writeChapter(vault, files('x <%* app.vault.delete() %>', []), { folder: '', attachments: '', title: 'T' });
	assert.equal(res.notePath, 'T.md');
	assert.ok(!vault.text('T.md').includes('<%'));
});
