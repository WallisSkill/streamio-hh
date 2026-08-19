import { CONFIG } from '../config.js';

const store = new Map();

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

export function cacheSet(key, value, ttl = CONFIG.cacheTtl) {
  // cheap bound: drop oldest when large
  if (store.size > 2000) {
    for (const k of [...store.keys()].slice(0, 500)) store.delete(k);
  }
  store.set(key, { value, expires: Date.now() + ttl });
  return value;
}

/** Run fn once per key within TTL; concurrent callers share the same promise. */
const inflight = new Map();
export async function cached(key, fn, ttl) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const value = await fn();
      cacheSet(key, value, ttl);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
