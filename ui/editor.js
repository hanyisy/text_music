// 입력창. 텍스트가 바뀔 때마다 "방금 친 자모"를 찾아 알려주고,
// 영문 모드 입력을 한글로 바꾸고, 재생 위치를 하이라이트한다.
//
// textarea는 글자 일부에만 배경을 칠할 수 없어서, 같은 글꼴·같은 줄바꿈의
// 표시 레이어(backdrop)를 뒤에 깔고 거기에 하이라이트를 그린다.

import { convertLatin, hasLatin } from '../engine/hangul.js';
import { JamoTracker } from '../engine/diff.js';

// 한 번에 이보다 많은 자모가 늘면 연주가 아니라 붙여넣기·자동완성으로 보고 소리 내지 않는다.
const MAX_LIVE_JAMO = 8;
const SILENT_INPUT_TYPES = new Set(['insertFromPaste', 'insertFromDrop', 'insertFromYank', 'historyUndo', 'historyRedo']);
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export class Editor {
  #input;
  #backdrop;
  #tracker = new JamoTracker();
  #composeEnd = -1;     // 영문 → 한글 변환에서 아직 조합 중인 글자의 끝 위치
  #lastText = '';
  #highlight = null;
  #onJamo;
  #onChange;

  /**
   * @param {object} options
   * @param {HTMLTextAreaElement} options.input
   * @param {HTMLElement} options.backdrop
   * @param {(jamo: string[]) => void} options.onJamo     방금 친 자모
   * @param {(text: string) => void} options.onChange     텍스트가 바뀜
   */
  constructor({ input, backdrop, onJamo, onChange }) {
    this.#input = input;
    this.#backdrop = backdrop;
    this.#onJamo = onJamo;
    this.#onChange = onChange;

    input.addEventListener('input', (event) => this.#sync(event.isComposing, event.inputType));
    input.addEventListener('compositionend', () => this.#sync(false, 'insertCompositionText'));
    // 커서를 옮기면 영문 조합은 거기서 끊긴다.
    input.addEventListener('pointerdown', () => { this.#composeEnd = -1; });
    input.addEventListener('blur', () => { this.#composeEnd = -1; });
    input.addEventListener('keydown', (event) => {
      if (CARET_KEYS.has(event.key)) this.#composeEnd = -1;
    });
    addEventListener('resize', () => this.#resize());

    this.#render();
  }

  get text() {
    return this.#input.value;
  }

  /** 소리 없이 내용을 바꾼다(링크로 불러오기 등). */
  setText(text) {
    this.#input.value = convertLatin(text).text;
    this.#lastText = this.#input.value;
    this.#composeEnd = -1;
    this.#tracker.reset(this.#lastText);
    this.#highlight = null;
    this.#render();
  }

  /** 원문 위치 [start, end)를 재생 중으로 표시. null이면 지운다. */
  setHighlight(range) {
    this.#highlight = range;
    this.#render();
    if (range) this.#backdrop.querySelector('mark')?.scrollIntoView({ block: 'nearest' });
  }

  #sync(composing, inputType) {
    const input = this.#input;
    let text = input.value;
    let heard = text;   // 소리 판정에 쓰는 텍스트(영문을 한글로 바꾼 모습)

    if (hasLatin(text)) {
      if (composing) {
        // 입력기가 조합 중일 때 값을 바꾸면 조합이 깨진다. 소리만 먼저 내고, 조합이 끝나면 바꾼다.
        heard = convertLatin(text).text;
        this.#composeEnd = -1;
      } else {
        const caret = input.selectionStart;
        const continuing = this.#composeEnd > 0
          && text.slice(0, this.#composeEnd) === this.#lastText.slice(0, this.#composeEnd);
        const converted = convertLatin(text, caret, continuing ? this.#composeEnd : -1);
        text = heard = converted.text;
        input.value = text;
        input.setSelectionRange(converted.caret, converted.caret);
        this.#composeEnd = converted.composeEnd === converted.caret ? converted.composeEnd : -1;
      }
    } else {
      this.#composeEnd = -1;
    }

    if (SILENT_INPUT_TYPES.has(inputType)) {
      this.#tracker.reset(heard);
    } else {
      const jamo = this.#tracker.update(heard, performance.now());
      if (jamo.length && jamo.length <= MAX_LIVE_JAMO) this.#onJamo(jamo);
    }

    if (text !== this.#lastText) {
      this.#lastText = text;
      this.#highlight = null;
      this.#render();
      this.#onChange(text);
    }
  }

  #render() {
    const text = this.#input.value;
    const range = this.#highlight;
    if (range) {
      const mark = document.createElement('mark');
      mark.textContent = text.slice(range.start, range.end);
      this.#backdrop.replaceChildren(text.slice(0, range.start), mark, `${text.slice(range.end)}\n`);
    } else {
      // 끝의 줄바꿈은 마지막 빈 줄의 높이를 textarea와 맞추기 위한 것
      this.#backdrop.replaceChildren(`${text}\n`);
    }
    this.#resize();
  }

  // 입력창 안에서 스크롤이 생기면 표시 레이어와 어긋나므로, 내용 높이만큼 키운다.
  #resize() {
    const input = this.#input;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }
}
