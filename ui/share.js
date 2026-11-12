// 서버 없는 공유: 악보 텍스트를 URL 해시에 담는다.
//
// 해시 형식:  #s=<버전>.<base64url>
//   1 = UTF-8 그대로
//   2 = UTF-8을 deflate-raw로 압축
// 이미 퍼진 링크가 계속 열려야 하므로, 형식을 바꿀 때는 기존 버전을 지우지 말고 새 번호를 추가한다.

const HASH_KEY = 's';
const VERSION_PLAIN = '1';
const VERSION_DEFLATE = '2';

/** 이보다 긴 링크는 일부 메신저·브라우저에서 잘릴 수 있다고 안내한다. */
export const LONG_LINK_LENGTH = 2000;

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded) {
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function throughStream(bytes, stream) {
  const piped = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

/** 압축 없이 바로 만드는 코드. 동기라서 클릭 즉시 쓸 수 있다. */
export function encodePlain(text) {
  return `${VERSION_PLAIN}.${toBase64Url(new TextEncoder().encode(text))}`;
}

/** 가능한 가장 짧은 코드. 압축을 못 쓰거나 이득이 없으면 encodePlain과 같다. */
export async function encodeShortest(text) {
  const plain = encodePlain(text);
  if (typeof CompressionStream === 'undefined') return plain;
  try {
    const packed = await throughStream(new TextEncoder().encode(text), new CompressionStream('deflate-raw'));
    const deflated = `${VERSION_DEFLATE}.${toBase64Url(packed)}`;
    return deflated.length < plain.length ? deflated : plain;
  } catch {
    return plain;
  }
}

/** @returns {Promise<string>} 악보 텍스트. 읽을 수 없으면 예외. */
export async function decode(code) {
  const dot = code.indexOf('.');
  const version = code.slice(0, dot);
  let bytes = fromBase64Url(code.slice(dot + 1));
  if (version === VERSION_DEFLATE) {
    bytes = await throughStream(bytes, new DecompressionStream('deflate-raw'));
  } else if (version !== VERSION_PLAIN) {
    throw new Error(`unknown share version: ${version}`);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function buildLink(code) {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}#${HASH_KEY}=${code}`;
}

/** 현재 주소의 해시에 담긴 코드. 없으면 null. */
export function readHashCode() {
  return new URLSearchParams(location.hash.slice(1)).get(HASH_KEY);
}
