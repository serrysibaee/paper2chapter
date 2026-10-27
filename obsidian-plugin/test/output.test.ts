import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quietDelay, resolveFolder, resolveName } from '../src/output.ts';
import { buildTokens, familyName, fill, slug, tokenNames, unknownTokens } from '../src/tokens.ts';
import {
	checkFolders, checkFolderTemplate, checkNameTemplate, checkPageLinkTemplate, checkQuietHours, checkRows, checkSectionHeading,
	checkTemplateText, checkUrl, usablePageLink,
} from '../src/validate.ts';

const fd = (f: string) => (f === 'YYYY' ? '2026' : `<${f}>`);
const t = buildTokens({ paperTitle: 'Diffusion Policy: Visuomotor Learning', authors: ['Cheng Chi', 'Ben Burchfiel'], year: '2023',
	paperNote: { linktext: 'Diffusion policy', folder: 'Reading/Papers/Robot Learning' } });

test('tokens: filled, several values joined, unknown names kept, slugs and family names', () => {
	assert.equal(fill('{{firstAuthor}} {{year}} - {{paperTitle}}', t, fd), 'Chi 2023 - Diffusion Policy: Visuomotor Learning');
	assert.equal(fill('{{authors}}', t, fd), 'Cheng Chi, Ben Burchfiel');
	assert.equal(fill('{{doi}}|{{nope}}|{{date:YYYY}}', t, fd), '|{{nope}}|2026');
	assert.equal(slug('Diffusion Policy: Visuomotor Learning!'), 'diffusion-policy-visuomotor-learning');
	assert.equal(familyName('Chi, Cheng'), 'Chi');
	assert.deepEqual(unknownTokens('{{paperTitle}} {{titel}} {{date:YYYY}} {{#doi}}{{/doi}}'), ['titel']);
});

test('folders and names from their templates, made safe', () => {
	assert.equal(resolveFolder('Paper chapters', t, fd), 'Paper chapters');
	assert.equal(resolveFolder('{{paperNoteFolder}}/Chapters/', t, fd), 'Reading/Papers/Robot Learning/Chapters');
	assert.equal(resolveFolder('Chapters/{{year}}/{{doi}}', t, fd), 'Chapters/2023');
	assert.equal(resolveFolder('A: B?/c', t, fd), 'A B/c');
	assert.equal(resolveName('{{paperTitle}}', t, fd, 'x'), 'Diffusion Policy Visuomotor Learning');
	assert.equal(resolveName('{{paperNote}} - Chapter', t, fd, 'x'), 'Diffusion policy - Chapter');
	assert.equal(resolveName('{{doi}}', t, fd, 'From the PDF'), 'From the PDF');
});

test('a fallback fills the first of its tokens that has a value', () => {
	const noNote = buildTokens({ paperTitle: 'Diffusion Policy: Visuomotor Learning', authors: ['Cheng Chi'], doi: '' });
	assert.equal(fill('{{paperNote|paperTitle}} - Chapter', t, fd), 'Diffusion policy - Chapter');
	assert.equal(fill('{{paperNote|paperTitle}} - Chapter', noNote, fd), 'Diffusion Policy: Visuomotor Learning - Chapter');
	assert.equal(fill('{{doi|arxiv}}x', noNote, fd), 'x');
	assert.equal(fill('{{doi|authors}}', t, fd), 'Cheng Chi, Ben Burchfiel');
	assert.equal(fill('{{nope|year}}', t, fd), '2023', 'a name that is no token is passed over');
	assert.deepEqual(unknownTokens('{{paperNote|nope}} {{a|b}}'), ['nope', 'a', 'b']);
	assert.equal(resolveName('{{paperNote|paperTitle}} - Chapter', noNote, fd, 'x'), 'Diffusion Policy Visuomotor Learning - Chapter');
	assert.equal(checkNameTemplate('{{paperNote|paperTitle}} - Chapter'), '');
	assert.match(checkNameTemplate('{{paperNote|papr}}'), /papr/);
	assert.deepEqual(tokenNames('{{a|b}} {{#c}}{{/c}} {{date:YYYY}} {{.}} {{d}}'), ['a', 'b', 'c', 'date', 'd']);
});

test('pages: 1–N from the page count, and the count; empty when unknown', () => {
	const withCount = buildTokens({ paperTitle: 'P', pageCount: 12 });
	assert.equal(withCount.pages, '1–12');
	assert.equal(withCount.pageCount, '12');
	assert.equal(fill('{{pages}} / {{pageCount}}', buildTokens({ paperTitle: 'P' }), fd), ' / ');
	assert.equal(buildTokens({ paperTitle: 'P', pageCount: 1 }).pages, '1');
	assert.equal(checkNameTemplate('{{paperTitle}} ({{pageCount}} pages)'), '');
});

test('quiet hours: inside them a note waits until they end, across midnight too', () => {
	const at = (h: number, m: number) => new Date(2026, 9, 26, h, m, 0, 0);
	assert.equal(quietDelay(at(12, 0), ''), 0);
	assert.equal(quietDelay(at(12, 0), '23:55-04:30'), 0);
	assert.equal(quietDelay(at(23, 58), '23:55-04:30'), (2 + 4 * 60 + 30) * 60_000);
	assert.equal(quietDelay(at(3, 0), '23:55-04:30'), 90 * 60_000);
	assert.equal(quietDelay(at(13, 15), '13:00-14:00'), 45 * 60_000);
	assert.equal(quietDelay(at(14, 0), '13:00-14:00'), 0);
	assert.equal(quietDelay(at(3, 0), 'nonsense'), 0);
});

test('validation says what is wrong, in one sentence', () => {
	assert.equal(checkFolderTemplate('{{paperNoteFolder}}/Chapters'), '');
	assert.match(checkFolderTemplate('{{yaer}}'), /\{\{yaer\}\}/);
	assert.match(checkFolderTemplate('../outside'), /above the vault/);
	assert.match(checkNameTemplate(' '), /needs a name/);
	assert.equal(checkSectionHeading('1.{{n}} {{title}}{{#page}} — p. {{page}}{{/page}}'), '');
	assert.equal(checkPageLinkTemplate('zotero://open-pdf/library/items/{{zoteroPdfKey}}?page={page}'), '');
	assert.match(checkPageLinkTemplate('zotero://x'), /\{page\}/);
	assert.match(checkPageLinkTemplate('javascript:alert({page})'), /zotero:\/\//);
	assert.match(checkPageLinkTemplate('file:///C:/My Papers/a.pdf#page={page}'), /percent-encoded/);
	assert.equal(usablePageLink('file:///C:/a%20b.pdf#page={page}'), 'file:///C:/a%20b.pdf#page={page}');
	assert.equal(usablePageLink('file:///C:/a b.pdf#page={page}'), '');
	assert.equal(checkQuietHours('23:55-04:30'), '');
	assert.match(checkQuietHours('late'), /two times/);
	assert.equal(checkFolders('C:\\Literature\n/home/me/papers\n\\\\server\\share'), '');
	assert.match(checkFolders('relative/path'), /absolute/);
	assert.equal(checkUrl('http://127.0.0.1:23119'), '');
	assert.match(checkRows([{ key: 'title', value: 'x', type: 'text' }, { key: 'title', value: 'y', type: 'text' }]), /twice/);
	assert.match(checkRows([{ key: 'a:b', value: 'x', type: 'text' }]), /property name/);
	assert.match(checkRows([{ key: 'up', value: '{{paperNot}}', type: 'link' }]), /paperNot/);
	assert.match(checkTemplateText('{{#summary}}'), /Not closed/);
});
