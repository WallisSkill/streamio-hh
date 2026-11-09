/**
 * Đổi phụ đề ASS/SSA sang SRT.
 *
 * Stremio chỉ đọc SRT/VTT. Gặp file ASS nguyên bản nó không dựng được cue nào,
 * nên phụ đề hiện ra trống trơn chứ không báo lỗi — khó đoán hơn hẳn trường hợp
 * thẻ {\an8} in ra màn hình, vì nhìn vào không biết là hỏng ở đâu.
 *
 * Chỉ lấy phần [Events]: khung giờ và lời thoại. Toàn bộ [V4+ Styles] (phông,
 * màu, viền, vị trí) bỏ đi vì SRT không có chỗ chứa.
 */
import { cleanSubtitle } from './subtitleText.js';

/** Thứ tự cột chuẩn của ASS v4+, dùng khi file thiếu dòng Format. */
const DEFAULT_FIELDS = [
  'layer',
  'start',
  'end',
  'style',
  'name',
  'marginl',
  'marginr',
  'marginv',
  'effect',
  'text',
];

const SECTION = /^\s*\[[^\]]+\]\s*$/;
const EVENTS = /^\s*\[events\]\s*$/i;

/** File ASS/SSA hay file SRT? Quyết định dựa vào cấu trúc chứ không vào đuôi tệp. */
export function isAss(text) {
  if (!text) return false;
  const head = String(text).slice(0, 4000);
  if (/^\s*\[script info\]/im.test(head)) return true;
  return /^\s*\[events\]/im.test(head) && /^\s*dialogue\s*:/im.test(text);
}

/**
 * `0:01:02.34` -> số mili giây.
 *
 * ASS đếm bằng phần trăm giây (2 chữ số), SRT đếm bằng mili giây (3 chữ số):
 * `.34` là 340ms chứ không phải 34ms. Nên phải đệm về BÊN PHẢI, đệm trái là
 * lệch tiếng gấp mười.
 */
function toMs(value) {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(String(value).trim());
  if (!m) return null;
  const [, h, min, s, frac] = m;
  return (
    Number(h) * 3600000 + Number(min) * 60000 + Number(s) * 1000 + Number((frac + '00').slice(0, 3))
  );
}

/** Số mili giây -> `HH:MM:SS,mmm`. */
function fmt(ms) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(
    Math.floor(ms / 1000) % 60,
  )},${pad(ms % 1000, 3)}`;
}

/**
 * Cắt một dòng Dialogue thành đúng `count` cột.
 *
 * Không dùng split(',') được: cột cuối là lời thoại và lời thoại có dấu phẩy.
 * Cắt đúng count-1 lần rồi vơ hết phần còn lại vào cột cuối.
 */
function splitFields(rest, count) {
  const out = [];
  let from = 0;
  for (let i = 0; i < count - 1; i += 1) {
    const at = rest.indexOf(',', from);
    if (at === -1) return null;
    out.push(rest.slice(from, at));
    from = at + 1;
  }
  out.push(rest.slice(from));
  return out;
}

/**
 * Trả về chuỗi SRT, hoặc chuỗi rỗng nếu không rút được cue nào.
 *
 * Rỗng là có chủ đích: tuyến `/sub.srt` coi đó là tải hỏng và trả 502, nên
 * Stremio báo phụ đề lỗi và người xem chọn bản khác — tốt hơn là giao một file
 * hợp lệ nhưng trống, trông như phụ đề câm.
 */
export function assToSrt(text) {
  if (!text) return '';

  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  let inEvents = false;
  let fields = null;
  const cues = [];

  for (const line of lines) {
    if (SECTION.test(line)) {
      inEvents = EVENTS.test(line);
      continue;
    }
    if (!inEvents) continue;

    const fmtLine = /^\s*Format\s*:(.*)$/i.exec(line);
    if (fmtLine) {
      fields = fmtLine[1].split(',').map((f) => f.trim().toLowerCase());
      continue;
    }

    // Chỉ Dialogue. `Comment:` cùng cấu trúc nhưng là ghi chú của người dịch,
    // không bao giờ được phát.
    const dialogue = /^\s*Dialogue\s*:(.*)$/i.exec(line);
    if (!dialogue) continue;

    const names = fields || DEFAULT_FIELDS;
    const parts = splitFields(dialogue[1], names.length);
    if (!parts) continue;

    const col = (name) => {
      const i = names.indexOf(name);
      return i === -1 ? '' : parts[i];
    };

    const start = toMs(col('start'));
    const end = toMs(col('end'));
    if (start === null || end === null || end <= start) continue;

    const raw = col('text');
    // {\p1} bật chế độ vẽ vector: phần "chữ" đằng sau là toạ độ đường nét, không
    // phải lời thoại. Bỏ thẻ đi sẽ để lại "m 0 0 l 100 0 100 50" giữa màn hình.
    if (/\\p[1-9]/.test(raw)) continue;

    const body = cleanSubtitle(raw);
    if (!body) continue;

    cues.push({ start, end, body });
  }

  cues.sort((a, b) => a.start - b.start || a.end - b.end);

  // SRT không diễn đạt được hai dòng hiện cùng lúc, mà ASS thì dùng chuyện đó
  // suốt (lời thoại + biển hiệu). Trùng khít khung giờ thì gộp làm một cue hai
  // dòng; để riêng thì trình phát nhấp nháy giữa hai cue chồng nhau.
  const merged = [];
  for (const cue of cues) {
    const prev = merged[merged.length - 1];
    if (prev && prev.start === cue.start && prev.end === cue.end) {
      prev.body += `\n${cue.body}`;
    } else {
      merged.push({ ...cue });
    }
  }

  return merged.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.body}\n`).join('\n');
}
