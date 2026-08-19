import { readFileSync, watchFile } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'overrides.json');
let data = {};

function load() {
  try {
    data = JSON.parse(readFileSync(FILE, 'utf8'));
    console.log(`[overrides] loaded ${Object.keys(data).filter((k) => !k.startsWith('_')).length} entries`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[overrides] ${err.message}`);
    data = {};
  }
}
load();
// Hot reload only makes sense on a long-lived server; serverless reads once per cold start.
if (!process.env.VERCEL) {
  try {
    const w = watchFile(FILE, { interval: 5000 }, load);
    w.unref?.();
  } catch {}
}

/** Manual pin for a show id, optionally for one season. */
export function getOverride(id, season) {
  const entry = data[id];
  if (!entry) return null;
  const perSeason = season != null ? entry.seasons?.[String(season)] : null;
  return {
    titles: entry.titles || [],
    kkphim: perSeason?.kkphim || entry.kkphim || null,
    hh3d: perSeason?.hh3d || entry.hh3d || null,
    mode: perSeason?.mode || entry.mode || null,
    offset: Number(perSeason?.offset ?? entry.offset ?? 0),
  };
}
