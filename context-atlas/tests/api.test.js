// 서버를 임시 데이터 폴더로 띄워 실제 HTTP로 검증한다.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { computeStats } from '../server/model.js';
import { freshDb } from '../server/store.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE_IDS = ['W13', 'W14', 'W15', 'W16', 'W17', 'W18', 'W19', 'W20', 'N02', 'N03', 'N04'];
let server; let base; let dir;

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { 'content-type': 'application/json', 'x-atlas-request': '1', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}
const anon = client(); const admin = client(); const alice = client(); const bob = client();

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'));
  const app = createApp({ dataDir: dir, rateLimit: false, admin: { handle: 'editor', password: 'correct-horse-battery' } });
  server = app.server();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await admin('POST', '/api/auth/login', { handle: 'editor', password: 'correct-horse-battery' })).status, 200);
  assert.equal((await alice('POST', '/api/auth/register', { handle: 'alice', password: 'alice-password-1' })).status, 200);
  assert.equal((await bob('POST', '/api/auth/register', { handle: 'bob', password: 'bob-password-12' })).status, 200);
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('초기 자료 50건 중 추가 조사 11건은 비공개, 39건만 공개', async () => {
  const { body } = await anon('GET', '/api/entries');
  assert.equal(body.total_public, 39);
  const ids = body.items.map((e) => e.id);
  for (const id of PRIVATE_IDS) assert.ok(!ids.includes(id), `${id} must not be public`);
  assert.equal((await admin('GET', '/api/admin/entries')).body.items.length, 50);
});

test('공개/비공개 분리: 상세·통계·연결·검색·패싯 어디에도 비공개 항목이 새지 않는다', async () => {
  assert.equal((await anon('GET', '/api/entries/W13')).status, 404);
  assert.equal((await alice('GET', '/api/entries/W13')).status, 404);
  assert.equal((await admin('GET', '/api/entries/W13')).status, 200);
  assert.equal((await anon('GET', `/api/entries?q=${encodeURIComponent('틀딱')}`)).body.count, 0);
  assert.equal((await anon('GET', `/api/entries?q=${encodeURIComponent('小姐')}`)).body.count, 0);
  const raw = JSON.stringify([(await anon('GET', '/api/entries')).body, (await anon('GET', '/api/stats')).body, (await anon('GET', '/api/facets')).body]);
  for (const t of ['틀딱', '급식충', '김치녀', 'sudaca', 'maricón', '外人', '小姐']) assert.ok(!raw.includes(t), `leak: ${t}`);
  const f = (await anon('GET', '/api/facets')).body;
  assert.ok(!f.language.some((x) => x.key === 'es' && x.count > 1), 'es has only the published sentence');
  assert.ok(!f.region.some((x) => ['GB', 'GH', 'ES'].includes(x.key)));
});

test('비공개 초안은 프런트엔드 번들(public/)에 들어 있지 않다', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]));
  const bundle = walk(path.join(ROOT, 'public')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const t of ['틀딱', '급식충', '김치녀', 'sudaca', 'maricón', '만자']) assert.ok(!bundle.includes(t), `bundle leak: ${t}`);
});

test('필터 복합 적용과 빈 검색 결과', async () => {
  const q = async (s) => (await anon('GET', `/api/entries?${s}`)).body;
  const koGender = await q('language=ko&topic=gender');
  assert.ok(koGender.count > 0);
  assert.ok(koGender.items.every((e) => e.language === 'ko' && e.topics.includes('gender')));
  const narrowed = await q('language=ko&topic=gender&type=word');
  assert.deepEqual(narrowed.items.map((e) => e.id).sort(), ['W01', 'W03']);
  const cls = await q('classification=cultural_misunderstanding');
  assert.deepEqual(cls.items.map((e) => e.id).sort(), ['N06', 'W10']);
  const multi = await q('language=ja,zh&type=word');
  assert.deepEqual(multi.items.map((e) => e.id).sort(), ['W10', 'W11', 'W12']);
  assert.equal((await q('language=ja&topic=disability')).count, 0);
  const empty = await q(`q=${encodeURIComponent('존재하지않는검색어zz')}`);
  assert.equal(empty.count, 0); assert.deepEqual(empty.items, []); assert.equal(empty.total_public, 39);
  assert.deepEqual((await q('protected=1')).items.map((e) => e.id).sort(), ['W01', 'W10']);
  assert.equal((await q('q=WHEELCHAIR')).items[0].id, 'W04');
});

test('분류는 단어가 아니라 개별 용법에 붙는다', async () => {
  const { entry } = (await anon('GET', '/api/entries/W01')).body;
  assert.equal(entry.classification, undefined);
  assert.equal(entry.usages.find((u) => u.id === 'W01-u1').classification, 'neutral_in_context');
  assert.ok(entry.usages.length >= 2);
});

test('원문은 화면 언어와 독립적으로 보존되고 번역 상태가 따로 관리된다', async () => {
  const { entry, sources } = (await anon('GET', '/api/entries/W10')).body;
  assert.equal(entry.original_text, '那个'); assert.equal(entry.language, 'zh');
  assert.equal(entry.content_lang, 'ko'); assert.ok(entry.neutral_meaning.ko && entry.neutral_meaning.en);
  assert.equal(entry.translation_status.en, 'draft_unreviewed'); assert.equal(entry.translation_status.ja, 'none');
  assert.equal(entry.neutral_meaning.ja, undefined, '근거 없이 채운 번역이 없어야 한다');
  assert.deepEqual(sources.map((s) => s.id), ['S13', 'S14']);
  assert.notEqual(entry.source_check_status, undefined); assert.notEqual(entry.local_review_status, undefined);
  assert.equal(entry.local_review_status, 'not_reviewed', '출처 확인이 현지 검토 완료를 뜻하지 않는다');
});

test('수정 권한: 비로그인 401, 일반 이용자 403, 관리자만 가능', async () => {
  const patch = { patch: { publication_status: 'draft' }, reason: 'x' };
  assert.equal((await anon('PUT', '/api/admin/entries/W02', patch)).status, 401);
  assert.equal((await alice('PUT', '/api/admin/entries/W02', patch)).status, 403);
  for (const url of ['/api/admin/entries', '/api/admin/export', '/api/admin/users', '/api/admin/reports', '/api/admin/experiences', '/api/admin/contributions', '/api/admin/audit']) {
    assert.equal((await anon('GET', url)).status, 401, url);
    assert.equal((await alice('GET', url)).status, 403, url);
  }
  assert.equal((await alice('POST', '/api/admin/import', { format: 'context-atlas', schema_version: 1, entries: [] })).status, 403);
  assert.equal((await alice('PUT', '/api/admin/settings', { site_name: 'x' })).status, 403);
  const noHeader = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
  assert.equal(noHeader.status, 403);
});

test('추가 조사·권리 불명확 항목은 관리자도 바로 공개할 수 없다', async () => {
  const r1 = await admin('PUT', '/api/admin/entries/W13', { patch: { publication_status: 'published' }, reason: 'try' });
  assert.equal(r1.status, 409); assert.deepEqual(r1.body.blockers, ['needs_research']);
  const r2 = await admin('PUT', '/api/admin/entries/N02', { patch: { publication_status: 'published' }, reason: 'try' });
  assert.deepEqual(r2.body.blockers.sort(), ['needs_research', 'rights_unclear']);
  assert.equal((await anon('GET', '/api/entries/W13')).status, 404);
});

test('수정 이력: 전후 비교 기록, 되돌리기, 데이터 버전 증가', async () => {
  const v0 = (await anon('GET', '/api/site')).body.data_version;
  const before = (await anon('GET', '/api/entries/W02')).body.entry.alternative.ko;
  const up = await admin('PUT', '/api/admin/entries/W02', { patch: { alternative: { ko: '가족에게 편한 호칭을 묻는다.', en: 'Ask the family.' } }, reason: '문장 다듬기' });
  assert.equal(up.status, 200); assert.equal(up.body.revision.rev, 1);
  assert.equal(up.body.revision.changes.alternative.before.ko, before);
  const pub = (await anon('GET', '/api/entries/W02')).body.entry;
  assert.equal(pub.alternative.ko, '가족에게 편한 호칭을 묻는다.');
  assert.deepEqual(pub.revision_history[0].fields, ['alternative']);
  assert.equal(pub.revision_history[0].changes, undefined, '공개 이력에는 전후 본문을 싣지 않는다');
  assert.notEqual((await anon('GET', '/api/site')).body.data_version, v0);
  const rv = await admin('POST', '/api/admin/entries/W02/revert', { rev: 1 });
  assert.equal(rv.status, 200);
  assert.equal((await anon('GET', '/api/entries/W02')).body.entry.alternative.ko, before);
  assert.equal((await admin('PUT', '/api/admin/entries/W02', { patch: { id: 'ZZ', origin: 'x' }, reason: 'r' })).status, 400);
});

test('공개 → 비공개 전환 시 다른 항목의 연결에서도 사라진다', async () => {
  assert.ok((await anon('GET', '/api/entries/W01')).body.entry.related_entries.some((r) => r.id === 'W02'));
  await admin('PUT', '/api/admin/entries/W02', { patch: { publication_status: 'draft' }, reason: '검토 위해 비공개' });
  assert.equal((await anon('GET', '/api/entries/W02')).status, 404);
  assert.ok(!(await anon('GET', '/api/entries/W01')).body.entry.related_entries.some((r) => r.id === 'W02'));
  assert.equal((await anon('GET', '/api/stats')).body.entries_total, 38);
  await admin('PUT', '/api/admin/entries/W02', { patch: { publication_status: 'published' }, reason: '재공개' });
  assert.equal((await anon('GET', '/api/stats')).body.entries_total, 39);
});

test('통계: 초기 값, 경험 0, 철자 변형 중복 제거', async () => {
  const s = (await anon('GET', '/api/stats')).body;
  assert.equal(s.entries_total, 39); assert.equal(s.sentences, 12); assert.equal(s.experiences_public, 0);
  assert.deepEqual(s.by_type, { word: 12, sentence: 12, scenario: 10, nonverbal: 5 });
  assert.equal(s.initial_seed_entries, 39); assert.equal(s.contributors_total, 0);
  assert.ok(s.by_topic.reduce((a, t) => a + t.count, 0) > s.entries_total, '복수 태그 합은 전체와 다르다');
  const db = freshDb();
  const base0 = computeStats(db).entries_total;
  db.entries.push({ ...db.entries.find((e) => e.id === 'W04'), id: 'W04B', original_text: 'wheelchair bound', variant_of: 'W04', usages: db.entries.find((e) => e.id === 'W04').usages });
  const s2 = computeStats(db);
  assert.equal(s2.records_total, base0 + 1); assert.equal(s2.entries_total, base0, '변형은 표제어 하나로 센다');
  assert.equal(s2.usages_total, computeStats(freshDb()).usages_total, '같은 용법 ID는 한 번만 센다');
});

test('경험 기록: 비공개 초안 기본, 별도 동의, 승인된 고유 기록만 집계, 철회 시 제외', async () => {
  assert.equal((await anon('POST', '/api/experiences', { kind: 'heard', text: 'x' })).status, 401);
  const c = await alice('POST', '/api/experiences', { kind: 'heard', entry_id: 'W01', text: '가족 모임에서 이 호칭을 들었다.', region_broad: '한국' });
  assert.equal(c.status, 200); assert.equal(c.body.experience.status, 'draft');
  const id = c.body.experience.id;
  assert.equal((await anon('GET', '/api/experiences')).body.items.length, 0);
  assert.equal((await bob('PUT', `/api/experiences/${id}`, { kind: 'heard', text: 'hijack' })).status, 404, '남의 초안은 수정 불가');
  assert.equal((await bob('POST', `/api/experiences/${id}/consent`, { consent: true })).status, 404);
  assert.equal((await admin('GET', '/api/admin/experiences')).body.items.length, 0, '동의 전 초안은 관리자 목록에도 없다');
  assert.equal((await admin('PATCH', `/api/admin/experiences/${id}`, { status: 'published' })).status, 404, '동의 없는 초안은 공개 불가');
  assert.equal((await alice('POST', `/api/experiences/${id}/consent`, {})).status, 400);
  assert.equal((await alice('POST', `/api/experiences/${id}/consent`, { consent: true })).body.experience.status, 'pending_review');
  assert.equal((await anon('GET', '/api/stats')).body.experiences_public, 0, '검토 중은 공개 합계에서 제외');
  assert.equal((await alice('PATCH', `/api/admin/experiences/${id}`, { status: 'published' })).status, 403);
  assert.equal((await admin('PATCH', `/api/admin/experiences/${id}`, { status: 'published' })).status, 200);
  const s = (await anon('GET', '/api/stats')).body;
  assert.equal(s.experiences_public, 1); assert.equal(s.by_language.find((l) => l.language === 'ko').contributors, 1);
  const pub = (await anon('GET', '/api/experiences?entry=W01')).body.items;
  assert.equal(pub.length, 1); assert.equal(pub[0].user_id, undefined); assert.equal(pub[0].handle, undefined);
  await alice('POST', `/api/experiences/${id}/withdraw`);
  assert.equal((await anon('GET', '/api/stats')).body.experiences_public, 0, '철회된 기록은 제외');
  assert.equal((await anon('GET', '/api/experiences')).body.items.length, 0);
  assert.equal((await alice('POST', '/api/experiences', { kind: 'heard', text: '연락은 me@example.com 으로' })).body.error, 'contact_info_not_allowed');
  assert.equal((await alice('POST', '/api/experiences', { kind: 'heard', entry_id: 'W13', text: 'x' })).status, 404, '비공개 항목에는 연결 불가');
});

test('기여 신청 검토: 접수 → 검토 중 → 보류(이유 필수) → 반영, 수정 이력과 연결', async () => {
  assert.equal((await alice('POST', '/api/contributions', { kind: 'edit', entry_id: 'W04', text: '제안' })).body.error, 'license_grant_required');
  assert.equal((await alice('POST', '/api/contributions', { kind: 'edit', text: '제안', license_grant: true })).body.error, 'entry_required');
  const c = await alice('POST', '/api/contributions', { kind: 'edit', entry_id: 'W04', text: '대체 표현 설명을 더 명확히 해주세요.', license_grant: true });
  assert.equal(c.body.contribution.status, 'received');
  const id = c.body.contribution.id;
  assert.equal((await bob('GET', '/api/me/contributions')).body.items.length, 0, '남의 신청은 보이지 않는다');
  assert.equal((await alice('PATCH', `/api/admin/contributions/${id}`, { status: 'applied' })).status, 403);
  assert.equal((await admin('PATCH', `/api/admin/contributions/${id}`, { status: 'in_review' })).status, 200);
  assert.equal((await admin('PATCH', `/api/admin/contributions/${id}`, { status: 'on_hold' })).status, 400, '보류는 이유 필수');
  assert.equal((await admin('PATCH', `/api/admin/contributions/${id}`, { status: 'on_hold', reason: '출처 확인 필요' })).status, 200);
  const up = await admin('PUT', '/api/admin/entries/W04', { patch: { ambiguity_note: { ko: '미국 안내 기준임을 밝힌다.' } }, reason: '기여 반영', contribution_id: id });
  assert.equal(up.status, 200);
  const mine = (await alice('GET', '/api/me/contributions')).body.items[0];
  assert.equal(mine.status, 'applied'); assert.deepEqual(mine.applied_revision, { entry_id: 'W04', rev: up.body.revision.rev });
  assert.deepEqual(mine.history.map((h) => h.status), ['received', 'in_review', 'on_hold', 'applied']);
  const rej = (await bob('POST', '/api/contributions', { kind: 'add', text: '새 표현 제안', license_grant: true })).body.contribution;
  assert.equal((await admin('PATCH', `/api/admin/contributions/${rej.id}`, { status: 'rejected', reason: '범위 밖' })).status, 200);
  assert.equal((await bob('GET', '/api/me/contributions')).body.items[0].reason, '범위 밖');
});

test('댓글: 태그, 신고, 중복 신고 방지, 운영자 숨김, 분류 불변', async () => {
  assert.equal((await anon('POST', '/api/entries/W03/comments', { tag: 'question', text: 'q' })).status, 401);
  assert.equal((await alice('POST', '/api/entries/W03/comments', { tag: 'vote', text: 'q' })).status, 400);
  assert.equal((await alice('POST', '/api/entries/W13/comments', { tag: 'question', text: 'q' })).status, 404);
  const c = (await alice('POST', '/api/entries/W03/comments', { tag: 'regional_difference', text: '지역에 따라 다르게 들립니다.' })).body.comment;
  const before = JSON.stringify((await anon('GET', '/api/entries/W03')).body.entry.usages);
  assert.equal((await anon('POST', `/api/comments/${c.id}/report`, { reason: 'x' })).status, 401);
  assert.equal((await bob('POST', `/api/comments/${c.id}/report`, { reason: '특정인 비방' })).status, 200);
  assert.equal((await bob('POST', `/api/comments/${c.id}/report`, { reason: '다시' })).status, 409);
  assert.equal((await anon('GET', '/api/entries/W03/comments')).body.items[0].text, '지역에 따라 다르게 들립니다.', '신고만으로 자동 숨김되지 않는다');
  const reports = (await admin('GET', '/api/admin/reports')).body.items;
  assert.equal(reports.length, 1); assert.equal(reports[0].reporter_id, undefined);
  assert.equal((await bob('DELETE', `/api/comments/${c.id}`)).status, 403, '남의 댓글 삭제 불가');
  assert.equal((await admin('PATCH', `/api/admin/reports/${reports[0].id}`, { action: 'hide' })).status, 200);
  const shown = (await anon('GET', '/api/entries/W03/comments')).body.items[0];
  assert.equal(shown.status, 'hidden'); assert.equal(shown.text, '');
  assert.equal(JSON.stringify((await anon('GET', '/api/entries/W03')).body.entry.usages), before, '댓글·신고는 분류를 바꾸지 않는다');
  const mine = (await alice('POST', '/api/entries/W03/comments', { tag: 'question', text: '질문입니다' })).body.comment;
  assert.equal((await alice('DELETE', `/api/comments/${mine.id}`)).status, 200);
});

test('테스트 문항: 6문항, 공개 상황만, 해설·대체 말·확인 질문 포함, 인격 점수 없음', async () => {
  const { items, pool_size } = (await anon('GET', '/api/quiz?n=6')).body;
  assert.equal(pool_size, 10); assert.equal(items.length, 6); assert.equal(new Set(items.map((i) => i.id)).size, 6);
  for (const it of items) {
    assert.equal(it.quiz.options.length, 4);
    assert.ok(it.quiz.options.filter((o) => o.recommended).length >= 2, '여러 요소 선택');
    assert.ok(it.quiz.options.find((o) => o.key === 'D').recommended, 'D는 추가 맥락 확인');
    assert.ok(it.quiz.explanation.ko && it.quiz.alternative.ko && it.quiz.check_question.ko);
    assert.ok(it.quiz.options.filter((o) => !o.recommended).every((o) => o.note && o.note.ko), '권장하지 않는 선택지에는 전제 설명');
    assert.equal(it.quiz.score, undefined);
  }
});

test('JSON 내보내기·가져오기: 관리자 전용, 버전 검사, 근거 없는 공개 항목은 초안으로 강등', async () => {
  const ex = (await admin('GET', '/api/admin/export')).body;
  assert.equal(ex.format, 'context-atlas'); assert.equal(ex.entries.length, 50); assert.ok(ex.data_version);
  assert.ok(!JSON.stringify(ex).includes('password'));
  assert.equal((await admin('POST', '/api/admin/import', { format: 'context-atlas', schema_version: 99, entries: [] })).status, 400);
  const imp = await admin('POST', '/api/admin/import', { format: 'context-atlas', schema_version: 1, entries: [
    { id: 'X01', entry_type: 'word', original_text: 'sample', language: 'en', publication_status: 'published' },
    { id: 'bad id', entry_type: 'word', original_text: 'x', language: 'en' },
  ] });
  assert.equal(imp.status, 200);
  assert.deepEqual(imp.body.report.added, ['X01']); assert.deepEqual(imp.body.report.forced_to_draft, ['X01']); assert.equal(imp.body.report.rejected.length, 1);
  assert.equal((await anon('GET', '/api/entries/X01')).status, 404);
  assert.equal((await anon('GET', '/api/entries')).body.total_public, 39);
});

test('사이트 설정: 이름·도메인 변경 가능, 광고는 켤 수 없음', async () => {
  const r = await admin('PUT', '/api/admin/settings', { site_name: 'Words in Context', domain: 'atlas.example.org', ads_enabled: true });
  assert.equal(r.status, 200); assert.equal(r.body.settings.ads_enabled, false);
  const site = (await anon('GET', '/api/site')).body;
  assert.equal(site.site_name, 'Words in Context'); assert.equal(site.ads_enabled, false); assert.equal(site.storage, 'server');
  const page = await fetch(`${base}/`);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
});

test('계정 삭제 시 본인 기록이 함께 지워진다', async () => {
  const carol = client();
  await carol('POST', '/api/auth/register', { handle: 'carol', password: 'carol-password-1' });
  await carol('POST', '/api/experiences', { kind: 'used', text: '예전에 무심코 썼던 표현이 있다.' });
  const cm = (await carol('POST', '/api/entries/W05/comments', { tag: 'experience', text: '경험 공유' })).body.comment;
  assert.equal((await carol('DELETE', '/api/me')).status, 200);
  assert.equal((await carol('GET', '/api/me/experiences')).status, 401);
  assert.ok(!(await anon('GET', '/api/entries/W05/comments')).body.items.some((c) => c.id === cm.id));
  assert.ok(!(await admin('GET', '/api/admin/users')).body.items.some((u) => u.handle === 'carol'));
});

test('접근 속도 제한과 경로 이탈 방지', async () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-rl-'));
  const s2 = createApp({ dataDir: d2, rateLimit: { api: 1000, auth: 3, write: 40 } }).server();
  await new Promise((r) => s2.listen(0, r));
  const b2 = `http://127.0.0.1:${s2.address().port}`;
  const codes = [];
  for (let i = 0; i < 5; i += 1) codes.push((await fetch(`${b2}/api/auth/login`, { method: 'POST', headers: { 'x-atlas-request': '1', 'content-type': 'application/json' }, body: '{"handle":"nobody","password":"wrong-password"}' })).status);
  assert.deepEqual(codes, [401, 401, 401, 429, 429]);
  assert.equal((await fetch(`${b2}/..%2fserver%2fseed-entries.js`)).status, 404);
  assert.equal((await fetch(`${b2}/%2e%2e/server/seed-entries.js`)).status, 404);
  s2.close(); fs.rmSync(d2, { recursive: true, force: true });
});
