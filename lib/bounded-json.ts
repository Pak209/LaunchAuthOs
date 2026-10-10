export class RequestBodyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function readBoundedJson(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError(400, "Missing request body.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw new RequestBodyError(413, "Request body is too large."); }
    chunks.push(value);
  }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); }
  catch { throw new RequestBodyError(400, "Invalid JSON request."); }
}
