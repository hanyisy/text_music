// 입력창. 텍스트가 바뀔 때마다 "방금 친 자모"를 찾아 알려주고,
// 영문 모드 입력을 한글로 바꾼다. 화면에 어떻게 그릴지는 모른다.

import { convertLatin, hasLatin } from '../engine/hangul.js';
import { JamoTracker } from '../engine/diff.js';

// 한 번에 이보다 많은 자모가 늘면 연주가 아니라 붙여넣기·자동완성으로 보고 소리 내지 않는다.
const MAX_LIVE_JAMO = 8;
const SILENT_INPUT_TYPES = new Set(['insertFromPaste', 'insertFromDrop', 'insertFromYank', 'historyUndo', 'historyRedo']);
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export class Editor {
  #input;
  #tracker = new JamoTracker();
  #composeEnd = -1;     // 영문 → 한글 변환에서 아직 조합 중인 글자의 끝 위치
  #lastText = '';
  #onJamo;
  #onChange;

  /**
   * @param {object} options
   * @param {HTMLTextAreaElement} options.input
   * @param {(text: string) => void} options.onChange                  텍스트가 바뀜
   * @param {(jamo: string[], caret: number) => void} options.onJamo   방금 친 자모와 커서 위치(onChange 뒤에 불린다)
   */
  constructor({ input, onJamo, onChange }) {
    this.#input = input;
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
  }

  get text() {
    return this.#input.value;
  }

  /** 입력창의 커서 위치(포커스가 다른 곳에 있어도 마지막 위치를 기억한다). */
  get caret() {
    return this.#input.selectionStart;
  }

  /**
   * 소리 없이 내용을 바꾼다(링크로 불러오기, 예시, 지우기, 가사 넣기).
   * @param {string} text
   * @param {number} [caret]  바꾼 뒤 커서를 둘 위치
   */
  setText(text, caret) {
    this.#input.value = convertLatin(text).text;
    if (caret !== undefined) this.#input.setSelectionRange(caret, caret);
    this.#lastText = this.#input.value;
    this.#composeEnd = -1;
    this.#tracker.reset(this.#lastText);
    this.#onChange(this.#lastText);
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

    let jamo = [];
    // 지우기는 음이 아니다({ 를 지워 제목이 음표로 바뀌는 경우 포함).
    if (SILENT_INPUT_TYPES.has(inputType) || inputType?.startsWith('delete')) this.#tracker.reset(heard);
    else jamo = this.#tracker.update(heard, performance.now());

    if (text !== this.#lastText) {
      this.#lastText = text;
      this.#onChange(text);
    }
    if (jamo.length && jamo.length <= MAX_LIVE_JAMO) this.#onJamo(jamo, input.selectionStart);
  }
}
