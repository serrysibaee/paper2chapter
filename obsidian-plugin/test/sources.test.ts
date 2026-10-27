import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPaperNote, normArxiv, normDoi, type NoteMeta } from '../src/paperNote.ts';
import { fileUrlToPath, listPdfs, pathToFileUrl, SourceError, ZoteroClient, zoteroItem } from '../src/sources.ts';
import { response, scripted } from './helpers.ts';

const notes: NoteMeta[] = [
	{ path: 'Reading/Papers/3D Gaussian Splatting.md', basename: '3D Gaussian Splatting', frontmatter: {
		title: '3D Gaussian Splatting for Real-Time Radiance Field Rendering',
		source: 'G:/My Papers/Literature/2023 - 3D Gaussian Splatting.pdf' } },
	{ path: 'Reading/Papers/Diffusion policy.md', basename: 'Diffusion policy', frontmatter: { arxiv: 'https://arxiv.org/abs/2303.04137v5' } },
	{ path: 'Reading/Papers/Survey.md', basename: 'Survey', frontmatter: { doi: 'https://doi.org/10.1145/3815113', zotero: 'zotero://select/library/items/ABCD1234' } },
	{ path: 'Other/Twin A.md', basename: 'Twin A', frontmatter: { title: 'A Shared Title Here' } },
	{ path: 'Other/Twin B.md', basename: 'Twin B', frontmatter: { title: 'A shared title, here' } },
	{ path: 'Other/Named After Its Paper.md', basename: 'Named After Its Paper', frontmatter: {} },
];

test('a paper\'s own note is found by its PDF, arXiv id, DOI, Zotero key or title', () => {
	const keys = ['source', 'arxiv', 'doi', 'zotero', 'title', 'file.name'];
	assert.equal(findPaperNote(notes, { pdfPath: 'G:\\My Papers\\Literature\\2023 - 3D Gaussian Splatting.pdf' }, keys)?.basename, '3D Gaussian Splatting');
	assert.equal(findPaperNote(notes, { arxiv: '2303.04137' }, keys)?.basename, 'Diffusion policy');
	assert.equal(findPaperNote(notes, { doi: '10.1145/3815113' }, keys)?.basename, 'Survey');
	assert.equal(findPaperNote(notes, { zoteroKey: 'ABCD1234' }, keys)?.basename, 'Survey');
	assert.equal(findPaperNote(notes, { title: '3D Gaussian splatting for real-time radiance field rendering' }, keys)?.basename, '3D Gaussian Splatting');
	assert.equal(findPaperNote(notes, { title: 'Named after its paper' }, keys)?.basename, 'Named After Its Paper');
});

test('a title two notes share picks neither; folders and key order narrow the search', () => {
	assert.equal(findPaperNote(notes, { title: 'A shared title here' }, ['title']), null);
	assert.equal(findPaperNote(notes, { title: 'A shared title here' }, ['title'], ['Library']), null);
	assert.equal(findPaperNote(notes, { arxiv: '2303.04137' }, ['arxiv'], ['Other']), null);
	assert.equal(findPaperNote(notes, { arxiv: '2303.04137' }, []), null, 'no keys: off');
	assert.equal(normDoi('DOI: 10.1/AbC.'), '10.1/abc');
	assert.equal(normArxiv('arXiv:2412.04453v2'), '2412.04453');
});

test('Zotero: search, the PDF attachment, and its file, through the local API', async () => {
	const http = scripted([
		(_r, u) => (u.pathname === '/api/users/0/items/top' ? response(200, [
			{ key: 'ITEM0001', data: { itemType: 'journalArticle', title: 'Diffusion Policy', date: '2023-03-07',
				creators: [{ creatorType: 'author', firstName: 'Cheng', lastName: 'Chi' }], url: 'https://arxiv.org/abs/2303.04137', DOI: '' } },
			{ key: 'NOTE0001', data: { itemType: 'note', note: 'x' } },
		]) : undefined),
		(_r, u) => (u.pathname === '/api/users/0/items/ITEM0001/children' ? response(200, [
			{ key: 'SNAP0001', data: { itemType: 'attachment', contentType: 'text/html', linkMode: 'imported_url' } },
			{ key: 'PDF00001', version: 7, data: { itemType: 'attachment', contentType: 'application/pdf', linkMode: 'imported_file', title: 'Full Text PDF', md5: 'abc', mtime: 123 } },
		]) : undefined),
		(_r, u) => (u.pathname === '/api/users/0/items/PDF00001/file/view/url'
			? response(200, 'file:///C:/Users/me/Zotero/storage/PDF00001/Chi%20et%20al.%20-%202023.pdf') : undefined),
	]);
	const z = new ZoteroClient('http://127.0.0.1:23119/', http);
	const items = await z.search('diffusion');
	assert.equal(items.length, 1);
	assert.deepEqual(items[0], { key: 'ITEM0001', title: 'Diffusion Policy', itemType: 'journalArticle', authors: ['Cheng Chi'], year: '2023', doi: '', arxiv: '2303.04137' });
	assert.match(http.calls[0]!.url, /q=diffusion/);
	const pdf = await z.pdf('ITEM0001');
	assert.deepEqual(pdf, { key: 'PDF00001', title: 'Full Text PDF', linkMode: 'imported_file', stamp: 'abc:123' });
	assert.equal(await z.filePath('PDF00001', 'win32'), 'C:/Users/me/Zotero/storage/PDF00001/Chi et al. - 2023.pdf');
});

test('Zotero collections, with their parents, and a collection\'s items page by page (for the batch)', async () => {
	const many = Array.from({ length: 100 }, (_, i) => ({ key: `I${String(i).padStart(7, '0')}`, data: { itemType: 'journalArticle', title: `Paper ${i}` } }));
	const http = scripted([
		(_r, u) => (u.pathname === '/api/users/0/collections' ? response(200, [
			{ key: 'COLL0001', data: { name: 'Robotics', parentCollection: false } },
			{ key: 'COLL0002', data: { name: 'VLA', parentCollection: 'COLL0001' } },
		]) : undefined),
		(_r, u) => (u.pathname === '/api/users/0/collections/COLL0002/items/top'
			? response(200, u.searchParams.get('start') === '100'
				? [{ key: 'LAST0001', data: { itemType: 'preprint', title: 'Last' } }, { key: 'N0000001', data: { itemType: 'note' } }]
				: many)
			: undefined),
	]);
	const z = new ZoteroClient('http://x', http);
	assert.deepEqual(await z.collections(), [{ key: 'COLL0001', name: 'Robotics' }, { key: 'COLL0002', name: 'Robotics / VLA' }]);
	const items = await z.collectionItems('COLL0002');
	assert.equal(items.length, 101);
	assert.equal(items.at(-1)!.title, 'Last');
});

test('Zotero errors say what to do', async () => {
	const off = new ZoteroClient('http://x', scripted([() => response(403, 'Local API is not enabled')]));
	await assert.rejects(off.check(), (e: Error) => e instanceof SourceError && /Allow other applications/.test(e.message));
	const down = new ZoteroClient('http://x', async () => { throw new Error('ECONNREFUSED'); });
	await assert.rejects(down.search('x'), /Is Zotero running/);
	assert.equal(zoteroItem({ key: 'K', data: { itemType: 'preprint', title: 'T', extra: 'arXiv: 2412.04453' } })?.arxiv, '2412.04453');
});

test('file URLs both ways: page links for PDFs outside the vault', () => {
	assert.equal(fileUrlToPath('file:///home/me/My%20Papers/a.pdf', 'linux'), '/home/me/My Papers/a.pdf');
	assert.equal(fileUrlToPath('file:///G:/My%20Papers/x.pdf', 'win32'), 'G:/My Papers/x.pdf');
	assert.equal(pathToFileUrl('G:\\My Papers\\Reading list\\2023 - A (B) [C].pdf'), 'file:///G:/My%20Papers/Reading%20list/2023%20-%20A%20%28B%29%20%5BC%5D.pdf');
	assert.equal(pathToFileUrl('/home/me/a b.pdf'), 'file:///home/me/a%20b.pdf');
	assert.equal(pathToFileUrl('//server/share/a.pdf'), 'file://server/share/a.pdf');
});

test('PDFs in folders outside the vault, hidden folders skipped', () => {
	const tree: Record<string, { name: string; dir: boolean }[]> = {
		'C:/Lit': [{ name: 'b.pdf', dir: false }, { name: 'sub', dir: true }, { name: '.cache', dir: true }, { name: 'notes.txt', dir: false }],
		'C:/Lit/sub': [{ name: 'A.PDF', dir: false }],
		'C:/Lit/.cache': [{ name: 'hidden.pdf', dir: false }],
	};
	const fs = { readdir: (d: string) => { const e = tree[d]; if (!e) throw new Error('ENOENT'); return e; } };
	assert.deepEqual(listPdfs(['C:\\Lit\\', 'C:/Missing'], fs), ['C:/Lit/b.pdf', 'C:/Lit/sub/A.PDF']);
	assert.equal(listPdfs(['C:/Lit'], fs, 1).length, 1);
});

test('a Zotero search says once, in place of the results, why it found nothing', async () => {
	const { zoteroSuggestions } = await import('../src/sources.ts');
	const down = new ZoteroClient('http://x', async () => { throw new Error('ECONNREFUSED'); });
	const r = await zoteroSuggestions(down, 'softmax');
	assert.deepEqual(r.items, []);
	assert.match(r.empty, /Is Zotero running/);
	assert.deepEqual(await zoteroSuggestions(down, 's'), { items: [], empty: 'Type two letters or more.' });
	const none = new ZoteroClient('http://x', scripted([() => response(200, [])]));
	assert.equal((await zoteroSuggestions(none, 'nothing')).empty, 'No item in Zotero matches.');
});
