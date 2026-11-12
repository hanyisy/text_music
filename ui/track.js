// 지표 수집 창구. 화면 코드는 이 함수 하나만 부른다.

export const EVENT = Object.freeze({
  SCORE_CREATE: 'score_create',  // 빈 입력창에서 첫 음을 침
  LINK_CREATE: 'link_create',    // 공유 링크를 만듦(링크 복사)
  LINK_OPEN: 'link_open',        // 공유 링크로 들어옴
});

/**
 * @param {string} name   EVENT 중 하나
 * @param {object} [props] 함께 남길 값
 */
// eslint-disable-next-line no-unused-vars
export function track(name, props = {}) {
  // 실제 전송은 아직 비워둠. 분석 도구가 정해지면 여기만 채우면 된다.
}
