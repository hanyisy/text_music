// 한글 음절 조합·분해, 겹자모 분해, 두벌식 영문 → 한글 변환.
// DOM·Web Audio에 의존하지 않는 순수 모듈.
// 여기서 "자모"는 항상 호환 자모(U+3131~U+3163) 한 글자를 말한다.

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

// 겹자모 → 두벌식에서 실제로 누르는 자모 두 개.
// 쌍자음(ㄲ ㄸ ㅃ ㅆ ㅉ)과 ㅒ ㅖ는 Shift 한 번으로 치는 한 자모라 여기 없다.
const COMPOUND = {
  ㅘ: 'ㅗㅏ', ㅙ: 'ㅗㅐ', ㅚ: 'ㅗㅣ', ㅝ: 'ㅜㅓ', ㅞ: 'ㅜㅔ', ㅟ: 'ㅜㅣ', ㅢ: 'ㅡㅣ',
  ㄳ: 'ㄱㅅ', ㄵ: 'ㄴㅈ', ㄶ: 'ㄴㅎ', ㄺ: 'ㄹㄱ', ㄻ: 'ㄹㅁ', ㄼ: 'ㄹㅂ', ㄽ: 'ㄹㅅ',
  ㄾ: 'ㄹㅌ', ㄿ: 'ㄹㅍ', ㅀ: 'ㄹㅎ', ㅄ: 'ㅂㅅ',
};
const COMBINE = Object.fromEntries(Object.entries(COMPOUND).map(([whole, parts]) => [parts, whole]));

const DUBEOLSIK = {
  q: 'ㅂ', w: 'ㅈ', e: 'ㄷ', r: 'ㄱ', t: 'ㅅ', y: 'ㅛ', u: 'ㅕ', i: 'ㅑ', o: 'ㅐ', p: 'ㅔ',
  a: 'ㅁ', s: 'ㄴ', d: 'ㅇ', f: 'ㄹ', g: 'ㅎ', h: 'ㅗ', j: 'ㅓ', k: 'ㅏ', l: 'ㅣ',
  z: 'ㅋ', x: 'ㅌ', c: 'ㅊ', v: 'ㅍ', b: 'ㅠ', n: 'ㅜ', m: 'ㅡ',
  Q: 'ㅃ', W: 'ㅉ', E: 'ㄸ', R: 'ㄲ', T: 'ㅆ', O: 'ㅒ', P: 'ㅖ',
};

const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;

export function isSyllable(ch) {
  const code = ch.charCodeAt(0);
  return code >= SYLLABLE_FIRST && code <= SYLLABLE_LAST;
}

export function isConsonant(ch) {
  const code = ch.charCodeAt(0);
  return code >= 0x3131 && code <= 0x314e;
}

export function isVowel(ch) {
  const code = ch.charCodeAt(0);
  return code >= 0x314f && code <= 0x3163;
}

export function isJamo(ch) {
  return isConsonant(ch) || isVowel(ch);
}

/** 완성형 음절이거나 낱자모인 글자(= 악보에서 한 박을 차지하는 글자). */
export function isHangul(ch) {
  return isSyllable(ch) || isJamo(ch);
}

/** 완성형 음절 → { cho, jung, jong } (jong은 없으면 빈 문자열, 겹자모는 그대로). */
export function splitSyllable(ch) {
  const offset = ch.charCodeAt(0) - SYLLABLE_FIRST;
  return {
    cho: CHO[Math.floor(offset / 588)],
    jung: JUNG[Math.floor(offset / 28) % 21],
    jong: JONG[offset % 28],
  };
}

/** 겹자모를 구성 자모로 분해. 겹자모가 아니면 그대로 한 개. */
export function splitCompound(jamo) {
  return [...(COMPOUND[jamo] ?? jamo)];
}

/**
 * 글자 하나 → 두벌식에서 누른 순서대로의 자모 목록.
 * 쀎 → ㅃ ㅜ ㅔ ㄹ ㅁ. 한글이 아니면 빈 배열.
 */
export function charToJamo(ch) {
  if (isSyllable(ch)) {
    const { cho, jung, jong } = splitSyllable(ch);
    return [cho, ...splitCompound(jung), ...(jong ? splitCompound(jong) : [])];
  }
  if (isJamo(ch)) return splitCompound(ch);
  return [];
}

/** 텍스트 전체 → 자모 목록 (한글이 아닌 글자는 건너뜀). */
export function textToJamo(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const jamo = charToJamo(text[i]);
    for (let k = 0; k < jamo.length; k++) out.push(jamo[k]);
  }
  return out;
}

/**
 * 자모 목록을 두벌식 입력기처럼 음절로 조합한다(도깨비불 포함).
 * ㄱ ㅏ ㄱ ㅏ → "가가", ㅃ ㅜ ㅔ ㄹ ㅁ → "쀎".
 * 자모가 아닌 글자가 끼면 그 자리에서 조합이 끊긴다.
 */
export function composeJamo(jamoList) {
  let out = '';
  let cho = '';
  let jung = '';
  let jong = '';

  const flush = () => {
    if (cho && jung) {
      const code = SYLLABLE_FIRST + (CHO.indexOf(cho) * 21 + JUNG.indexOf(jung)) * 28 + JONG.indexOf(jong);
      out += String.fromCharCode(code);
    } else {
      out += cho + jung;
    }
    cho = jung = jong = '';
  };

  for (const item of jamoList) {
    for (const j of splitCompound(item)) {
      if (isVowel(j)) {
        if (jong) {
          // 도깨비불: 받침(겹받침이면 뒤쪽 자모)이 다음 글자의 초성으로 넘어간다.
          const parts = splitCompound(jong);
          const carry = parts.pop();
          jong = parts.join('');
          flush();
          cho = carry;
          jung = j;
        } else if (jung) {
          const combined = COMBINE[jung + j];
          if (combined) {
            jung = combined;
          } else {
            flush();
            jung = j;
          }
        } else {
          jung = j;
        }
      } else if (isConsonant(j)) {
        if (cho && jung) {
          const candidate = jong ? COMBINE[jong + j] : j;
          if (candidate && JONG.includes(candidate)) {
            jong = candidate;
          } else {
            flush();
            cho = j;
          }
        } else {
          if (cho || jung) flush();
          cho = j;
        }
      } else {
        flush();
        out += j;
      }
    }
  }
  flush();
  return out;
}

/** 영문 글자 → 두벌식 자모. 대응이 없으면 null. */
export function latinToJamo(ch) {
  return DUBEOLSIK[ch] ?? DUBEOLSIK[ch.toLowerCase()] ?? null;
}

const LATIN_RUN = /[A-Za-z]+/g;

export function hasLatin(text) {
  return /[A-Za-z]/.test(text);
}

/**
 * 텍스트 안의 영문 글자를 두벌식으로 한글로 바꾼다.
 *
 * @param {string} text
 * @param {number} caret       현재 커서 위치
 * @param {number} composeEnd  직전 변환에서 "아직 조합 중"인 글자의 끝 위치(없으면 -1).
 *                             영문 구간이 정확히 이 위치에서 시작하면 바로 앞 글자와 이어서 조합한다.
 *                             (ㄱ + k → 가, 각 + k → 가가)
 * @returns {{ text: string, caret: number, composeEnd: number }}
 *          composeEnd는 마지막으로 변환된 구간의 끝. 변환이 없었으면 -1.
 */
export function convertLatin(text, caret = text.length, composeEnd = -1) {
  let out = '';
  let last = 0;
  let newCaret = caret;
  let newComposeEnd = -1;

  for (const match of text.matchAll(LATIN_RUN)) {
    const start = match.index;
    const end = start + match[0].length;
    let keys = [...match[0]].map(latinToJamo);
    let from = start;

    if (start === composeEnd && start > last) {
      const prev = text[start - 1];
      const prevKeys = charToJamo(prev);
      // 다시 조합했을 때 원래 글자가 그대로 나오는 경우에만 이어 붙인다.
      if (prevKeys.length && composeJamo(prevKeys) === prev) {
        keys = [...prevKeys, ...keys];
        from = start - 1;
      }
    }

    out += text.slice(last, from) + composeJamo(keys);
    if (caret >= end) newCaret = caret + (out.length - end);
    else if (caret > from) newCaret = out.length;
    newComposeEnd = out.length;
    last = end;
  }

  if (newComposeEnd === -1) return { text, caret, composeEnd: -1 };
  return { text: out + text.slice(last), caret: newCaret, composeEnd: newComposeEnd };
}
