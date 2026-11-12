// 악보 표시 영역. 입력창의 텍스트를 토큰 단위로 그려서
// 괴문자는 크게, 박 기호는 작게, 숫자·기호 코드와 메타 칸은 숨겨서 보여준다.
// (숨긴 것은 "규칙 보기"를 켜면 CSS가 드러낸다.)
// 텍스트는 그대로, 보여주는 방식만 여기서 정한다.

import { TOKEN, tokenize } from '../engine/parser.js';

const RHYTHM = new Set([
  TOKEN.REST, TOKEN.TIE, TOKEN.BAR, TOKEN.REPEAT_START, TOKEN.REPEAT_END, TOKEN.CHORD_START, TOKEN.CHORD_END,
]);
// 기본으로 숨기고 마우스를 올렸을 때만 작게 보여주는 코드
const CODE = new Set([TOKEN.OCTAVE, TOKEN.INSTRUMENT, TOKEN.DYNAMIC, TOKEN.RESERVED_DIGIT]);

function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

export class ScoreView {
  #lines;
  #empty;
  #title;
  #byStart = new Map();   // 원문 위치 → 시간을 차지하는 글자의 요소
  #active = null;

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
  }

  /**
   * @param {string} text   악보 텍스트
   * @param {string} title  곡 제목(없으면 빈 문자열)
   * @param {object} [options]
   * @param {boolean} [options.expanded]  펼쳐보기: 괴문자를 자모 단위로 풀어서 보여준다
   */
  render(text, title, { expanded = false } = {}) {
    this.#byStart.clear();
    this.#active = null;

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

    for (const token of tokenize(text)) {
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

      if (token.type === TOKEN.GLYPH || RHYTHM.has(token.type)) {
        const el = token.type !== TOKEN.GLYPH ? span('tok tok--rhythm', source)
          : expanded ? span('tok tok--note tok--expanded', token.jamo.join(''))
            : span('tok tok--note', source);
        this.#byStart.set(token.start, el);
        row.el.append(el);
        row.visible = true;
      } else if (token.type === TOKEN.SPACE) {
        row.el.append(span('tok tok--space', ' '));
      } else if (token.type === TOKEN.LYRIC) {
        row.el.classList.add('score__line--lyric');
        row.el.append(span('tok-lyric', token.body));
        row.visible = true;
      } else if (token.type === TOKEN.UNKNOWN) {
        row.el.append(span('tok tok--other', source));
        row.visible = true;
      } else if (token.type === TOKEN.META) {
        row.el.append(span('tok-meta', source));
        row.quiet = true;
      }
    }

    // 코드·메타 칸만 있는 줄은 평소엔 줄째로 숨긴다.
    for (const r of rows) if (!r.visible) r.el.classList.add('score__line--quiet');
    this.#lines.replaceChildren(...rows.filter((r) => r.visible || r.quiet).map((r) => r.el));
    this.#empty.hidden = text.trim() !== '';
    this.#title.hidden = !title;
    this.#title.textContent = title;
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

  /** 방금 친 글자(원문 위치)를 살짝 튀게 한다. */
  flash(index) {
    const el = this.#byStart.get(index);
    if (!el) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;    // 애니메이션을 처음부터 다시
    el.classList.add('is-flash');
  }
}
