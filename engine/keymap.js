// 자모 → 소리 매핑. 음 배치를 바꿀 때는 이 파일만 고치면 된다.
// (DESIGN.md "음 배치"의 열린 질문 — 지금 값은 임시)

/** 모음(멜로디)의 기준 옥타브 시작 음: C4 */
export const MELODY_BASE = 60;
/** 자음(반주)의 기준 옥타브 시작 음: C3 */
export const ACCOMP_BASE = 48;

// 기준 음에서 몇 반음 위인지.
const MELODY = {
  ㅗ: 0, ㅛ: 1, ㅓ: 2, ㅕ: 3, ㅏ: 4, ㅣ: 5, ㅑ: 6, ㅠ: 7, ㅐ: 8, ㅜ: 9, ㅔ: 10, ㅡ: 11,
};
const ACCOMP = {
  ㅁ: 0, ㅂ: 1, ㄴ: 2, ㅈ: 3, ㅇ: 4, ㄹ: 5, ㄷ: 6, ㅎ: 7, ㄱ: 8, ㅋ: 9, ㅅ: 10, ㅌ: 11,
};
// 확장용 예약 키. 1단계에서는 짧은 타악 소리.
const PERCUSSION = {
  ㅊ: 'tick',
  ㅍ: 'thump',
};
// Shift로 바뀌는 글자는 기본 자모와 같은 음 (Shift는 음에 영향을 주지 않는다).
const ALIAS = {
  ㅃ: 'ㅂ', ㅉ: 'ㅈ', ㄸ: 'ㄷ', ㄲ: 'ㄱ', ㅆ: 'ㅅ', ㅒ: 'ㅐ', ㅖ: 'ㅔ',
};

const bySemitone = (map) => Object.keys(map).sort((a, b) => map[a] - map[b]);

/** 화면의 음 배치 표용: 반음 순서(도부터)대로의 자모. */
export const KEY_LAYOUT = Object.freeze({
  melody: bySemitone(MELODY),
  accomp: bySemitone(ACCOMP),
  percussion: Object.entries(PERCUSSION).map(([jamo, name]) => ({ jamo, name })),
});

/** 같은 음을 내는 기본 자모 (ㅃ → ㅂ, ㅖ → ㅔ). */
export function baseJamo(jamo) {
  return ALIAS[jamo] ?? jamo;
}

/**
 * 자모 하나 → 소리.
 * 겹자모(ㅘ ㄼ 등)는 hangul.js에서 미리 분해해서 넘겨야 한다.
 *
 * @returns {{ type: 'note', midi: number, voice: 'melody' | 'accomp' }
 *         | { type: 'perc', name: string }
 *         | null}
 */
export function jamoToSound(jamo) {
  const key = baseJamo(jamo);
  if (key in MELODY) return { type: 'note', midi: MELODY_BASE + MELODY[key], voice: 'melody' };
  if (key in ACCOMP) return { type: 'note', midi: ACCOMP_BASE + ACCOMP[key], voice: 'accomp' };
  if (key in PERCUSSION) return { type: 'perc', name: PERCUSSION[key] };
  return null;
}

/** MIDI 음 번호 → 주파수(Hz). A4(69) = 440 */
export function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}
