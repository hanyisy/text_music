// 악보 표시 영역. 파서 결과를 토큰 단위로 그려서
// 괴문자는 크게, 박 기호는 작게, 숫자·기호 코드와 메타 칸은 숨겨서 보여준다.
// (숨긴 것은 "규칙 보기"를 켜면 CSS가 드러낸다.)
// 가사 줄은 칸·음절 단위로 그려서 글자와 가사 칸을 서로 이어 보여준다.
// 텍스트는 그대로, 보여주는 방식만 여기서 정한다.

import { TOKEN } from '../engine/parser.js';

const RHYTHM = new Set([
  TOKEN.REST, TOKEN.TIE, TOKEN.BAR, TOKEN.REPEAT_START, TOKEN.REPEAT_END, TOKEN.CHORD_START, TOKEN.CHORD_END,
]);
// 기본으로 숨기고 마우스를 올렸을 때만 작게 보여주는 코드
const CODE = new Set([TOKEN.OCTAVE, TOKEN.INSTRUMENT, TOKEN.DYNAMIC, TOKEN.RESERVED_DIGIT]);

function span(className, text = '') {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

export class ScoreView {
  #lines;
  #empty;
  #title;
  #byStart = new Map();       // 원문 위치 → 시간을 차지하는 글자의 요소
  #syllables = new Map();     // 원문 위치 → 가사 음절 요소
  #cellsByStart = new Map();  // 원문 위치 → 가사 칸 요소
  #cellsByGlyph = new Map();  // 악보 글자의 원문 위치 → 그 글자에 붙은 가사 칸 요소들
  #rowsByStart = new Map();   // 가사 줄의 원문 위치 → 줄 요소
  #active = null;
  #singing = null;
  #hovered = null;            // 마우스를 올린 글자의 원문 위치
  #pinned = null;             // 탭해서 고정한 글자의 원문 위치
  #picked = null;

  /**
   * @param {object} elements
   * @param {HTMLElement} elements.lines  악보 줄이 들어갈 곳
   * @param {HTMLElement} elements.empty  악보가 비었을 때 보여줄 안내
   * @param {HTMLElement} elements.title  곡 제목
   */
  constructor({ lines, empty, title }) {
    this.#lines = lines;
    this.#empty = empty;
    this.#title = title;

    // 글자에 마우스를 올리거나 탭하면 붙은 가사 칸과 음 개수를 보여준다.
    const glyphAt = (event) => {
      const el = event.target.closest?.('.tok--note');
      return el ? Number(el.dataset.start) : null;
    };
    lines.addEventListener('pointerover', (event) => {
      if (event.pointerType !== 'mouse') return;
      this.#hovered = glyphAt(event);
      this.#pick();
    });
    lines.addEventListener('pointerleave', () => {
      this.#hovered = null;
      this.#pick();
    });
    lines.addEventListener('click', (event) => {
      const start = glyphAt(event);
      this.#pinned = start === this.#pinned ? null : start;
      this.#pick();
    });
  }

  /**
   * @param {string} text    악보 텍스트
   * @param {object} score   parser.parse(text) 결과
   * @param {object} [options]
   * @param {boolean} [options.expanded]  펼쳐보기: 괴문자를 자모 단위로 풀어서 보여준다
   * @param {Array<{ start: number, message: string }>} [options.warnings]  원문 위치별 경고 문구
   */
  render(text, score, { expanded = false, warnings = [] } = {}) {
    for (const map of [this.#byStart, this.#syllables, this.#cellsByStart, this.#cellsByGlyph, this.#rowsByStart]) {
      map.clear();
    }
    this.#active = this.#singing = this.#picked = null;
    const lyricLines = new Map(score.lyrics.map((line) => [line.start, line]));

    const rows = [];
    let row = null;
    let code = null;    // 이어진 코드(예: !1^2)는 한 덩어리로
    const newRow = () => {
      row = { el: document.createElement('div'), visible: false, quiet: false };
      row.el.className = 'score__line';
      rows.push(row);
      code = null;
    };
    newRow();

    for (const token of score.tokens) {
      const source = text.slice(token.start, token.end);

      if (token.type === TOKEN.NEWLINE) {
        newRow();
        continue;
      }
      if (CODE.has(token.type)) {
        if (code) code.textContent += source;
        else row.el.append((code = span('tok-code', source)));
        row.quiet = true;
        continue;
      }
      code = null;

      if (token.type === TOKEN.GLYPH) {
        const el = expanded ? span('tok tok--note tok--expanded', token.jamo.join('')) : span('tok tok--note', source);
        el.dataset.start = token.start;
        el.dataset.notes = token.jamo.length;
        this.#byStart.set(token.start, el);
        row.el.append(el);
        row.visible = true;
      } else if (RHYTHM.has(token.type)) {
        const el = span('tok tok--rhythm', source);
        this.#byStart.set(token.start, el);
        row.el.append(el);
        row.visible = true;
      } else if (token.type === TOKEN.SPACE) {
        row.el.append(span('tok tok--space', ' '));
      } else if (token.type === TOKEN.LYRIC) {
        row.el.classList.add('score__line--lyric');
        this.#rowsByStart.set(token.start, row.el);
        this.#renderLyricLine(row.el, text, token, lyricLines.get(token.start));
        row.visible = true;
      } else if (token.type === TOKEN.UNKNOWN) {
        row.el.append(span('tok tok--other', source));
        row.visible = true;
      } else if (token.type === TOKEN.META) {
        row.el.append(span('tok-meta', source));
        row.quiet = true;
      }
    }

    for (const { start, message } of warnings) {
      const el = this.#byStart.get(start) ?? this.#cellsByStart.get(start) ?? this.#rowsByStart.get(start);
      if (!el) continue;
      el.classList.add('has-warning');
      el.title = el.title ? `${el.title}\n${message}` : message;
    }

    // 코드·메타 칸만 있는 줄은 평소엔 줄째로 숨긴다.
    for (const r of rows) if (!r.visible) r.el.classList.add('score__line--quiet');
    this.#lines.replaceChildren(...rows.filter((r) => r.visible || r.quiet).map((r) => r.el));
    this.#empty.hidden = text.trim() !== '';
    this.#title.hidden = !score.title;
    this.#title.textContent = score.title;

    if (!this.#byStart.has(this.#pinned)) this.#pinned = null;
    this.#hovered = null;
    this.#pick();
  }

  /** 원문 위치 { start }의 글자를 재생 중으로 표시. null이면 지운다. */
  setActive(range) {
    const el = range ? this.#byStart.get(range.start) ?? null : null;
    if (el === this.#active) return;
    this.#active?.classList.remove('is-active');
    el?.classList.add('is-active');
    el?.scrollIntoView({ block: 'nearest' });
    this.#active = el;
  }

  /**
   * 지금 부르는 가사(음 이벤트의 lyric)를 표시. 가사 없는 음이면 null.
   * 적지 않은 연장(자동으로 이어 부름)은 앞 음절 표시를 그대로 둔다.
   */
  setSinging(lyric) {
    if (lyric && lyric.start === null) return;
    const el = lyric ? this.#syllables.get(lyric.start) ?? null : null;
    if (el === this.#singing) return;
    this.#singing?.classList.remove('is-sung');
    el?.classList.add('is-sung');
    this.#singing = el;
  }

  /** 방금 친 글자(원문 위치)를 살짝 튀게 한다. */
  flash(index) {
    const el = this.#byStart.get(index);
    if (!el) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;    // 애니메이션을 처음부터 다시
    el.classList.add('is-flash');
  }

  // 가사 줄: 칸(/ 사이)과 음절을 요소로 나눠 그린다. 구분 기호는 흐리게.
  #renderLyricLine(rowEl, text, token, line) {
    let at = token.start + 1;
    for (const cell of line?.cells ?? []) {
      if (cell.start > at) rowEl.append(span('lyric-sep', text.slice(at, cell.start)));
      const cellEl = span('lyric-cell');
      let inner = cell.start;
      for (const item of cell.items) {
        if (item.start > inner) cellEl.append(text.slice(inner, item.start));
        const itemEl = span(item.type === 'extend' ? 'lyric-syl lyric-syl--extend' : 'lyric-syl', item.text);
        this.#syllables.set(item.start, itemEl);
        cellEl.append(itemEl);
        inner = item.end;
      }
      if (cell.end > inner) cellEl.append(text.slice(inner, cell.end));
      this.#cellsByStart.set(cell.start, cellEl);
      if (cell.glyphStart !== null) {
        if (!this.#cellsByGlyph.has(cell.glyphStart)) this.#cellsByGlyph.set(cell.glyphStart, []);
        this.#cellsByGlyph.get(cell.glyphStart).push(cellEl);
      }
      rowEl.append(cellEl);
      at = cell.end;
    }
    if (token.end > at) rowEl.append(span('lyric-sep', text.slice(at, token.end)));
  }

  // 마우스를 올린 글자가 있으면 그것, 없으면 탭해서 고정한 글자를 고른 상태로 표시한다.
  #pick() {
    const start = this.#hovered ?? this.#pinned;
    if (start === this.#picked) return;
    const toggle = (at, on) => {
      this.#byStart.get(at)?.classList.toggle('is-picked', on);
      for (const cell of this.#cellsByGlyph.get(at) ?? []) cell.classList.toggle('is-linked', on);
    };
    if (this.#picked !== null) toggle(this.#picked, false);
    if (start !== null) toggle(start, true);
    this.#picked = start;
  }
}
