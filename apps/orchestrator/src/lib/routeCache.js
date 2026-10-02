// Routing decisions are pure functions of the user's latest prompt, so
// identical prompts within a short window reuse the cached decision instead of
// paying another round-trip to the decision model every turn.
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 500;

const cache = new Map(); // key -> { route, at }

export function cacheKeyFor(userText) {
  const text = String(userText || "").trim().toLowerCase();
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `${Math.abs(hash)}:${text.length}`;
}

export function getCachedRoute(userText) {
  const key = cacheKeyFor(userText);
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  hit.at = Date.now();
  return hit.route;
}

export function setCachedRoute(userText, route) {
  if (!userText || !route) return;
  const key = cacheKeyFor(userText);
  if (cache.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.at > TTL_MS) cache.delete(k);
    }
    if (cache.size >= MAX_ENTRIES) cache.clear();
  }
  cache.set(key, { route, at: Date.now() });
}

/** Clears the route cache — used when a decision backend changes or for tests. */
export function clearRouteCache() {
  cache.clear();
}
