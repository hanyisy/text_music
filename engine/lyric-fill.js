// 가사 자동 분배: 쭉 친 가사를 악보 줄의 음에 한 음절씩 나눠 가사 줄을 만든다.

import { TOKEN, tokenize } from './parser.js';

const BAR_TOKENS = new Set([TOKEN.BAR, TOKEN.REPEAT_START, TOKEN.REPEAT_END]);
const IGNORED_IN_LYRICS = new Set(['/', '|', ';']);

/**
 * @param {string} scoreLine   악보 한 줄 (예: "가나,각")
 * @param {string} lyricText   띄어쓰기 상관없이 쭉 친 가사 (예: "반짝작은별")
 * @returns {{ line: string, used: number,
 *             warnings: Array<{ type: 'syllables-extra', count: number, text: string }> }}
 *          line은 ; 로 시작하는 가사 줄. 악보의 마디선 자리에는 / 대신 | 를 넣는다.
 *          가사가 음보다 많으면 넘친 음절 수와 내용을 경고로 돌려준다(줄에는 넣지 않는다).
 *          가사가 모자라면 채운 글자까지만 칸을 만든다.
 */
export function distributeLyrics(scoreLine, lyricText) {
  const syllables = Array.from(lyricText).filter((ch) => !/\s/.test(ch) && !IGNORED_IN_LYRICS.has(ch));
  let out = '';
  let used = 0;
  let separator = '';
  let started = false;
  let filledAll = true;

  for (const token of tokenize(scoreLine)) {
    if (token.type === TOKEN.NEWLINE) break;
    if (BAR_TOKENS.has(token.type)) {
      separator = '|';
    } else if (token.type === TOKEN.GLYPH) {
      if (used >= syllables.length) {
        filledAll = false;
        break;
      }
      const notes = token.jamo.length;
      const taken = syllables.slice(used, used + notes);
      out += (started ? separator || '/' : separator) + taken.join('') + '-'.repeat(notes - taken.length);
      used += taken.length;
      started = true;
      separator = '';
    }
  }
  if (filledAll) out += separator;

  const overflow = syllables.slice(used);
  return {
    line: `;${out}`,
    used,
    warnings: overflow.length ? [{ type: 'syllables-extra', count: overflow.length, text: overflow.join('') }] : [],
  };
}

const isLyricLine = (line) => line.startsWith(';');

function glyphsOf(line) {
  return tokenize(line).filter((token) => token.type === TOKEN.GLYPH);
}

// position이 속한 줄에서 위로 올라가며 가사 줄이 아닌 첫 줄을 찾는다.
function locate(text, position) {
  const lines = text.split('\n');
  let index = 0;
  let offset = 0;
  while (index < lines.length - 1 && offset + lines[index].length < position) {
    offset += lines[index].length + 1;
    index++;
  }
  while (index >= 0 && isLyricLine(lines[index])) index--;
  return { lines, index };
}

/**
 * 커서 위치가 가리키는 악보 줄. 가사 줄에 있으면 그 위의 악보 줄.
 * @returns {{ index: number, text: string, glyphs: number, notes: number } | null}  음이 없는 줄이면 null
 */
export function scoreLineAt(text, position) {
  const { lines, index } = locate(text, position);
  if (index < 0) return null;
  const glyphs = glyphsOf(lines[index]);
  if (!glyphs.length) return null;
  return {
    index,
    text: lines[index],
    glyphs: glyphs.length,
    notes: glyphs.reduce((sum, glyph) => sum + glyph.jamo.length, 0),
  };
}

/**
 * 커서가 있는 악보 줄 바로 아래에 자동 분배한 가사 줄을 넣는다. 이미 가사 줄이 있으면 바꾼다.
 *
 * @returns {{ ok: boolean, text: string, caret: number, warnings: object[] }}
 *          ok가 false면 가리키는 악보 줄이 없어 아무것도 바꾸지 않은 것.
 */
export function setLyricLine(text, position, lyricText) {
  const target = scoreLineAt(text, position);
  if (!target) return { ok: false, text, caret: position, warnings: [] };

  const { lines } = locate(text, position);
  const { line, warnings } = distributeLyrics(target.text, lyricText);
  const below = target.index + 1;
  if (below < lines.length && isLyricLine(lines[below])) lines[below] = line;
  else lines.splice(below, 0, line);

  const caret = lines.slice(0, below + 1).join('\n').length;
  return { ok: true, text: lines.join('\n'), caret, warnings };
}
