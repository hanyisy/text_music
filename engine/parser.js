// 악보 텍스트 → 음 이벤트 목록.
// 1) tokenize: DESIGN.md 표기 규칙 전체를 토큰으로 나눈다.
// 2) parse: 토큰을 시간 순 이벤트로 바꾼다. 아직 구현하지 않은 토큰은 건너뛴다.
// 새 표기를 구현할 때는 parse의 switch에 해당 토큰 처리만 추가하면 된다.

import { charToJamo, isHangul } from './hangul.js';
import { jamoToSound } from './keymap.js';

export const DEFAULT_TEMPO = 120;
const TEMPO_MIN = 20;
const TEMPO_MAX = 400;

export const TOKEN = Object.freeze({
  GLYPH: 'glyph',               // 한글 한 글자(완성형 또는 낱자모) = 한 박
  REST: 'rest',                 // ,
  TIE: 'tie',                   // - —
  BAR: 'bar',                   // |
  REPEAT_START: 'repeatStart',  // |:
  REPEAT_END: 'repeatEnd',      // :|
  META: 'meta',                 // {…}
  OCTAVE: 'octave',             // 0, 1~3, 11~33
  RESERVED_DIGIT: 'reservedDigit', // 4~9 (비워둔 숫자)
  INSTRUMENT: 'instrument',     // ! @ # $ %
  DYNAMIC: 'dynamic',           // ^1 ~ ^3
  CHORD_START: 'chordStart',    // [
  CHORD_END: 'chordEnd',        // ]
  LYRIC: 'lyric',               // ; 로 시작하는 줄
  SPACE: 'space',
  NEWLINE: 'newline',
  UNKNOWN: 'unknown',
});

const INSTRUMENT_KEYS = '!@#$%';

/**
 * 메타 칸 내용 판정. 순서는 DESIGN.md "메타 칸 판정 순서" 그대로.
 */
export function classifyMeta(body) {
  let m;
  if (/^\d+$/.test(body)) return { kind: 'tempo', tempo: Number(body) };
  if ((m = /^(\d+):(\d+)$/.exec(body))) return { kind: 'tempoUnit', tempo: Number(m[1]), unit: Number(m[2]) };
  if ((m = /^(\d+)\/(\d+)$/.exec(body))) return { kind: 'timeSignature', beats: Number(m[1]), unit: Number(m[2]) };
  if (body.startsWith('트랙')) return { kind: 'track', body };
  return { kind: 'title', title: body };
}

/**
 * @param {string} text
 * @returns {Array<{ type: string, start: number, end: number }>}
 *          start/end는 원문에서의 위치(end는 제외). 종류에 따라 추가 필드가 붙는다.
 */
export function tokenize(text) {
  const tokens = [];
  const push = (type, start, end, extra) => tokens.push({ type, start, end, ...extra });
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    const lineStart = i === 0 || text[i - 1] === '\n';

    if (ch === '\n') {
      push(TOKEN.NEWLINE, i, ++i);
    } else if (ch === ' ' || ch === '\t' || ch === '\r') {
      push(TOKEN.SPACE, i, ++i);
    } else if (ch === ';' && lineStart) {
      let end = text.indexOf('\n', i);
      if (end === -1) end = text.length;
      push(TOKEN.LYRIC, i, end, { body: text.slice(i + 1, end) });
      i = end;
    } else if (isHangul(ch)) {
      push(TOKEN.GLYPH, i, ++i, { jamo: charToJamo(ch) });
    } else if (ch === ',') {
      push(TOKEN.REST, i, ++i);
    } else if (ch === '-' || ch === '—') {
      push(TOKEN.TIE, i, ++i);
    } else if (ch === '|' && next === ':') {
      push(TOKEN.REPEAT_START, i, (i += 2));
    } else if (ch === ':' && next === '|') {
      push(TOKEN.REPEAT_END, i, (i += 2));
    } else if (ch === '|') {
      push(TOKEN.BAR, i, ++i);
    } else if (ch === '{') {
      const close = text.indexOf('}', i);
      const lineEnd = text.indexOf('\n', i);
      if (close === -1 || (lineEnd !== -1 && lineEnd < close)) {
        // 아직 닫지 않은 메타 칸: 줄 끝까지 메타로 본다(제목을 치는 동안 소리가 나지 않게).
        const end = lineEnd === -1 ? text.length : lineEnd;
        push(TOKEN.META, i, end, { meta: { kind: 'open' } });
        i = end;
      } else {
        push(TOKEN.META, i, close + 1, { meta: classifyMeta(text.slice(i + 1, close)) });
        i = close + 1;
      }
    } else if (ch === '0') {
      push(TOKEN.OCTAVE, i, ++i, { shift: 0 });
    } else if (ch >= '1' && ch <= '3') {
      // 같은 숫자 두 개 = 아래 옥타브(11~33), 하나 = 위 옥타브(1~3)
      if (next === ch) push(TOKEN.OCTAVE, i, (i += 2), { shift: -Number(ch) });
      else push(TOKEN.OCTAVE, i, ++i, { shift: Number(ch) });
    } else if (ch >= '4' && ch <= '9') {
      push(TOKEN.RESERVED_DIGIT, i, ++i);
    } else if (INSTRUMENT_KEYS.includes(ch)) {
      push(TOKEN.INSTRUMENT, i, ++i, { instrument: INSTRUMENT_KEYS.indexOf(ch) + 1 });
    } else if (ch === '^' && next >= '1' && next <= '3') {
      push(TOKEN.DYNAMIC, i, (i += 2), { level: Number(next) });
    } else if (ch === '[') {
      push(TOKEN.CHORD_START, i, ++i);
    } else if (ch === ']') {
      push(TOKEN.CHORD_END, i, ++i);
    } else {
      push(TOKEN.UNKNOWN, i, ++i);
    }
  }
  return tokens;
}

/**
 * 악보에서 실제로 소리가 나는 자모만 순서대로. 메타 칸({제목} 등)과 가사 줄의 글자는 빠진다.
 * 입력 중 "방금 친 음"을 찾을 때 쓴다.
 */
export function scoreJamo(text) {
  const out = [];
  for (const token of tokenize(text)) {
    if (token.type === TOKEN.GLYPH) out.push(...token.jamo);
  }
  return out;
}

const LEADING_META = /^(?:\s*\{[^}\n]*\})*/;
const TEMPO_META = /\{\d+\}/;

/**
 * 맨 앞 메타 칸의 템포를 바꾼 악보 텍스트를 돌려준다. {템포}가 없으면 맨 앞 메타 칸들 뒤에 넣는다.
 */
export function withTempo(text, tempo) {
  const head = LEADING_META.exec(text)[0];
  const meta = `{${tempo}}`;
  const nextHead = TEMPO_META.test(head) ? head.replace(TEMPO_META, meta) : head + meta;
  return nextHead + text.slice(head.length);
}

/**
 * @typedef {object} NoteEvent
 * @property {number} time      시작 시간(초)
 * @property {number} duration  길이(초)
 * @property {string} jamo      이 음을 낸 자모
 * @property {object} sound     keymap.jamoToSound 결과 ({type:'note', midi, voice} | {type:'perc', name})
 * @property {number} start     원문에서 이 음이 속한 글자의 시작 위치
 * @property {number} end       원문 끝 위치(제외)
 *
 * @typedef {object} Segment    재생 위치 표시용: 시간을 차지하는 원문 글자 하나
 * @property {'glyph'|'rest'|'tie'} type
 * @property {number} time
 * @property {number} duration
 * @property {number} start
 * @property {number} end
 */

/**
 * @param {string} text 악보 텍스트
 * @returns {{ tempo: number, title: string, glyphCount: number, duration: number,
 *             events: NoteEvent[], segments: Segment[] }}
 *          title은 첫 제목 메타 칸(없으면 빈 문자열), glyphCount는 음을 내는 글자 수.
 */
export function parse(text) {
  const events = [];
  const segments = [];
  let tempo = DEFAULT_TEMPO;
  let title = '';
  let glyphCount = 0;
  let time = 0;
  let timed = false;      // 시간을 차지하는 토큰이 이미 나왔는지
  let sustain = null;     // '-'가 늘일 대상(직전 글자의 마지막 음). 쉼표 뒤에는 없음.

  for (const token of tokenize(text)) {
    const beat = 60 / tempo;

    switch (token.type) {
      case TOKEN.META: {
        // 1단계: 맨 앞(첫 음 이전)의 {템포}만 적용. 나머지 메타 칸은 건너뛴다.
        const { meta } = token;
        if (meta.kind === 'tempo' && !timed && meta.tempo >= TEMPO_MIN && meta.tempo <= TEMPO_MAX) {
          tempo = meta.tempo;
        } else if (meta.kind === 'title' && !title) {
          title = meta.title;
        }
        break;
      }

      case TOKEN.GLYPH: {
        const step = beat / token.jamo.length;
        glyphCount++;
        sustain = null;
        token.jamo.forEach((jamo, index) => {
          const sound = jamoToSound(jamo);
          if (!sound) return;
          sustain = {
            time: time + step * index,
            duration: step,
            jamo,
            sound,
            start: token.start,
            end: token.end,
          };
          events.push(sustain);
        });
        segments.push({ type: 'glyph', time, duration: beat, start: token.start, end: token.end });
        time += beat;
        timed = true;
        break;
      }

      case TOKEN.REST:
        sustain = null;
        segments.push({ type: 'rest', time, duration: beat, start: token.start, end: token.end });
        time += beat;
        timed = true;
        break;

      case TOKEN.TIE:
        if (sustain) sustain.duration += beat;
        segments.push({ type: 'tie', time, duration: beat, start: token.start, end: token.end });
        time += beat;
        timed = true;
        break;

      // 시간 없음: 공백, 줄바꿈, 마디선
      // 아직 구현하지 않음: 옥타브, 악기, 강약, 화음, 반복, 가사 줄, 그 밖의 글자
      default:
        break;
    }
  }

  return { tempo, title, glyphCount, duration: time, events, segments };
}
