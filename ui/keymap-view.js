// 음 배치 표. engine/keymap.js의 배치를 그대로 그리고, 방금 친 키에 불을 켠다.

import { KEY_LAYOUT, baseJamo } from '../engine/keymap.js';

const NOTE_NAMES = ['도', '도#', '레', '레#', '미', '파', '파#', '솔', '솔#', '라', '라#', '시'];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const PERCUSSION_NAMES = { tick: '틱', thump: '쿵' };
const LIT_MS = 260;

function element(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text) el.textContent = text;
  return el;
}

export class KeymapView {
  #cells = new Map();   // 자모 → 칸
  #lit = null;
  #timer = null;

  /** @param {HTMLElement} container */
  constructor(container) {
    container.append(
      this.#row('멜로디', KEY_LAYOUT.melody.map((jamo, i) => [jamo, NOTE_NAMES[i], BLACK_KEYS.has(i)]), 'keymap__keys'),
      this.#row('반주', KEY_LAYOUT.accomp.map((jamo, i) => [jamo, NOTE_NAMES[i], BLACK_KEYS.has(i)]), 'keymap__keys'),
      this.#row('확장', KEY_LAYOUT.percussion.map(({ jamo, name }) => [jamo, PERCUSSION_NAMES[name] ?? name, false]),
        'keymap__keys keymap__keys--extra'),
    );
  }

  /** 자모에 해당하는 칸을 잠깐 밝힌다. */
  light(jamo) {
    const cell = this.#cells.get(baseJamo(jamo));
    if (!cell) return;
    clearTimeout(this.#timer);
    this.#lit?.classList.remove('is-lit');
    cell.classList.add('is-lit');
    this.#lit = cell;
    this.#timer = setTimeout(() => cell.classList.remove('is-lit'), LIT_MS);
  }

  #row(label, keys, keysClass) {
    const row = element('div', 'keymap__row');
    const grid = element('div', keysClass);
    for (const [jamo, name, black] of keys) {
      const cell = element('div', black ? 'keymap__cell keymap__cell--black' : 'keymap__cell', jamo);
      cell.append(element('small', 'keymap__name', name));
      this.#cells.set(jamo, cell);
      grid.append(cell);
    }
    row.append(element('span', 'keymap__label', label), grid);
    return row;
  }
}
