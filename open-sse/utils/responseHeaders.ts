const REBUILT_BODY_FORBIDDEN_RESPONSE_HEADERS = new Set(
  [
    "connection",
    "content-encoding",
    "content-length",
    "keep-alive",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ].map((name) => name.toLowerCase())
);

/**
 * Copy provider response headers for a response whose body is being rebuilt.
 * Framing and hop-by-hop headers describe the original upstream byte stream;
 * keeping them after JSON normalization or stream transforms can truncate
 * clients or corrupt keep-alive connections.
 */
export function cloneResponseHeadersForRebuiltBody(
  headers: Headers | Record<string, unknown> | null | undefined
): Headers {
  const next = new Headers();
  if (!headers) return next;

  const entries =
    headers instanceof Headers
      ? Array.from(headers.entries())
      : Object.entries(headers).map(([key, value]) => [key, value] as const);

  for (const [key, value] of entries) {
    if (!key || REBUILT_BODY_FORBIDDEN_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    if (value === undefined || value === null) continue;
    next.set(key, String(value));
  }

  return next;
}
