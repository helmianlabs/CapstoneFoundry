// Private JSON blobs for task and alarm content.
//
// @vercel/blob 2.3 supports access: 'private' on the existing store.
// The same BLOB_READ_WRITE_TOKEN lists and reads them. A private blob
// URL is not anonymously readable, so callers must use get() and must
// not fetch() the URL. There is no fallback to access: 'public'.
// Historical public blobs are not rewritten or deleted here.

import { get, put } from '@vercel/blob';

export async function putPrivateJson(pathname, value, { allowOverwrite = false } = {}) {
  await put(pathname, JSON.stringify(value), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite,
  });
}

export async function readPrivateJson(pathname) {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  let text = '';
  try {
    text = await new Response(result.stream).text();
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
