import { CONFIG } from '../config.js';
import { safe } from '../lib/http.js';
import { curlGet, curlAvailable } from '../lib/curlFetch.js';
import { cached } from '../lib/cache.js';
import { detectSeason, decodeEntities } from '../lib/text.js';

/**
 * HH3D integration is deliberately limited to the site's public pages:
 * search results, the show page, and the episode permalink.
 *
 * The stream URL itself is NOT read. HH3D keeps it out of the HTML and behind a
 * keyed endpoint (/wp-json/halim/v1/player-key requires a key_id), i.e. an access
 * control the operator put there on purpose. This addon does not defeat it —
 * HH3D results are returned as external links that open the episode page.
 */

const RX_ARTICLE = /<article[^>]*class="[^"]*grid-item[^"]*"[\s\S]*?(?=<article|<\/main|$)/g;
const RX_THUMB = /<a[^>]*class="halim-thumb"[^>]*href="([^"]+)"[^>]*title="([^"]*)"/;
const RX_ENTRY = /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]*)/;
const RX_ORIG = /<p[^>]*class="[^"]*original_title[^"]*"[^>]*>([^<]*)/;
const RX_EPISODE_LINK = /href="(https?:[/][/][^"]*[/]xem-phim-[^"]+[/]tap-([0-9]+)-sv([0-9]+)[.]html)"/g;
const RX_SHOW_URL = /^https?:[/][/][^/]+[/][a-z0-9-]+[/]?$/i;

/**
 * HH3D throttles bursts with 403s, so page reads are serialised with a gap
 * and cached. Only public listing pages are read here.
 */
const MIN_GAP_MS = 1500;
let chain = Promise.resolve();
let lastAt = 0;

function fetchPage(url) {
  const run = async () => {
    if (!(await curlAvailable())) throw new Error('curl không có sẵn');
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      return await curlGet(url);
    } finally {
      lastAt = Date.now();
    }
  };
  chain = chain.then(run, run);
  return chain;
}

/** Search hh3d. Note: a single strong match makes WordPress redirect to the show page. */
export async function search(keyword) {
  if (!keyword || !CONFIG.enableHh3d) return [];
  const url = `${CONFIG.hh3dBase}/?s=${encodeURIComponent(keyword)}`;
  const res = await safe(fetchPage(url), 'hh3d-search');
  if (!res) return [];
  const { body, finalUrl } = res;

  const out = [];
  for (const block of body.match(RX_ARTICLE) || []) {
    const thumb = RX_THUMB.exec(block);
    if (!thumb) continue;
    const link = thumb[1];
    if (!RX_SHOW_URL.test(link)) continue;
    const name = decodeEntities(RX_ENTRY.exec(block)?.[1] || thumb[2]);
    const origRaw = decodeEntities(RX_ORIG.exec(block)?.[1] || '');
    const yearMatch = /\((\d{4})\)/.exec(origRaw);
    const originName = origRaw.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    out.push(toCandidate({ link, name, originName, year: yearMatch ? Number(yearMatch[1]) : null }));
  }

  // search collapsed straight to a show page
  if (!out.length && finalUrl && !/[?&]s=|\/search\//.test(finalUrl) && RX_SHOW_URL.test(finalUrl)) {
    const name = decodeEntities(/<title>([^<]*)<\/title>/.exec(body)?.[1] || '')
      .replace(/\s*[|\u2013-]\s*HH3D.*$/i, '')
      .replace(/\s*T\u1eadp\s*\d+.*$/i, '')
      .trim();
    if (name) out.push(toCandidate({ link: finalUrl, name, originName: '', year: null }));
  }
  return out;
}

function toCandidate({ link, name, originName, year }) {
  const slug = new URL(link).pathname.replace(/^\/+|\/+$/g, '');
  return {
    source: 'hh3d',
    slug,
    url: link.replace(/\/+$/, ''),
    name,
    originName,
    altNames: [],
    year,
    type: 'hoathinh',
    imdbId: null,
    tmdbId: null,
    season: detectSeason(name, originName),
  };
}

/** Read the show page and collect which episodes exist. */
export async function detail(slug) {
  if (!slug || !CONFIG.enableHh3d) return null;
  return cached(`hh3d:detail:${slug}`, async () => {
    const res = await safe(fetchPage(`${CONFIG.hh3dBase}/${slug}`), 'hh3d-detail');
    if (!res) return null;
    const { body } = res;

    const byNum = new Map();
    RX_EPISODE_LINK.lastIndex = 0;
    let m;
    while ((m = RX_EPISODE_LINK.exec(body))) {
      const num = Number(m[2]);
      if (!byNum.has(num)) {
        byNum.set(num, { label: `Tập ${num}`, num, isSpecial: false, isFull: false, page: m[1] });
      }
    }
    if (!byNum.size) return null;

    const name = decodeEntities(/<h1[^>]*>([^<]*)/.exec(body)?.[1] || slug);
    const episodes = [...byNum.values()].sort((a, b) => a.num - b.num);
    return {
      source: 'hh3d',
      slug,
      url: `${CONFIG.hh3dBase}/${slug}`,
      name,
      originName: decodeEntities(RX_ORIG.exec(body)?.[1] || ''),
      altNames: [],
      year: null,
      type: 'hoathinh',
      imdbId: null,
      tmdbId: null,
      season: detectSeason(name),
      servers: [{ name: 'HH3D', episodes }],
      maxEpisode: Math.max(...episodes.map((e) => e.num)),
    };
  });
}
