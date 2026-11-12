// 기기 판별. 안내 문구를 띄울지 정하는 데만 쓴다.

/** 아이폰·아이패드(데스크톱 모드 포함) */
export function isIOS() {
  const { userAgent, platform, maxTouchPoints } = navigator;
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}
