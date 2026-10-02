// Upstream LLM calls hit flaky networks and rate-limited backends. Wrap fetch
// with: retry once per attempt on transient transport errors and 429/5xx,
// and surface the undici `cause` (ECONNRESET etc.) in the error message
// instead of the bare "fetch failed".

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const delayMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function describeCause(err) {
  const cause = err?.cause;
  const detail = cause?.code
    ? `${cause.code}: ${cause.message || ""}`.trim()
    : cause?.message || err?.message || "";
  return detail;
}

export async function fetchResilient(url, init = {}, { label = "provider", retries = 2 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, init);
      // Rate limits and backend 5xx are worth one more try.
      if (attempt < retries && (res.status === 429 || res.status >= 500)) {
        res.text().catch(() => {}); // drain to release the socket
        await delayMs(800 * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      // Client disconnects are never retried.
      if (init?.signal?.aborted || err.name === "AbortError" || err.message === "Aborted") throw err;
      const transient = TRANSIENT_CODES.has(err?.cause?.code);
      if (attempt >= retries || !transient) {
        const detail = describeCause(err);
        const wrapped = new Error(`${label} fetch failed${detail ? ` — ${detail}` : ""}`);
        wrapped.cause = err?.cause ?? err;
        throw wrapped;
      }
      await delayMs(800 * (attempt + 1));
    }
  }
}
