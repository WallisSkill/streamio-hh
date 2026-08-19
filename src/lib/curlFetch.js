import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG } from '../config.js';

const run = promisify(execFile);

/**
 * Fetch a public page through curl.
 *
 * HH3D answers 403 to Node's fetch but 200 to curl — the filter is on the HTTP
 * client, not on the content, and curl identifies honestly as curl. This reads
 * only public listing pages (search results, show pages). It never touches the
 * keyed player endpoint, which is a real access control and stays untouched.
 */
export async function curlGet(url, { timeout = 20 } = {}) {
  const args = [
    '-s',
    '-L',
    '--max-time',
    String(timeout),
    '-A',
    CONFIG.userAgent,
    '-H',
    'accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '-H',
    'accept-language: vi-VN,vi;q=0.9,en;q=0.8',
    '-w',
    '\n__CURL_META__%{http_code}|%{url_effective}',
    url,
  ];
  const { stdout } = await run('curl', args, { maxBuffer: 20 * 1024 * 1024, timeout: (timeout + 5) * 1000 });
  const at = stdout.lastIndexOf('\n__CURL_META__');
  if (at === -1) throw new Error('curl: no metadata in response');
  const [code, finalUrl] = stdout.slice(at + 14).split('|');
  if (Number(code) >= 400) throw new Error(`HTTP ${code} for ${url}`);
  return { body: stdout.slice(0, at), finalUrl: finalUrl || url };
}

let available = null;
/** Probe once whether curl exists on this machine. */
export async function curlAvailable() {
  if (available !== null) return available;
  try {
    await run('curl', ['--version'], { timeout: 5000 });
    available = true;
  } catch {
    available = false;
    console.warn('[hh3d] curl không có sẵn — bỏ qua tự dò hh3d, chỉ dùng overrides.json');
  }
  return available;
}
