export function assertLocalRequest(request: Request, mutation = false): void {
  const host = request.headers.get("host");
  // Next.js may normalize request.url to localhost; validate the actual Host instead.
  if (!host || !/^(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/.test(host))
    throw new Error("Forbidden origin");
  const expectedPort = process.env.PORT || "3000";
  if (new URL(`http://${host}`).port !== expectedPort)
    throw new Error("Forbidden origin");
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== `http://${host}`) ||
    (mutation && origin !== `http://${host}`) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new Error("Forbidden origin");
}
export async function smallJson(
  request: Request,
  limit = 16000,
): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("JSON required");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Body required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error("Body too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
