/**
 * Truyền hình từ danh sách M3U do người cài tự nhập ở /configure.
 *
 * Addon không mang sẵn link kênh nào: danh sách là của người dùng, addon chỉ
 * đọc nó rồi trả về theo kiểu Stremio hiểu — một catalog loại `tv`, mỗi kênh
 * một meta, mỗi link một stream. Kênh trùng tên (danh sách VN hay có vài link
 * dự phòng cho cùng một kênh) gộp thành MỘT ô, các link thành các nguồn.
 */
import { CONFIG } from '../config.js';
import { cached } from './cache.js';
import { normalize } from './text.js';

export const IPTV_TYPE = 'tv';
export const IPTV_CATALOG = 'wis-iptv';
export const IPTV_PREFIX = 'iptv:';
const PAGE = 100;
const MAX_LISTS = 5;

/** Chuỗi người dùng gõ -> danh sách link http(s), bỏ trùng, tối đa 5. */
export function playlistUrls(text) {
  const out = [];
  for (const part of String(text || '').split(/[\s,]+/)) {
    if (!part) continue;
    let u;
    try { u = new URL(part); } catch { continue; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    if (!out.includes(u.href)) out.push(u.href);
    if (out.length >= MAX_LISTS) break;
  }
  return out;
}

/**
 * Link do người lạ gõ vào mà addon tự đi lấy: chặn địa chỉ nội bộ, kẻo ai đó
 * dùng addon dò mạng trong của máy đang chạy nó. Chạy thử ở nhà thì bật
 * IPTV_ALLOW_PRIVATE=1.
 */
export function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::' || h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h.replace(/^::ffff:/, ''));
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function attrs(text) {
  const out = {};
  for (const m of text.matchAll(/([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g)) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}

/** Tên kênh là phần sau dấu phẩy đầu tiên nằm NGOÀI cặp ngoặc kép. */
function splitInfo(info) {
  let quoted = false;
  for (let i = 0; i < info.length; i += 1) {
    if (info[i] === '"') quoted = !quoted;
    else if (info[i] === ',' && !quoted) return [info.slice(0, i), info.slice(i + 1).trim()];
  }
  return [info, ''];
}

const HEADER_NAMES = { 'user-agent': 'User-Agent', referer: 'Referer', referrer: 'Referer', origin: 'Origin', cookie: 'Cookie' };

function addHeader(headers, name, value) {
  const key = HEADER_NAMES[String(name).trim().toLowerCase()];
  const v = String(value ?? '').trim();
  if (key && v) headers[key] = v;
}

/**
 * Đọc một file M3U/M3U8 kiểu IPTV. Hiểu các dòng hay gặp: #EXTINF (tvg-id,
 * tvg-logo, group-title), #EXTGRP, #EXTVLCOPT http-user-agent/http-referrer,
 * #EXTHTTP {json} và đuôi `|User-Agent=..&Referer=..` kiểu Kodi. Kênh có DRM
 * (#KODIPROP license) thì bỏ, vì không trình phát nào ở đây mở được.
 */
export function parseM3U(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const out = [];
  let cur = null;
  const fresh = () => ({ name: '', logo: '', group: '', tvgId: '', headers: {}, drm: false });
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const tag = line.slice(1, line.indexOf(':') > 0 ? line.indexOf(':') : undefined).toUpperCase();
      const value = line.indexOf(':') > 0 ? line.slice(line.indexOf(':') + 1) : '';
      if (tag === 'EXTINF') {
        if (!cur || cur.info) cur = fresh();
        cur.info = true;
        const [head, name] = splitInfo(value);
        const a = attrs(head);
        cur.name = name || a['tvg-name'] || '';
        cur.logo = a['tvg-logo'] || '';
        cur.group = a['group-title'] || cur.group;
        cur.tvgId = a['tvg-id'] || '';
      } else if (tag === 'EXTGRP') {
        cur ??= fresh();
        if (!cur.group) cur.group = value.trim();
      } else if (tag === 'EXTVLCOPT') {
        cur ??= fresh();
        const m = /^http-(user-agent|referrer|referer|origin)\s*=\s*(.*)$/i.exec(value.trim());
        if (m) addHeader(cur.headers, m[1], m[2]);
      } else if (tag === 'EXTHTTP') {
        cur ??= fresh();
        try {
          const obj = JSON.parse(value);
          for (const [k, v] of Object.entries(obj || {})) addHeader(cur.headers, k, v);
        } catch {}
      } else if (tag === 'KODIPROP') {
        cur ??= fresh();
        if (/license_(key|type)/i.test(value)) cur.drm = true;
      }
      continue;
    }
    const entry = cur || fresh();
    cur = null;
    let url = line;
    const pipe = url.indexOf('|');
    if (pipe > 0) {
      for (const pair of url.slice(pipe + 1).split('&')) {
        const eq = pair.indexOf('=');
        if (eq > 0) {
          let v = pair.slice(eq + 1);
          try { v = decodeURIComponent(v); } catch {}
          addHeader(entry.headers, pair.slice(0, eq), v);
        }
      }
      url = url.slice(0, pipe);
    }
    if (!/^(https?|rtmps?|rtsp|udp|rtp):\/\//i.test(url) || entry.drm) continue;
    const name = entry.name.trim() || url.split('/').pop() || url;
    out.push({ name, logo: entry.logo, group: entry.group.trim(), tvgId: entry.tvgId, url, headers: entry.headers });
  }
  return out;
}

const keyOf = (ch) => normalize(ch.name) || ch.url;

/** Gộp các link cùng tên thành một kênh, giữ thứ tự xuất hiện. */
export function groupChannels(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = keyOf(e);
    let ch = map.get(key);
    if (!ch) {
      ch = { id: IPTV_PREFIX + hash(key), name: e.name, logo: '', group: '', tvgId: '', sources: [] };
      map.set(key, ch);
    }
    if (!ch.logo && e.logo) ch.logo = e.logo;
    if (!ch.group && e.group) ch.group = e.group;
    if (!ch.tvgId && e.tvgId) ch.tvgId = e.tvgId;
    if (!ch.sources.some((s) => s.url === e.url)) ch.sources.push({ url: e.url, headers: e.headers, group: e.group, list: e.list });
  }
  return [...map.values()];
}

async function fetchPlaylist(url) {
  const u = new URL(url);
  if (!CONFIG.iptvAllowPrivate && isPrivateHost(u.hostname)) throw new Error(`địa chỉ nội bộ bị chặn: ${u.hostname}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.httpTimeout);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': CONFIG.userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status} cho ${u.host}`);
    if (!CONFIG.iptvAllowPrivate && res.url && isPrivateHost(new URL(res.url).hostname)) {
      throw new Error('danh sách chuyển hướng vào địa chỉ nội bộ');
    }
    const len = Number(res.headers.get('content-length'));
    if (len > CONFIG.iptvMaxBytes) throw new Error('danh sách quá lớn');
    const text = await res.text();
    if (text.length > CONFIG.iptvMaxBytes) throw new Error('danh sách quá lớn');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mọi kênh từ các danh sách của một bản cài. Danh sách nào lỗi thì bỏ qua và
 * ghi vào `errors`, các danh sách còn lại vẫn chạy.
 */
export async function loadChannels(urls) {
  const lists = await Promise.all(
    urls.map((url, i) =>
      cached(`iptv:${url}`, async () => parseM3U(await fetchPlaylist(url)).map((e) => ({ ...e, list: i })), CONFIG.iptvTtl)
        .then((entries) => ({ entries }))
        .catch((err) => ({ entries: [], error: `${url}: ${err?.message || err}` })),
    ),
  );
  const channels = groupChannels(lists.flatMap((l) => l.entries)).slice(0, CONFIG.iptvMaxChannels);
  return { channels, errors: lists.map((l) => l.error).filter(Boolean) };
}

export const OTHER_GROUP = 'Khác';
const groupOf = (ch) => ch.group || OTHER_GROUP;

export function groupsOf(channels) {
  return [...new Set(channels.map(groupOf))];
}

function preview(ch) {
  return {
    id: ch.id,
    type: IPTV_TYPE,
    name: ch.name,
    poster: ch.logo || undefined,
    posterShape: 'square',
    logo: ch.logo || undefined,
    genres: [groupOf(ch)],
  };
}

/** Một trang catalog, lọc theo nhóm (`genre`) và tên (`search`). */
export function catalogPage(channels, extra = {}) {
  let list = channels;
  if (extra.genre) list = list.filter((ch) => groupOf(ch) === extra.genre);
  if (extra.search) {
    const q = normalize(extra.search);
    list = q ? list.filter((ch) => normalize(ch.name).includes(q)) : [];
  }
  const skip = Math.max(0, Number(extra.skip) || 0);
  return list.slice(skip, skip + PAGE).map(preview);
}

export function channelMeta(ch) {
  const n = ch.sources.length;
  return {
    ...preview(ch),
    background: undefined,
    description: `${groupOf(ch)} · ${n} nguồn phát`,
    behaviorHints: { defaultVideoId: ch.id },
  };
}

export function channelStreams(ch) {
  return ch.sources.map((s, i) => {
    const hasHeaders = Object.keys(s.headers || {}).length > 0;
    const plain = /^https?:/i.test(s.url);
    let host = '';
    try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch {}
    return {
      name: `Nguồn ${i + 1}`,
      title: [s.group, host].filter(Boolean).join(' · '),
      url: s.url,
      behaviorHints: {
        notWebReady: hasHeaders || !plain || undefined,
        ...(hasHeaders ? { proxyHeaders: { request: s.headers } } : {}),
        bingeGroup: `wis-iptv-${i}`,
      },
    };
  });
}

/** Đoạn `extra` của tuyến Stremio: `genre=Tin%20t%E1%BB%A9c&skip=100`. */
export function parseExtra(text) {
  const out = {};
  for (const pair of String(text || '').split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    try { out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1)); } catch {}
  }
  return out;
}
