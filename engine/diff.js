// 입력 텍스트 변화에서 "방금 친 자모"를 찾는다.
// 두벌식은 누른 순서 = 자모 순서라서, 텍스트를 자모로 풀어 이전 상태와 비교하면
// 도깨비불(각 + ㅏ → 가가)도 ㅏ 하나 추가로 잡힌다.

import { textToJamo } from './hangul.js';

/** 두 자모 목록의 공통 앞·뒤를 걷어내고 바뀐 가운데만 돌려준다. */
export function diffJamo(prev, next) {
  const max = Math.min(prev.length, next.length);
  let head = 0;
  while (head < max && prev[head] === next[head]) head++;
  let tail = 0;
  while (tail < max - head && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  return {
    added: next.slice(head, next.length - tail),
    removed: prev.slice(head, prev.length - tail),
  };
}

/** 이전 텍스트 → 다음 텍스트에서 새로 추가된 자모 목록. */
export function addedJamo(prevText, nextText) {
  return diffJamo(textToJamo(prevText), textToJamo(nextText)).added;
}

// 입력기가 글자를 확정하면서 잠깐 받침을 뺐다가(각 → 가) 곧바로 다시 넣는(가 → 가가)
// 식으로 이벤트를 두 번 보내는 경우가 있다. 이 시간 안에 되돌아온 자모는 새 음으로 치지 않는다.
const REINSERT_WINDOW_MS = 30;

/**
 * 입력창 텍스트를 계속 받아서, 매번 새로 추가된 자모만 돌려주는 상태 추적기.
 */
export class JamoTracker {
  #jamo;
  #removed = null;
  #removedAt = 0;

  constructor(text = '') {
    this.#jamo = textToJamo(text);
  }

  /** 소리 없이 현재 상태만 맞춘다 (불러오기, 붙여넣기 등). */
  reset(text) {
    this.#jamo = textToJamo(text);
    this.#removed = null;
  }

  /**
   * @param {string} text  현재 입력창 텍스트
   * @param {number} now   현재 시각(ms). 같은 순간의 연속 이벤트를 묶는 데만 쓴다.
   * @returns {string[]}   방금 친 자모
   */
  update(text, now = 0) {
    const next = textToJamo(text);
    const { added, removed } = diffJamo(this.#jamo, next);
    this.#jamo = next;

    let fresh = added;
    const ghost = this.#removed;
    if (ghost && now - this.#removedAt <= REINSERT_WINDOW_MS && added.length >= ghost.length
      && ghost.every((jamo, i) => jamo === added[i])) {
      fresh = added.slice(ghost.length);
    }

    if (removed.length && !added.length) {
      this.#removed = removed;
      this.#removedAt = now;
    } else {
      this.#removed = null;
    }
    return fresh;
  }
}
