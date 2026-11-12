// 화면 조립: 입력창 ↔ 엔진 ↔ 오디오를 잇는다.

import { parse } from '../engine/parser.js';
import { jamoToSound } from '../engine/keymap.js';
import { textToJamo } from '../engine/hangul.js';
import { Synth } from '../audio/synth.js';
import { Player } from '../audio/player.js';
import { Editor } from './editor.js';
import { copyText } from './clipboard.js';
import { isIOS, isTouchDevice } from './platform.js';
import { LONG_LINK_LENGTH, buildLink, decode, encodePlain, encodeShortest, readHashCode } from './share.js';
import { EVENT, track } from './track.js';

const $ = (id) => document.getElementById(id);
const playButton = $('play');
const stopButton = $('stop');
const statusLine = $('status');

const synth = new Synth();
const player = new Player(synth);

// ── 소리 켜기 ───────────────────────────────────────────
// AudioContext는 사용자 동작 안에서 resume()해야 한다. 전화·탭 전환 뒤 다시 멈출 수 있어 계속 걸어둔다.
for (const type of ['pointerdown', 'touchend', 'keydown']) {
  addEventListener(type, () => synth.unlock(), { capture: true, passive: true });
}

// ── 상태 안내 ───────────────────────────────────────────
let statusTimer = null;
function say(message, keep = false) {
  clearTimeout(statusTimer);
  statusLine.textContent = message;
  if (!keep) statusTimer = setTimeout(() => { statusLine.textContent = ''; }, 4000);
}

// ── 입력창 ──────────────────────────────────────────────
let hasNotes = false;

const editor = new Editor({
  input: $('score'),
  backdrop: $('score-backdrop'),
  onJamo(jamo) {
    for (const one of jamo) synth.play(jamoToSound(one));
  },
  onChange(text) {
    player.stop();
    setPlayLabel('play');
    refreshLink(text);

    const nowHasNotes = textToJamo(text).length > 0;
    if (nowHasNotes && !hasNotes) track(EVENT.SCORE_CREATE);
    hasNotes = nowHasNotes;
  },
});

// ── 재생 ────────────────────────────────────────────────
function setPlayLabel(name) {
  for (const label of playButton.querySelectorAll('[data-label]')) {
    label.hidden = label.dataset.label !== name;
  }
}

function setPlaying(playing) {
  playButton.hidden = playing;
  stopButton.hidden = !playing;
}

function play() {
  const score = parse(editor.text);
  if (!score.events.length) {
    say('먼저 아무 키나 쳐보세요.');
    return;
  }
  setPlaying(true);
  player.play(score, {
    onSegment: (segment) => editor.setHighlight(segment),
    onEnd: () => setPlaying(false),
  });
}

// ── 공유 ────────────────────────────────────────────────
// 클립보드는 클릭 즉시 써야 해서(사파리), 압축 링크는 입력이 멈출 때마다 미리 만들어 둔다.
let shortest = { text: null, code: null };
let linkTimer = null;

function refreshLink(text) {
  clearTimeout(linkTimer);
  linkTimer = setTimeout(async () => {
    const code = await encodeShortest(text);
    shortest = { text, code };
  }, 200);
}

async function copyScore() {
  const text = editor.text;
  if (!text) return say('복사할 악보가 아직 없어요.');
  say(await copyText(text) ? '악보를 복사했어요.' : '복사하지 못했어요. 직접 선택해서 복사해주세요.');
}

async function copyLink() {
  const text = editor.text;
  if (!text) return say('공유할 악보가 아직 없어요.');

  const code = shortest.text === text ? shortest.code : encodePlain(text);
  const link = buildLink(code);
  const copied = await copyText(link);
  history.replaceState(null, '', link);
  track(EVENT.LINK_CREATE, { length: link.length });

  if (!copied) {
    say('복사하지 못했어요. 주소창의 주소를 복사해주세요.', true);
  } else if (link.length > LONG_LINK_LENGTH) {
    say(`링크를 복사했어요. 다만 링크가 길어서(${link.length}자) 일부 메신저에서 잘릴 수 있어요. 그럴 땐 '악보 복사'를 써주세요.`, true);
  } else {
    say('링크를 복사했어요.');
  }
}

async function loadFromHash() {
  const code = readHashCode();
  if (!code) return;
  try {
    const text = await decode(code);
    player.stop();
    editor.setText(text);
    hasNotes = textToJamo(text).length > 0;
    shortest = { text, code };
    setPlayLabel('listen');
    track(EVENT.LINK_OPEN);
  } catch {
    say('링크의 악보를 읽지 못했어요. 링크가 중간에 잘렸을 수 있어요.', true);
  }
}

// ── 버튼 ────────────────────────────────────────────────
// pointerdown을 막아 포커스가 입력창에서 버튼으로 넘어가지 않게 한다(모바일 키보드 유지).
function bindButton(button, action) {
  button.addEventListener('pointerdown', (event) => event.preventDefault());
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', action);
}

bindButton(playButton, play);
bindButton(stopButton, () => player.stop());
bindButton($('copy-score'), copyScore);
bindButton($('copy-link'), copyLink);

// ── 기기별 안내 ─────────────────────────────────────────
$('notice-ios').hidden = !isIOS();
$('notice-keyboard').hidden = !isTouchDevice();

addEventListener('hashchange', loadFromHash);
loadFromHash();
