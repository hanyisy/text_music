import { test } from 'node:test';
import assert from 'node:assert/strict';

import { charToJamo, textToJamo, composeJamo, convertLatin } from '../engine/hangul.js';
import { jamoToSound, KEY_LAYOUT } from '../engine/keymap.js';
import { addedJamo, JamoTracker } from '../engine/diff.js';
import { parse, tokenize, withTempo, TOKEN } from '../engine/parser.js';
import { parseLyricCells } from '../engine/lyrics.js';
import { distributeLyrics, scoreLineAt, setLyricLine } from '../engine/lyric-fill.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);

// ── hangul ──────────────────────────────────────────────

// 주의: 쀎(U+C00E)의 받침은 ㄻ(ㄹ+ㅁ)이다. 받침이 ㄼ(ㄹ+ㅂ)인 글자는 바로 옆의 쀏(U+C00F).
test('쀎 → ㅃ ㅜ ㅔ ㄹ ㅁ, 쀏 → ㅃ ㅜ ㅔ ㄹ ㅂ (5음)', () => {
  assert.deepEqual(charToJamo('쀎'), ['ㅃ', 'ㅜ', 'ㅔ', 'ㄹ', 'ㅁ']);
  assert.deepEqual(charToJamo('쀏'), ['ㅃ', 'ㅜ', 'ㅔ', 'ㄹ', 'ㅂ']);
});

test('낱자모·겹자모·한글 아닌 글자 분해', () => {
  assert.deepEqual(charToJamo('ㄱ'), ['ㄱ']);
  assert.deepEqual(charToJamo('ㄳ'), ['ㄱ', 'ㅅ']);
  assert.deepEqual(charToJamo('ㅘ'), ['ㅗ', 'ㅏ']);
  assert.deepEqual(charToJamo('1'), []);
  assert.deepEqual(textToJamo('가1나'), ['ㄱ', 'ㅏ', 'ㄴ', 'ㅏ']);
});

test('composeJamo: 분해의 역연산 + 도깨비불', () => {
  assert.equal(composeJamo(['ㅃ', 'ㅜ', 'ㅔ', 'ㄹ', 'ㅂ']), '쀏');
  assert.equal(composeJamo(['ㄱ', 'ㅏ', 'ㄱ', 'ㅏ']), '가가');
  assert.equal(composeJamo(['ㄷ', 'ㅏ', 'ㄹ', 'ㄱ', 'ㅏ']), '달가');
  assert.equal(composeJamo(['ㄱ', 'ㄱ', 'ㅏ', 'ㅏ']), 'ㄱ가ㅏ');
  assert.equal(composeJamo(['ㄱ', 'ㅏ', 'ㄸ']), '가ㄸ');
  for (const ch of '쀎쀏뷁괴문자값읽') assert.equal(composeJamo(charToJamo(ch)), ch);
});

test('convertLatin: 두벌식 영문 → 한글', () => {
  assert.equal(convertLatin('rksk').text, '가나');
  assert.equal(convertLatin('Qnpfa').text, '쀎');
  assert.equal(convertLatin('Qnpfq').text, '쀏');
  assert.deepEqual(convertLatin('가나'), { text: '가나', caret: 2, composeEnd: -1 });
});

test('convertLatin: 한 글자씩 칠 때 앞 글자와 이어서 조합', () => {
  let state = { text: '', caret: 0, composeEnd: -1 };
  for (const key of 'rkrk') {
    const typed = state.text.slice(0, state.caret) + key + state.text.slice(state.caret);
    state = convertLatin(typed, state.caret + 1, state.composeEnd);
  }
  assert.deepEqual(state, { text: '가가', caret: 2, composeEnd: 2 });
});

test('convertLatin: 숫자·기호가 끼면 조합이 끊긴다', () => {
  assert.equal(convertLatin('r1k').text, 'ㄱ1ㅏ');
  // 조합 중이 아닌 위치(composeEnd 불일치)에서는 앞 글자와 합치지 않는다
  assert.equal(convertLatin('각k', 2, -1).text, '각ㅏ');
  assert.equal(convertLatin('각k', 2, 1).text, '가가');
});

test('convertLatin: 가운데에 쳐도 커서가 제자리', () => {
  assert.deepEqual(convertLatin('가rk나', 3, -1), { text: '가가나', caret: 2, composeEnd: 2 });
});

// ── keymap ──────────────────────────────────────────────

test('keymap: 모음 = C4~B4, 자음 = C3~B3, 쌍자음은 기본 자모와 같은 음', () => {
  assert.deepEqual(jamoToSound('ㅗ'), { type: 'note', midi: 60, voice: 'melody' });
  assert.deepEqual(jamoToSound('ㅡ'), { type: 'note', midi: 71, voice: 'melody' });
  assert.deepEqual(jamoToSound('ㅁ'), { type: 'note', midi: 48, voice: 'accomp' });
  assert.deepEqual(jamoToSound('ㅌ'), { type: 'note', midi: 59, voice: 'accomp' });
  assert.deepEqual(jamoToSound('ㅃ'), jamoToSound('ㅂ'));
  assert.deepEqual(jamoToSound('ㅖ'), jamoToSound('ㅔ'));
  assert.equal(jamoToSound('ㅊ').type, 'perc');
  assert.equal(jamoToSound('ㅍ').type, 'perc');
  assert.equal(jamoToSound('a'), null);
});

test('keymap: 음 배치 표는 도부터 반음 순서', () => {
  assert.equal(KEY_LAYOUT.melody.join(''), 'ㅗㅛㅓㅕㅏㅣㅑㅠㅐㅜㅔㅡ');
  assert.equal(KEY_LAYOUT.accomp.join(''), 'ㅁㅂㄴㅈㅇㄹㄷㅎㄱㅋㅅㅌ');
  assert.deepEqual(KEY_LAYOUT.percussion.map((p) => p.jamo), ['ㅊ', 'ㅍ']);
});

// ── diff ────────────────────────────────────────────────

test('diff: "각" → "가가" 추가 자모 = [ㅏ] (도깨비불)', () => {
  assert.deepEqual(addedJamo('각', '가가'), ['ㅏ']);
});

test('diff: "구" → "궤" 추가 자모 = [ㅔ]', () => {
  assert.deepEqual(addedJamo('구', '궤'), ['ㅔ']);
});

test('diff: 지우기·기호 입력은 음 없음, 가운데 입력은 그 자모만', () => {
  assert.deepEqual(addedJamo('가나', '가'), []);
  assert.deepEqual(addedJamo('가', '가1'), []);
  assert.deepEqual(addedJamo('가다', '가나다'), ['ㄴ', 'ㅏ']);
});

test('diff: 메타 칸(제목)과 가사 줄을 치는 동안은 음 없음', () => {
  assert.deepEqual(addedJamo('{작', '{작으'), []);
  assert.deepEqual(addedJamo('{작은별', '{작은별}'), []);
  assert.deepEqual(addedJamo('{작은별}', '{작은별}가'), ['ㄱ', 'ㅏ']);
  assert.deepEqual(addedJamo('가\n;반', '가\n;반짝'), []);
  assert.deepEqual(addedJamo('가\n;반짝\n', '가\n;반짝\n나'), ['ㄴ', 'ㅏ']);
});

test('JamoTracker: 입력기가 받침을 잠깐 뺐다 넣어도 ㅏ 하나만', () => {
  const tracker = new JamoTracker('각');
  assert.deepEqual(tracker.update('가', 1000), []);
  assert.deepEqual(tracker.update('가가', 1001), ['ㅏ']);
  // 시간이 지난 뒤 다시 치는 건 새 음
  assert.deepEqual(tracker.update('가', 2000), []);
  assert.deepEqual(tracker.update('각', 3000), ['ㄱ']);
});

// ── parser ──────────────────────────────────────────────

test('parser: "{120}가나,각"', () => {
  const { tempo, duration, events, segments } = parse('{120}가나,각');
  assert.equal(tempo, 120);
  near(duration, 2);
  assert.deepEqual(events.map((e) => e.jamo), ['ㄱ', 'ㅏ', 'ㄴ', 'ㅏ', 'ㄱ', 'ㅏ', 'ㄱ']);

  // 가: 0~0.5초 (ㄱ·ㅏ 각 0.25초)
  near(events[0].time, 0); near(events[0].duration, 0.25);
  near(events[1].time, 0.25); near(events[1].duration, 0.25);
  // 나: 0.5~1.0초
  near(events[2].time, 0.5); near(events[3].time, 0.75);
  // 쉼: 1.0~1.5초 → 각: 1.5~2.0초 (3음 균등)
  [4, 5, 6].forEach((i, n) => {
    near(events[i].time, 1.5 + (0.5 / 3) * n);
    near(events[i].duration, 0.5 / 3);
  });

  assert.deepEqual(events[0].sound, { type: 'note', midi: 56, voice: 'accomp' });
  assert.deepEqual(events[1].sound, { type: 'note', midi: 64, voice: 'melody' });
  assert.deepEqual([events[0].start, events[0].end], [5, 6]);
  assert.deepEqual(segments.map((s) => [s.type, s.time, s.start]), [
    ['glyph', 0, 5], ['glyph', 0.5, 6], ['rest', 1, 7], ['glyph', 1.5, 8],
  ]);
});

test('parser: "가-" → ㄱ 0.25초, ㅏ 0.25+0.5초 (—도 동일)', () => {
  for (const text of ['가-', '가—']) {
    const { events, duration } = parse(text);
    near(events[0].duration, 0.25);
    near(events[1].time, 0.25);
    near(events[1].duration, 0.75);
    near(duration, 1);
  }
});

test('parser: "가1나" → 1 때문에 조합이 끊긴 두 글자, 1은 시간 없음', () => {
  const { events, segments, duration } = parse('가1나');
  assert.equal(segments.length, 2);
  near(events[2].time, 0.5);
  near(duration, 1);
  assert.deepEqual([events[2].start, events[2].end], [2, 3]);

  // 낱자모도 한 글자 = 한 박: ㄱ1ㅏ 는 "가"로 합쳐지지 않는다
  const split = parse('ㄱ1ㅏ');
  near(split.events[0].duration, 0.5);
  near(split.events[1].time, 0.5);
});

test('parser: 템포 기본값 120, 맨 앞 {템포}만 적용', () => {
  assert.equal(parse('가').tempo, 120);
  near(parse('{60}가').duration, 1);
  near(parse('{작은별}{60}{4/4}가').duration, 1);
  near(parse('가{60}나').duration, 1); // 중간 템포 변경은 아직 건너뜀
});

test('parser: 제목과 글자 수', () => {
  const score = parse('{작은별}{100}{4/4}\n가나,각-');
  assert.equal(score.title, '작은별');
  assert.equal(score.glyphCount, 3);
  assert.equal(score.events.length, 7);
  assert.equal(parse('가').title, '');
});

test('parser: 닫지 않은 { 는 줄 끝까지 메타 칸', () => {
  near(parse('가{작은\n나').duration, 1);
  assert.equal(parse('{작은').events.length, 0);
});

test('withTempo: 맨 앞 템포를 바꾸거나 넣는다', () => {
  assert.equal(withTempo('{120}가', 100), '{100}가');
  assert.equal(withTempo('{작은별}{120}{4/4}\n가', 90), '{작은별}{90}{4/4}\n가');
  assert.equal(withTempo('{작은별}\n가', 90), '{작은별}{90}\n가');
  assert.equal(withTempo('가{80}나', 90), '{90}가{80}나');
  assert.equal(parse(withTempo('가나', 60)).tempo, 60);
});

test('parser: 공백·줄바꿈·마디선은 시간 없음, 미구현 표기는 오류 없이 건너뜀', () => {
  near(parse('가 나\n| 다 |').duration, 1.5);
  const score = '{작은별}{120:8}{4/4}\n{트랙1}\n!1가^2나,|:[각]:|33 0 9\n;반짝/작은/별--|\n{트랙2}\n#ㅁ,ㅇ-|~*{';
  const { events, duration } = parse(score);
  near(duration, 4 * 0.5 + 4 * 0.5);
  assert.equal(events.length, 2 + 2 + 3 + 1 + 1);
});

test('parser: 쉼표 뒤의 - 는 쉼을 늘이고, ㅊ ㅍ은 타악', () => {
  const { events, duration } = parse('가,-ㅊ');
  near(events[1].duration, 0.25);
  near(duration, 2);
  assert.equal(events[2].sound.type, 'perc');
});

test('tokenize: 표기 규칙 전체를 토큰으로', () => {
  const types = (text) => tokenize(text).map((t) => t.type);
  assert.deepEqual(types('1 11 0 4'), [
    TOKEN.OCTAVE, TOKEN.SPACE, TOKEN.OCTAVE, TOKEN.SPACE, TOKEN.OCTAVE, TOKEN.SPACE, TOKEN.RESERVED_DIGIT,
  ]);
  assert.deepEqual(tokenize('1 22').filter((t) => t.type === TOKEN.OCTAVE).map((t) => t.shift), [1, -2]);
  assert.deepEqual(types('|:가:||'), [TOKEN.REPEAT_START, TOKEN.GLYPH, TOKEN.REPEAT_END, TOKEN.BAR]);
  assert.deepEqual(types('!^3[가]'), [TOKEN.INSTRUMENT, TOKEN.DYNAMIC, TOKEN.CHORD_START, TOKEN.GLYPH, TOKEN.CHORD_END]);
  assert.deepEqual(types('가\n;가/나'), [TOKEN.GLYPH, TOKEN.NEWLINE, TOKEN.LYRIC]);
  assert.deepEqual(types('가;'), [TOKEN.GLYPH, TOKEN.UNKNOWN]);
  assert.deepEqual(
    ['120', '120:8', '4/4', '트랙2:4', '작은별'].map((body) => tokenize(`{${body}}`)[0].meta.kind),
    ['tempo', 'tempoUnit', 'timeSignature', 'track', 'title'],
  );
});

// ── 가사 ────────────────────────────────────────────────

const sung = (score) => score.events.map((e) => (e.lyric ? (e.lyric.type === 'extend' ? '-' : e.lyric.text) : '.')).join('');

test('가사: "가나,각" + ";반짝/작은/별--"', () => {
  const score = parse('가나,각\n;반짝/작은/별--');
  assert.deepEqual(score.events.map((e) => e.jamo), ['ㄱ', 'ㅏ', 'ㄴ', 'ㅏ', 'ㄱ', 'ㅏ', 'ㄱ']);
  assert.equal(sung(score), '반짝작은별--');
  assert.deepEqual(score.warnings, []);
  near(score.duration, 2); // 가사 줄은 연주하지 않는다

  // 음절은 원문 위치를, 연장은 이어 부르는 음절을 안다
  assert.deepEqual(score.events[0].lyric, { type: 'syllable', text: '반', start: 6, end: 7 });
  assert.deepEqual(score.events[5].lyric, { type: 'extend', text: '별', start: 13, end: 14 });
  assert.deepEqual(score.lyrics[0].cells.map((c) => c.glyphStart), [0, 1, 3]);
});

test('가사: 칸이 하나 모자라면 경고 1개, 나머지는 정상 정렬', () => {
  const score = parse('가나,각\n;반짝/작은');
  assert.equal(sung(score), '반짝작은...');
  assert.deepEqual(score.warnings, [{ type: 'cells-missing', count: 1, start: 3, end: 4 }]);
});

test('가사: 칸이 남거나 음절 수가 안 맞아도 멈추지 않고 경고', () => {
  const extra = parse('가나\n;반짝/작은/별');
  assert.equal(sung(extra), '반짝작은');
  assert.deepEqual(extra.warnings.map((w) => [w.type, w.count]), [['cells-extra', 1]]);

  // 음절이 모자라면 앞 음절을 이어 부르고, 넘치면 버린다
  const uneven = parse('각나\n;별/작은별');
  assert.equal(sung(uneven), '별--작은');
  assert.deepEqual(uneven.warnings, [
    { type: 'syllables-missing', count: 2, start: 0, end: 1 },
    { type: 'syllables-extra', count: 1, start: 1, end: 2 },
  ]);
  assert.equal(uneven.events[1].lyric.start, null);
});

test('가사: 마디선·빈 칸·늘임표', () => {
  // | 는 칸을 나누지만 빈 칸을 만들지 않는다
  for (const lyric of [';반짝/작은|별--|', ';반짝/작은/|별--|', ';|반짝/작은|/별--']) {
    const score = parse(`가나|각|\n${lyric}`);
    assert.equal(sung(score), '반짝작은별--', lyric);
    assert.deepEqual(score.warnings, [], lyric);
  }
  // // = 가사 없는 글자, 악보의 - 는 음이 아니라 칸이 없다, 칸 안의 공백은 보기용
  const score = parse('가나-다\n;반 짝//별-');
  assert.equal(sung(score), '반짝..별-');
  assert.deepEqual(score.warnings, []);
  assert.deepEqual(parseLyricCells('').length, 0);
  assert.deepEqual(parseLyricCells('가/').length, 1);
});

test('가사: 줄 짝짓기 — 바로 위 악보 줄, 여러 절, 악보 없는 가사 줄', () => {
  const score = parse('{작은별}\n가나\n;반짝/작은\n;별별/달달\n\n다\n;해-');
  assert.equal(sung(score), '반짝작은해-');
  assert.deepEqual(score.lyrics.map((l) => l.verse), [0, 1, 0]);
  assert.deepEqual(score.warnings, []);

  const orphan = parse(';반짝\n가');
  assert.equal(sung(orphan), '..');
  assert.deepEqual(orphan.warnings.map((w) => [w.type, w.start]), [['no-score-line', 0]]);
  assert.equal(parse('{작은별}\n;반짝').warnings[0].type, 'no-score-line');
});

test('자동 분배: "가나,각" + "반짝작은별" → ";반짝/작은/별--"', () => {
  assert.deepEqual(distributeLyrics('가나,각', '반짝작은별'), { line: ';반짝/작은/별--', used: 5, warnings: [] });
  assert.equal(distributeLyrics('가나,각', '반짝 작은 별').line, ';반짝/작은/별--');
});

test('자동 분배: 음절이 2개 넘치면 경고에 2개', () => {
  // 음 7개에 음절 9개
  const result = distributeLyrics('가나,각', '반짝반짝작은별이야');
  assert.equal(result.line, ';반짝/반짝/작은별');
  assert.deepEqual(result.warnings, [{ type: 'syllables-extra', count: 2, text: '이야' }]);
});

test('자동 분배: 마디선을 따라 적고, 가사가 모자라면 채운 데까지만', () => {
  assert.equal(distributeLyrics('|가나|각-|', '반짝작은별').line, ';|반짝/작은|별--|');
  assert.equal(distributeLyrics('가나|각', '반짝작').line, ';반짝/작-');
  assert.equal(distributeLyrics('!1가^2나', '반짝작은').line, ';반짝/작은');
  // 만든 줄은 다시 읽어도 어긋나지 않는다
  assert.deepEqual(parse('|가나|각-|\n;|반짝/작은|별--|').warnings, []);
});

test('가사 넣기: 커서가 있는 악보 줄 아래에 넣거나 바꾼다', () => {
  const text = '{작은별}\n가나,각\n다라';
  assert.equal(scoreLineAt(text, 0), null);
  assert.deepEqual(scoreLineAt(text, 8), { index: 1, text: '가나,각', glyphs: 3, notes: 7 });

  const added = setLyricLine(text, 8, '반짝작은별');
  assert.equal(added.text, '{작은별}\n가나,각\n;반짝/작은/별--\n다라');
  assert.equal(added.text.slice(0, added.caret), '{작은별}\n가나,각\n;반짝/작은/별--');

  // 가사 줄에 커서가 있어도 그 위 악보 줄의 가사를 바꾼다
  const replaced = setLyricLine(added.text, added.caret, '별별달달해');
  assert.equal(replaced.text, '{작은별}\n가나,각\n;별별/달달/해--\n다라');
  assert.equal(setLyricLine(text, 0, '반짝').ok, false);
});
