// 화면 조립: 입력창 ↔ 엔진 ↔ 오디오 ↔ 악보 표시를 잇는다.

import { parse, withTempo } from '../engine/parser.js';
import { scoreLineAt, setLyricLine } from '../engine/lyric-fill.js';
import { jamoToSound } from '../engine/keymap.js';
import { Synth } from '../audio/synth.js';
import { Player } from '../audio/player.js';
import { Editor } from './editor.js';
import { ScoreView } from './score-view.js';
import { KeymapView } from './keymap-view.js';
import { lyricWarningMessage } from './lyric-messages.js';
import { copyText } from './clipboard.js';
import { isIOS } from './platform.js';
import { LONG_LINK_LENGTH, buildLink, decode, encodePlain, encodeShortest, readHashCode } from './share.js';
import { EVENT, track } from './track.js';

// 저작권이 끝난 동요. 자음(반주, 한 옥타브 아래) + 모음(멜로디)으로 한 글자가 8분음표 둘.
const EXAMPLE = '{작은별}{100}\n모모휴휴|쿠쿠휴-|리리아아|너너모-|\n휴휴리리|아아너-|휴휴리리|아아너-|\n모모휴휴|쿠쿠휴-|리리아아|너너모-|';

const $ = (id) => document.getElementById(id);
const playButton = $('play');
const stopButton = $('stop');

const synth = new Synth();
const player = new Player(synth);
const keymapView = new KeymapView($('keymap'));
const scoreView = new ScoreView({ lines: $('score-lines'), empty: $('score-empty'), title: $('score-title') });

// ── 소리 켜기 ───────────────────────────────────────────
// AudioContext는 사용자 동작 안에서 resume()해야 한다. 전화·탭 전환 뒤 다시 멈출 수 있어 계속 걸어둔다.
for (const type of ['pointerdown', 'touchend', 'keydown']) {
  addEventListener(type, () => synth.unlock(), { capture: true, passive: true });
}

// ── 입력창 ──────────────────────────────────────────────
const TEMPO_STEP = 10;
const TEMPO_BUTTON_MIN = 40;
const TEMPO_BUTTON_MAX = 240;

let score = parse('');
let expanded = false;   // 펼쳐보기

function renderScore() {
  const text = editor.text;
  const warnings = score.warnings.map((warning) => ({
    start: warning.start,
    message: lyricWarningMessage(warning, text),
  }));
  scoreView.render(text, score, { expanded, warnings });

  const list = $('warnings');
  list.hidden = warnings.length === 0;
  list.replaceChildren(...warnings.map(({ message }) => {
    const item = document.createElement('li');
    item.textContent = message;
    return item;
  }));
}

const editor = new Editor({
  input: $('score-input'),
  onChange(text) {
    const hadNotes = score.events.length > 0;
    player.stop();
    score = parse(text);
    renderScore();
    $('tempo').textContent = `${score.tempo} BPM`;
    $('stats').textContent = score.glyphCount
      ? `음 ${score.events.length}개 · ${score.glyphCount}글자 · ${score.tempo} BPM`
      : `${score.tempo} BPM`;
    refreshLink(text);
    showLyricTarget();
    if (!hadNotes && score.events.length > 0 && !loading) track(EVENT.SCORE_CREATE);
  },
  onJamo(jamo, caret) {
    for (const one of jamo) synth.play(jamoToSound(one));
    keymapView.light(jamo.at(-1));
    scoreView.flash(caret - 1);
    $('notice-link').hidden = true;
  },
});

// ── 재생 ────────────────────────────────────────────────
function setPlaying(playing) {
  playButton.hidden = playing;
  stopButton.hidden = !playing;
}

function play() {
  if (!score.events.length) return;
  setPlaying(true);
  player.play(score, {
    onSegment: (segment) => scoreView.setActive(segment),
    onEvent: (event) => scoreView.setSinging(event?.lyric ?? null),
    onEnd: () => setPlaying(false),
  });
}

// ── 가사 넣기 ───────────────────────────────────────────
// 입력창에서 커서가 있는 악보 줄이 대상. 가사를 쭉 치면 음 하나에 한 음절씩 나눠 그 줄 아래에 넣는다.
function showLyricTarget() {
  const target = scoreLineAt(editor.text, editor.caret);
  $('lyric-target').textContent = target
    ? `선택한 줄: ${target.text} (음 ${target.notes}개)`
    : '가사를 붙일 악보 줄에 커서를 두세요.';
}

function applyLyrics() {
  const input = $('lyric-input');
  const status = $('lyric-status');
  if (!input.value.trim()) return;

  const result = setLyricLine(editor.text, editor.caret, input.value);
  if (!result.ok) {
    status.textContent = '가사를 붙일 악보 줄에 커서를 먼저 두세요.';
    return;
  }
  load(result.text, result.caret);
  input.value = '';
  const [overflow] = result.warnings;
  status.textContent = overflow
    ? `가사를 넣었어요. 음보다 ${overflow.count}음절이 넘쳐서 뺐어요: ${overflow.text}`
    : '가사를 넣었어요.';
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

function showShare(label, value, message) {
  $('share-label').textContent = label;
  $('share-message').textContent = message;
  $('share-value').value = value;
  $('share').hidden = false;
}

async function copyScore() {
  const text = editor.text;
  if (!text) return;
  const copied = await copyText(text);
  showShare('악보 텍스트', text, copied
    ? '클립보드에 복사됐어요.'
    : '브라우저가 복사를 막았어요. 아래 칸을 눌러 직접 복사해주세요.');
}

async function copyLink() {
  const text = editor.text;
  if (!text) return;

  const code = shortest.text === text ? shortest.code : encodePlain(text);
  const link = buildLink(code);
  const copied = await copyText(link);
  history.replaceState(null, '', link);
  track(EVENT.LINK_CREATE, { length: link.length });

  let message = copied
    ? '클립보드에 복사됐어요.'
    : '브라우저가 복사를 막았어요. 아래 칸을 눌러 직접 복사해주세요.';
  if (link.length > LONG_LINK_LENGTH) {
    message += ` 링크가 길어서(${link.length}자) 일부 메신저에서 잘릴 수 있어요. 그럴 땐 텍스트 복사를 써주세요.`;
  }
  showShare('공유 링크', link, message);
}

let loading = false;    // 불러온 악보는 "악보 생성"으로 세지 않는다

function load(text, caret) {
  loading = true;
  editor.setText(text, caret);
  loading = false;
}

async function loadFromHash() {
  const code = readHashCode();
  if (!code) return;
  const notice = $('notice-link');
  try {
    const text = await decode(code);
    load(text);
    shortest = { text, code };
    notice.textContent = '공유받은 악보예요. 아래 들어보기를 누르면 재생돼요.';
    track(EVENT.LINK_OPEN);
  } catch {
    notice.textContent = '링크의 악보를 읽지 못했어요. 링크가 중간에 잘렸을 수 있어요.';
  }
  notice.hidden = false;
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
bindButton($('example'), () => {
  load(EXAMPLE);
  $('notice-link').hidden = true;
});
bindButton($('clear'), () => {
  load('');
  $('share').hidden = true;
  $('notice-link').hidden = true;
});
bindButton($('tempo-down'), () => load(withTempo(editor.text, Math.max(TEMPO_BUTTON_MIN, score.tempo - TEMPO_STEP))));
bindButton($('tempo-up'), () => load(withTempo(editor.text, Math.min(TEMPO_BUTTON_MAX, score.tempo + TEMPO_STEP))));

// 켜고 끄는 버튼
function bindToggle(button, apply) {
  bindButton(button, () => {
    const on = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(on));
    apply(on);
  });
}

bindToggle($('toggle-expand'), (on) => {
  expanded = on;
  renderScore();
});
bindToggle($('toggle-lyrics'), (on) => {
  $('lyrics').hidden = !on;
  if (on) showLyricTarget();
});
bindButton($('lyric-apply'), applyLyrics);
$('lyric-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    applyLyrics();
  }
});
document.addEventListener('selectionchange', () => {
  if (document.activeElement === $('score-input')) showLyricTarget();
});

bindToggle($('toggle-rules'), (on) => {
  $('rules').hidden = !on;
  $('score').classList.toggle('score--codes', on);
});

bindButton($('share-close'), () => { $('share').hidden = true; });
$('share-value').addEventListener('focus', (event) => event.target.select());

// ── 기기별 안내 ─────────────────────────────────────────
$('notice-ios').hidden = !isIOS();

addEventListener('hashchange', loadFromHash);
editor.setText('');
loadFromHash();
