// 가사 줄(; 로 시작하는 줄)을 칸·음절로 읽고, 악보 글자의 음에 맞춰 붙인다.
// 연주에는 관여하지 않는다. 결과는 음 이벤트마다 { 음절 | 연장 | 없음 }이라
// OpenUtau(.ust/.ustx)처럼 "음 하나 = 가사 하나"인 형식으로 그대로 옮길 수 있다.

const isBlank = (ch) => ch === ' ' || ch === '\t' || ch === '\r' || ch === '　';
const isExtend = (ch) => ch === '-' || ch === '—';

/**
 * @typedef {object} LyricItem   가사 칸 안의 한 자리(음 하나에 대응)
 * @property {'syllable'|'extend'} type
 * @property {string} text       음절 글자. 연장이면 적힌 기호
 * @property {number} start      원문 위치
 * @property {number} end
 *
 * @typedef {object} LyricCell   / 로 나눈 칸 하나(괴문자 한 글자에 대응)
 * @property {number} start
 * @property {number} end
 * @property {LyricItem[]} items
 */

/**
 * 가사 줄 본문(; 뒤)을 칸으로 나눈다.
 *
 * - `/` 가 칸을 나눈다. 빈 칸(`//`)은 "이 글자엔 가사 없음".
 * - `|` 는 악보의 마디선을 따라 적는 보기용 기호. 칸도 나누지만 빈 칸을 만들지는 않는다.
 *   (`별--|`, `짝|작`, `짝/|작` 모두 같은 칸 구성)
 * - 줄 끝의 빈 칸은 없는 것으로 본다.
 * - 칸 안의 공백은 보기용. `-`(또는 `—`)는 앞 음절을 이어 부르는 자리.
 *
 * @param {string} body    ; 다음부터 줄 끝까지
 * @param {number} offset  body가 시작하는 원문 위치
 * @returns {LyricCell[]}
 */
export function parseLyricCells(body, offset = 0) {
  const cells = [];
  let from = 0;
  let left = null;

  for (let i = 0; i <= body.length; i++) {
    const ch = i < body.length ? body[i] : null;
    if (ch !== null && ch !== '/' && ch !== '|') continue;

    const items = [];
    for (let k = from; k < i;) {
      const point = String.fromCodePoint(body.codePointAt(k));
      if (!isBlank(point)) {
        items.push({
          type: isExtend(point) ? 'extend' : 'syllable',
          text: point,
          start: offset + k,
          end: offset + k + point.length,
        });
      }
      k += point.length;
    }

    const decorative = left === '|' || ch === '|' || ch === null;
    if (items.length || !decorative) cells.push({ start: offset + from, end: offset + i, items });
    from = i + 1;
    left = ch;
  }
  return cells;
}

/**
 * @typedef {object} NoteLyric    음 하나에 붙는 가사. 가사가 없으면 null.
 * @property {'syllable'|'extend'} type
 * @property {string} text        부르는 음절. 연장이면 이어 부르는 앞 음절(없으면 빈 문자열)
 * @property {number|null} start  가사 줄에서의 원문 위치. 적지 않은 연장(자동으로 이어 부름)은 null
 * @property {number|null} end
 *
 * @typedef {object} LyricWarning
 * @property {'cells-missing'|'cells-extra'|'syllables-missing'|'syllables-extra'|'no-score-line'} type
 * @property {number} count   몇 개 어긋났는지
 * @property {number} start   어긋난 곳의 원문 위치(악보 글자, 또는 남는 가사 칸)
 * @property {number} end
 */

/**
 * 가사 칸을 악보 글자에 순서대로 맞춘다. 안 맞아도 멈추지 않고 경고로 돌려준다.
 *
 * @param {LyricCell[]} cells
 * @param {Array<{ start: number, end: number, notes: number }>} glyphs  악보 줄의 글자들(쉼표·늘임 제외)
 * @returns {{ cells: Array<LyricCell & { glyphStart: number|null }>,
 *             notes: Array<Array<NoteLyric|null>>, warnings: LyricWarning[] }}
 *          notes[i][j] = i번째 글자의 j번째 음에 붙는 가사
 */
export function alignLyricCells(cells, glyphs) {
  const warnings = [];
  let sung = '';   // 직전에 부른 음절(연장이 가리키는 대상)

  const notes = glyphs.map((glyph, i) => {
    const cell = cells[i];
    if (!cell || !cell.items.length) return Array(glyph.notes).fill(null);

    const { items } = cell;
    if (items.length !== glyph.notes) {
      warnings.push({
        type: items.length < glyph.notes ? 'syllables-missing' : 'syllables-extra',
        count: Math.abs(items.length - glyph.notes),
        start: glyph.start,
        end: glyph.end,
      });
    }
    return Array.from({ length: glyph.notes }, (_, j) => {
      const item = items[j];
      // 음절이 모자라면 남은 음은 앞 음절을 이어 부른다.
      if (!item) return { type: 'extend', text: sung, start: null, end: null };
      if (item.type === 'extend') return { type: 'extend', text: sung, start: item.start, end: item.end };
      sung = item.text;
      return { type: 'syllable', text: item.text, start: item.start, end: item.end };
    });
  });

  if (cells.length < glyphs.length) {
    const first = glyphs[cells.length];
    warnings.push({ type: 'cells-missing', count: glyphs.length - cells.length, start: first.start, end: first.end });
  } else if (cells.length > glyphs.length) {
    warnings.push({
      type: 'cells-extra',
      count: cells.length - glyphs.length,
      start: cells[glyphs.length].start,
      end: cells[cells.length - 1].end,
    });
  }

  return {
    cells: cells.map((cell, i) => ({ ...cell, glyphStart: glyphs[i]?.start ?? null })),
    notes,
    warnings: warnings.sort((a, b) => a.start - b.start),
  };
}
