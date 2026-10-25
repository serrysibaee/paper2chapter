import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMultipart } from '../src/multipart.ts';

test('a multipart body carries the file bytes between its boundaries', () => {
	const data = new Uint8Array([37, 80, 68, 70, 0, 255]).buffer;
	const mp = buildMultipart('file', 'my "paper".pdf', data, 'application/pdf', 'XYZ');
	assert.equal(mp.contentType, 'multipart/form-data; boundary=XYZ');
	const bytes = new Uint8Array(mp.body);
	const text = new TextDecoder('latin1').decode(bytes);
	assert.ok(text.startsWith('--XYZ\r\nContent-Disposition: form-data; name="file"; filename="my _paper_.pdf"\r\n'));
	assert.ok(text.includes('Content-Type: application/pdf\r\n\r\n%PDF'));
	assert.ok(text.endsWith('\r\n--XYZ--\r\n'));
	const start = text.indexOf('\r\n\r\n') + 4;
	assert.deepEqual([...bytes.slice(start, start + 6)], [37, 80, 68, 70, 0, 255]);
});

test('each body gets its own boundary', () => {
	const a = buildMultipart('file', 'a.pdf', new ArrayBuffer(1), 'application/pdf');
	const b = buildMultipart('file', 'a.pdf', new ArrayBuffer(1), 'application/pdf');
	assert.notEqual(a.contentType, b.contentType);
});
