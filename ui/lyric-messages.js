// 엔진이 돌려준 가사 경고(종류 + 개수 + 위치)를 사람이 읽는 문구로 바꾼다.

/**
 * @param {import('../engine/lyrics.js').LyricWarning} warning
 * @param {string} text  악보 텍스트(어느 글자인지 보여주는 데 쓴다)
 */
export function lyricWarningMessage(warning, text) {
  const { type, count } = warning;
  const glyph = text.slice(warning.start, warning.end);
  switch (type) {
    case 'cells-missing':
      return `'${glyph}'부터 가사 칸이 ${count}개 모자라요.`;
    case 'cells-extra':
      return `가사 칸이 ${count}개 남아요: ${glyph}`;
    case 'syllables-missing':
      return `'${glyph}': 음절이 ${count}개 모자라요. 남은 음은 앞 음절을 이어 불러요.`;
    case 'syllables-extra':
      return `'${glyph}': 음절이 ${count}개 넘쳐요. 넘친 음절은 부르지 않아요.`;
    case 'no-score-line':
      return '바로 위에 악보 줄이 없는 가사 줄이에요.';
    default:
      return '';
  }
}
