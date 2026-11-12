/** 텍스트를 클립보드에 복사. 성공 여부를 돌려준다. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

// 클립보드 API가 막힌 환경(http, 일부 인앱 브라우저)용
function legacyCopy(text) {
  const active = document.activeElement;
  const holder = document.createElement('textarea');
  holder.value = text;
  holder.setAttribute('readonly', '');
  holder.style.position = 'fixed';
  holder.style.opacity = '0';
  document.body.append(holder);
  holder.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  holder.remove();
  active?.focus?.();
  return ok;
}
