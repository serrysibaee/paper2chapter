/*
 * A multipart/form-data body with one file field, built by hand: Obsidian's `requestUrl` takes a string or an
 * ArrayBuffer body, not a FormData.
 */

export interface MultipartBody {
	body: ArrayBuffer;
	contentType: string;
}

export function buildMultipart(field: string, filename: string, data: ArrayBuffer, mime: string, boundary?: string): MultipartBody {
	const b = boundary ?? '----paper2chapter' + Math.random().toString(16).slice(2) + Date.now().toString(16);
	const safeName = filename.replace(/[\r\n"]/g, '_');
	const head = new TextEncoder().encode(
		`--${b}\r\nContent-Disposition: form-data; name="${field}"; filename="${safeName}"\r\nContent-Type: ${mime}\r\n\r\n`,
	);
	const tail = new TextEncoder().encode(`\r\n--${b}--\r\n`);
	const out = new Uint8Array(head.length + data.byteLength + tail.length);
	out.set(head, 0);
	out.set(new Uint8Array(data), head.length);
	out.set(tail, head.length + data.byteLength);
	return { body: out.buffer, contentType: `multipart/form-data; boundary=${b}` };
}
