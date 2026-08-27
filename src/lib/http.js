import { CONFIG } from '../config.js';
import { cached } from './cache.js';

async function raw(url, { timeout = CONFIG.httpTimeout, referer, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': CONFIG.userAgent,
        'accept-language': 'vi,en;q=0.8',
        ...(referer ? { referer } : {}),
        ...headers,
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(fn, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function getJson(url, opts = {}) {
  return cached(`json:${url}`, () =>
    withRetry(async () => {
      const res = await raw(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res.json();
    }),
  );
}

export async function getText(url, opts = {}) {
  const fetchIt = () =>
    withRetry(async () => {
      const res = await raw(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return { body: await res.text(), finalUrl: res.url };
    });
  // Player pages hand out short-lived tokens, so `fresh` keeps them out of the
  // 30-minute cache: a resolved track is never older than its own lifetime.
  return opts.fresh ? fetchIt() : cached(`text:${url}`, fetchIt);
}

/**
 * Diagnostic fetch: never throws, never caches, and reports the FULL outcome —
 * status, timing, a body snippet, and the Cloudflare ray id. Used by the /probe
 * route so a request made from the deployment's own IP shows exactly which
 * endpoint is blocked and with what response.
 */
export async function probe(url, { timeout = 12000, headers = {}, method = 'GET' } = {}) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': CONFIG.userAgent,
        accept: 'application/json,text/html,*/*',
        'accept-language': 'vi,en;q=0.8',
        ...headers,
      },
    });
    const body = await res.text();
    return {
      url,
      status: res.status,
      ok: res.ok,
      ms: Date.now() - started,
      bytes: body.length,
      server: res.headers.get('server') || null,
      cfRay: res.headers.get('cf-ray') || null,
      cfMitigated: res.headers.get('cf-mitigated') || null,
      contentType: res.headers.get('content-type') || null,
      snippet: body.slice(0, 300),
    };
  } catch (err) {
    return { url, status: null, ok: false, ms: Date.now() - started, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Never throws — returns null on any failure. Used so one dead source cannot break a response. */
export async function safe(promise, label) {
  try {
    return await promise;
  } catch (err) {
    console.warn(`[${label}] ${err.message}`);
    return null;
  }
}
