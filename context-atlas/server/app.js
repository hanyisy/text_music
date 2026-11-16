// HTTP API + 정적 파일. 외부 의존성 없음.
// 권한은 모두 여기(서버)에서 검사한다. 프런트엔드의 메뉴 숨김은 권한 검사가 아니다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore, SCHEMA_VERSION } from './store.js';
import {
  isPublic, publicView, filterEntries, facets, computeStats, publishBlockers, validateEntry, normalizeEntry, diffFields,
  UI_LANGS, EDITABLE_FIELDS,
} from './model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };
// 이 사이트 전용 보안 헤더. script-src 'self' 이므로 다른 서브도메인의 공통 광고·태그 코드가 주입돼도 실행되지 않는다.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
};
const SESSION_DAYS = 7;
const COMMENT_TAGS = ['question', 'experience', 'regional_difference', 'evidence', 'disagreement'];
const EXPERIENCE_KINDS = ['heard', 'witnessed', 'used', 'changed_mind'];
const CONTRIBUTION_KINDS = ['add', 'edit', 'source', 'translation'];
const CONTRIBUTION_STATUS = ['received', 'in_review', 'applied', 'on_hold', 'rejected'];

class HttpError extends Error { constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra; } }
const bad = (code, extra) => new HttpError(400, code, extra);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(password, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// 연락처로 보이는 문자열은 저장하지 않는다(실명·연락처 비수집 원칙의 최소 방어선. 완전한 탐지는 아니다).
const CONTACT_RE = /[^\s@]+@[^\s@]+\.[^\s@]+|(?:\+?\d[\d\s().-]{8,}\d)/;
function cleanText(v, max, field, { contactCheck = false } = {}) {
  if (typeof v !== 'string') throw bad('invalid_field', { field });
  const s = v.trim();
  if (!s) throw bad('empty_field', { field });
  if (s.length > max) throw bad('too_long', { field, max });
  if (contactCheck && CONTACT_RE.test(s)) throw bad('contact_info_not_allowed', { field });
  return s;
}
const optText = (v, max, field, o) => (v === undefined || v === null || v === '' ? '' : cleanText(v, max, field, o));

export function createApp({ dataDir, publicDir = path.join(HERE, '..', 'public'), rateLimit = true, admin = null } = {}) {
  const store = createStore(dataDir);
  const db = () => store.db;

  // ── 관리자 계정: 환경 변수 또는 create-admin 스크립트로만 만든다. 기본 비밀번호는 없다. ──
  function ensureAdmin(handle, password) {
    const h = String(handle).toLowerCase();
    if (!/^[a-z0-9_-]{3,24}$/.test(h) || String(password).length < 10) throw new Error('admin handle/password invalid (handle 3–24 chars a-z0-9_-, password ≥ 10 chars)');
    let u = db().users.find((x) => x.handle === h);
    if (!u) { u = { id: store.nextId('user', 'u'), handle: h, role: 'admin', created_at: now(), disabled: false }; db().users.push(u); }
    u.role = 'admin'; u.password = hashPassword(password); store.save();
    return u;
  }
  if (admin) ensureAdmin(admin.handle, admin.password);

  // ── 접근 속도 제한 (IP별 고정 창). 대량 수집을 늦추는 장치일 뿐 복제 방지 장치가 아니다. ──
  const buckets = new Map();
  const LIMITS = { api: 240, write: 40, auth: 10 };
  function limit(req, kind) {
    if (!rateLimit) return;
    const max = typeof rateLimit === 'object' && rateLimit[kind] ? rateLimit[kind] : LIMITS[kind];
    const ip = (process.env.ATLAS_TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
    const key = `${kind}:${ip}`; const t = Date.now();
    if (buckets.size > 20000) for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k);
    let b = buckets.get(key);
    if (!b || b.reset < t) { b = { count: 0, reset: t + 60000 }; buckets.set(key, b); }
    b.count += 1;
    if (b.count > max) throw new HttpError(429, 'rate_limited', { retry_after_s: Math.ceil((b.reset - t) / 1000) });
  }

  // ── 세션 ──
  function currentUser(req) {
    const m = /(?:^|;\s*)atlas_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    if (!m) return null;
    const s = db().sessions[sha(m[1])];
    if (!s || s.expires_at < Date.now()) return null;
    const u = db().users.find((x) => x.id === s.user_id);
    return u && !u.disabled ? u : null;
  }
  function startSession(req, res, user) {
    const token = crypto.randomBytes(32).toString('hex');
    for (const [k, s] of Object.entries(db().sessions)) if (s.expires_at < Date.now()) delete db().sessions[k];
    db().sessions[sha(token)] = { user_id: user.id, expires_at: Date.now() + SESSION_DAYS * 864e5 };
    store.save();
    const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.ATLAS_SECURE_COOKIE ? '; Secure' : '';
    res.setHeader('Set-Cookie', `atlas_sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  }
  const requireUser = (req) => { const u = currentUser(req); if (!u) throw new HttpError(401, 'login_required'); return u; };
  const requireAdmin = (req) => { const u = requireUser(req); if (u.role !== 'admin') throw new HttpError(403, 'admin_only'); return u; };
  const userView = (u) => (u ? { id: u.id, handle: u.handle, role: u.role } : null);
  const audit = (by, action, target, note = '') => { db().audit.push({ at: now(), by: by.handle, action, target, note }); if (db().audit.length > 2000) db().audit.splice(0, db().audit.length - 2000); };

  // ── 항목 접근 ──
  const pubEntries = () => db().entries.filter(isPublic);
  const pubIdSet = () => new Set(pubEntries().map((e) => e.id));
  const findEntry = (id) => db().entries.find((e) => e.id === id);
  function visibleEntry(id, user) {
    const e = findEntry(id);
    // 비공개 항목은 존재 여부도 알리지 않는다(404).
    if (!e || (!isPublic(e) && !(user && user.role === 'admin'))) throw new HttpError(404, 'not_found');
    return e;
  }
  const summary = (e) => ({ id: e.id, entry_type: e.entry_type, original_text: e.original_text, title: e.title || null, language: e.language, content_note: e.content_note });

  function applyEntryPatch(e, patch, user, reason, contributionId = null) {
    const changes = diffFields(e, patch);
    if (!Object.keys(changes).length) throw bad('no_changes');
    const next = { ...e };
    for (const [k, c] of Object.entries(changes)) next[k] = c.after;
    const invalid = validateEntry(next);
    if (invalid.length) throw bad('invalid_entry', { fields: invalid });
    if (next.publication_status === 'published') {
      const blockers = publishBlockers(next);
      if (blockers.length) throw new HttpError(409, 'publish_blocked', { blockers });
    }
    const rev = { rev: e.revision_history.length + 1, at: now(), by: user.handle, reason, changes, contribution_id: contributionId };
    Object.assign(e, next);
    e.revision_history.push(rev);
    store.bumpContent();
    audit(user, 'entry.update', e.id, reason);
    return rev;
  }

  const commentView = (c, user) => ({
    id: c.id, entry_id: c.entry_id, tag: c.tag, text: c.status === 'visible' ? c.text : '', status: c.status, handle: c.handle,
    created_at: c.created_at, mine: !!user && user.id === c.user_id,
  });
  const expPublic = (x) => ({ id: x.id, kind: x.kind, entry_id: x.entry_id, text: x.text, lang: x.lang, region_broad: x.region_broad, period: x.period, published_at: x.published_at });
  const expOwn = (x) => ({ ...expPublic(x), status: x.status, consent_public_at: x.consent_public_at, review_reason: x.review_reason, created_at: x.created_at, updated_at: x.updated_at });
  const contribView = (c) => ({ id: c.id, kind: c.kind, entry_id: c.entry_id, target_language: c.target_language, text: c.text, source_url: c.source_url, status: c.status, reason: c.reason, history: c.history, created_at: c.created_at, applied_revision: c.applied_revision });

  // ── 라우트 ──
  const routes = [];
  const route = (method, pattern, fn, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern}$`), fn, opts });

  route('GET', '/api/site', ({ user }) => ({
    site_name: db().settings.site_name, contact: db().settings.contact, domain: db().settings.domain, ads_enabled: false,
    data_version: store.dataVersion(), schema_version: SCHEMA_VERSION, storage: 'server', ui_languages: UI_LANGS, user: userView(user),
  }));
  route('GET', '/api/stats', () => ({ ...computeStats(db()), data_version: store.dataVersion() }));
  route('GET', '/api/facets', () => facets(pubEntries()));
  route('GET', '/api/entries', ({ query }) => {
    const ids = pubIdSet();
    const all = pubEntries();
    const items = filterEntries(all, query).map((e) => publicView(e, ids));
    return { total_public: all.length, count: items.length, items };
  });
  route('GET', '/api/entries/([A-Za-z0-9_-]+)', ({ params, user }) => {
    const e = visibleEntry(params[0], user);
    const ids = pubIdSet();
    const isAdmin = user && user.role === 'admin';
    const view = isAdmin ? { ...e } : publicView(e, ids);
    return {
      entry: view,
      sources: db().sources.filter((s) => e.source_ids.includes(s.id)),
      related: view.related_entries.filter((r) => r.id).map((r) => { const t = findEntry(r.id); return t && (isAdmin || isPublic(t)) ? summary(t) : null; }).filter(Boolean),
      publish_blockers: isAdmin ? publishBlockers(e) : undefined,
    };
  });
  route('GET', '/api/sources', () => ({ items: db().sources }));
  route('GET', '/api/quiz', ({ query }) => {
    const pool = pubEntries().filter((e) => e.entry_type === 'scenario' && e.quiz);
    const n = Math.min(Math.max(parseInt(query.n, 10) || 6, 1), pool.length);
    const picked = [...pool].map((e) => [Math.random(), e]).sort((a, b) => a[0] - b[0]).slice(0, n).map((x) => x[1]);
    const ids = pubIdSet();
    return { pool_size: pool.length, items: picked.map((e) => publicView(e, ids)) };
  });

  // ── 인증 ──
  route('POST', '/api/auth/register', ({ req, res, body }) => {
    const handle = String(body.handle || '').toLowerCase();
    if (!/^[a-z0-9_-]{3,24}$/.test(handle)) throw bad('invalid_handle');
    if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 200) throw bad('weak_password');
    if (db().users.some((u) => u.handle === handle)) throw new HttpError(409, 'handle_taken');
    const u = { id: store.nextId('user', 'u'), handle, role: 'user', password: hashPassword(body.password), created_at: now(), disabled: false };
    db().users.push(u);
    startSession(req, res, u);
    return { user: userView(u) };
  }, { limit: 'auth' });
  route('POST', '/api/auth/login', ({ req, res, body }) => {
    const u = db().users.find((x) => x.handle === String(body.handle || '').toLowerCase());
    if (!u || u.disabled || typeof body.password !== 'string' || !verifyPassword(body.password, u.password)) throw new HttpError(401, 'bad_credentials');
    startSession(req, res, u);
    return { user: userView(u) };
  }, { limit: 'auth' });
  route('POST', '/api/auth/logout', ({ req, res }) => {
    const m = /(?:^|;\s*)atlas_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    if (m) { delete db().sessions[sha(m[1])]; store.save(); }
    res.setHeader('Set-Cookie', 'atlas_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return { ok: true };
  });
  route('DELETE', '/api/me', ({ req, res }) => {
    const u = requireUser(req);
    if (u.role === 'admin' && db().users.filter((x) => x.role === 'admin' && !x.disabled).length === 1) throw new HttpError(409, 'last_admin');
    const d = db();
    d.experiences = d.experiences.filter((x) => x.user_id !== u.id);
    for (const c of d.comments) if (c.user_id === u.id) { c.status = 'deleted'; c.text = ''; c.handle = '—'; }
    for (const c of d.contributions) if (c.user_id === u.id) c.user_handle = '—';
    for (const [k, s] of Object.entries(d.sessions)) if (s.user_id === u.id) delete d.sessions[k];
    d.users = d.users.filter((x) => x.id !== u.id);
    store.save();
    res.setHeader('Set-Cookie', 'atlas_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return { ok: true };
  });

  // ── 댓글: 사전의 확인된 사실과 분리된 이용자 의견. 추천 수 기능은 없으며 분류에 영향을 주지 않는다. ──
  route('GET', '/api/entries/([A-Za-z0-9_-]+)/comments', ({ params, user }) => {
    visibleEntry(params[0], user);
    return { items: db().comments.filter((c) => c.entry_id === params[0] && c.status !== 'deleted').map((c) => commentView(c, user)) };
  });
  route('POST', '/api/entries/([A-Za-z0-9_-]+)/comments', ({ req, params, body }) => {
    const u = requireUser(req);
    const e = visibleEntry(params[0], null); // 공개 항목에만 댓글
    if (!COMMENT_TAGS.includes(body.tag)) throw bad('invalid_tag');
    const c = { id: store.nextId('comment', 'c'), entry_id: e.id, user_id: u.id, handle: u.handle, tag: body.tag, text: cleanText(body.text, 2000, 'text', { contactCheck: true }), status: 'visible', created_at: now() };
    db().comments.push(c); store.save();
    return { comment: commentView(c, u) };
  }, { limit: 'write' });
  route('DELETE', '/api/comments/(c\\d+)', ({ req, params }) => {
    const u = requireUser(req);
    const c = db().comments.find((x) => x.id === params[0]);
    if (!c || c.status === 'deleted') throw new HttpError(404, 'not_found');
    if (c.user_id !== u.id && u.role !== 'admin') throw new HttpError(403, 'not_owner');
    c.status = 'deleted'; c.text = ''; store.save();
    return { ok: true };
  });
  route('POST', '/api/comments/(c\\d+)/report', ({ req, params, body }) => {
    const u = requireUser(req);
    const c = db().comments.find((x) => x.id === params[0] && x.status === 'visible');
    if (!c) throw new HttpError(404, 'not_found');
    if (db().reports.some((r) => r.comment_id === c.id && r.reporter_id === u.id)) throw new HttpError(409, 'already_reported');
    const r = { id: store.nextId('report', 'r'), comment_id: c.id, reporter_id: u.id, reason: cleanText(body.reason, 500, 'reason'), status: 'open', resolution: '', created_at: now() };
    db().reports.push(r); store.save();
    return { report: { id: r.id, status: r.status } };
  }, { limit: 'write' });

  // ── 경험 기록: 비공개 초안이 기본. 공개는 별도 동의 + 운영자 검토 후. ──
  route('GET', '/api/experiences', ({ query }) => ({
    items: db().experiences.filter((x) => x.status === 'published' && (!query.entry || x.entry_id === query.entry)).map(expPublic),
  }));
  route('GET', '/api/me/experiences', ({ req }) => { const u = requireUser(req); return { items: db().experiences.filter((x) => x.user_id === u.id).map(expOwn) }; });
  function expFields(body) {
    if (!EXPERIENCE_KINDS.includes(body.kind)) throw bad('invalid_kind');
    let entry_id = null;
    if (body.entry_id) { visibleEntry(String(body.entry_id), null); entry_id = String(body.entry_id); }
    return {
      kind: body.kind, entry_id, text: cleanText(body.text, 3000, 'text', { contactCheck: true }),
      lang: optText(body.lang, 20, 'lang'), region_broad: optText(body.region_broad, 60, 'region_broad', { contactCheck: true }), period: optText(body.period, 40, 'period'),
    };
  }
  route('POST', '/api/experiences', ({ req, body }) => {
    const u = requireUser(req);
    const x = { id: store.nextId('experience', 'x'), user_id: u.id, ...expFields(body), status: 'draft', consent_public_at: null, published_at: null, review_reason: '', created_at: now(), updated_at: now() };
    db().experiences.push(x); store.save();
    return { experience: expOwn(x) };
  }, { limit: 'write' });
  const ownExp = (req, id) => {
    const u = requireUser(req);
    const x = db().experiences.find((y) => y.id === id);
    if (!x || x.user_id !== u.id) throw new HttpError(404, 'not_found'); // 남의 초안은 존재도 알리지 않는다
    return x;
  };
  route('PUT', '/api/experiences/(x\\d+)', ({ req, params, body }) => {
    const x = ownExp(req, params[0]);
    if (!['draft', 'withdrawn', 'rejected'].includes(x.status)) throw new HttpError(409, 'withdraw_first');
    Object.assign(x, expFields(body), { status: 'draft', consent_public_at: null, updated_at: now() }); store.save();
    return { experience: expOwn(x) };
  }, { limit: 'write' });
  route('POST', '/api/experiences/(x\\d+)/consent', ({ req, params, body }) => {
    const x = ownExp(req, params[0]);
    if (body.consent !== true) throw bad('consent_required');
    if (x.status !== 'draft') throw new HttpError(409, 'not_draft');
    Object.assign(x, { status: 'pending_review', consent_public_at: now(), updated_at: now() }); store.save();
    return { experience: expOwn(x) };
  });
  route('POST', '/api/experiences/(x\\d+)/withdraw', ({ req, params }) => {
    const x = ownExp(req, params[0]);
    Object.assign(x, { status: 'withdrawn', consent_public_at: null, published_at: null, updated_at: now() }); store.save();
    return { experience: expOwn(x) };
  });
  route('DELETE', '/api/experiences/(x\\d+)', ({ req, params }) => {
    const x = ownExp(req, params[0]);
    db().experiences.splice(db().experiences.indexOf(x), 1); store.save();
    return { ok: true };
  });

  // ── 기여 신청 ──
  route('GET', '/api/me/contributions', ({ req }) => { const u = requireUser(req); return { items: db().contributions.filter((c) => c.user_id === u.id).map(contribView) }; });
  route('POST', '/api/contributions', ({ req, body }) => {
    const u = requireUser(req);
    if (!CONTRIBUTION_KINDS.includes(body.kind)) throw bad('invalid_kind');
    if (body.license_grant !== true) throw bad('license_grant_required');
    let entry_id = null;
    if (body.entry_id) { visibleEntry(String(body.entry_id), null); entry_id = String(body.entry_id); }
    if (body.kind !== 'add' && !entry_id) throw bad('entry_required');
    let source_url = optText(body.source_url, 500, 'source_url');
    if (source_url && !/^https?:\/\//i.test(source_url)) throw bad('invalid_field', { field: 'source_url' });
    const c = {
      id: store.nextId('contribution', 'k'), user_id: u.id, user_handle: u.handle, kind: body.kind, entry_id,
      target_language: optText(body.target_language, 20, 'target_language'), text: cleanText(body.text, 4000, 'text', { contactCheck: true }), source_url,
      license_grant_at: now(), status: 'received', reason: '', history: [{ status: 'received', reason: '', at: now() }], created_at: now(), applied_revision: null,
    };
    db().contributions.push(c); store.save();
    return { contribution: contribView(c) };
  }, { limit: 'write' });

  // ── 관리자 ──
  route('GET', '/api/admin/overview', ({ req }) => {
    requireAdmin(req); const d = db();
    return {
      entries: { total: d.entries.length, published: d.entries.filter(isPublic).length, draft: d.entries.filter((e) => !isPublic(e)).length },
      pending_experiences: d.experiences.filter((x) => x.status === 'pending_review').length,
      open_reports: d.reports.filter((r) => r.status === 'open').length,
      open_contributions: d.contributions.filter((c) => ['received', 'in_review', 'on_hold'].includes(c.status)).length,
      users: d.users.length, data_version: store.dataVersion(),
    };
  });
  route('GET', '/api/admin/entries', ({ req }) => { requireAdmin(req); return { items: db().entries.map((e) => ({ ...e, publish_blockers: publishBlockers(e) })) }; });
  route('POST', '/api/admin/entries', ({ req, body }) => {
    const u = requireAdmin(req);
    const e = normalizeEntry({ ...body.entry, publication_status: 'draft', revision_history: [], origin: 'admin_created' });
    for (const k of Object.keys(e)) if (!EDITABLE_FIELDS.has(k) && !['id', 'origin', 'revision_history'].includes(k)) delete e[k];
    const invalid = validateEntry(e);
    if (invalid.length) throw bad('invalid_entry', { fields: invalid });
    if (findEntry(e.id)) throw new HttpError(409, 'id_exists');
    db().entries.push(e); store.bumpContent(); audit(u, 'entry.create', e.id); store.save();
    return { entry: e };
  });
  route('PUT', '/api/admin/entries/([A-Za-z0-9_-]+)', ({ req, params, body }) => {
    const u = requireAdmin(req);
    const e = findEntry(params[0]); if (!e) throw new HttpError(404, 'not_found');
    if (!body.patch || typeof body.patch !== 'object') throw bad('patch_required');
    const reason = cleanText(body.reason, 500, 'reason');
    let contribution = null;
    if (body.contribution_id) { contribution = db().contributions.find((c) => c.id === body.contribution_id); if (!contribution) throw bad('unknown_contribution'); }
    const rev = applyEntryPatch(e, body.patch, u, reason, contribution ? contribution.id : null);
    if (contribution) { contribution.status = 'applied'; contribution.reason = reason; contribution.applied_revision = { entry_id: e.id, rev: rev.rev }; contribution.history.push({ status: 'applied', reason, at: now() }); }
    store.save();
    return { entry: e, revision: rev, publish_blockers: publishBlockers(e) };
  });
  route('POST', '/api/admin/entries/([A-Za-z0-9_-]+)/revert', ({ req, params, body }) => {
    const u = requireAdmin(req);
    const e = findEntry(params[0]); if (!e) throw new HttpError(404, 'not_found');
    const target = e.revision_history.find((r) => r.rev === Number(body.rev));
    if (!target) throw bad('unknown_revision');
    const patch = Object.fromEntries(Object.entries(target.changes).map(([k, c]) => [k, c.before]));
    const rev = applyEntryPatch(e, patch, u, `revert of rev ${target.rev}${body.reason ? `: ${cleanText(body.reason, 300, 'reason')}` : ''}`);
    store.save();
    return { entry: e, revision: rev };
  });
  route('PUT', '/api/admin/sources/(S[A-Za-z0-9_-]+)', ({ req, params, body }) => {
    const u = requireAdmin(req);
    const s = body.source || {};
    if (typeof s.title !== 'string' || !s.title || typeof s.url !== 'string' || !/^https?:\/\//.test(s.url)) throw bad('invalid_source');
    const clean = {
      id: params[0], title: s.title, author: String(s.author || ''), url: s.url, published_at: s.published_at || null, accessed_at: s.accessed_at || null,
      supported_claim: s.supported_claim && typeof s.supported_claim === 'object' ? s.supported_claim : {}, reuse_license: String(s.reuse_license || 'not_confirmed'),
      copied_excerpt: s.copied_excerpt === true, role: String(s.role || 'supports_claim'),
    };
    const i = db().sources.findIndex((x) => x.id === params[0]);
    if (i >= 0) db().sources[i] = clean; else db().sources.push(clean);
    store.bumpContent(); audit(u, 'source.upsert', clean.id); store.save();
    return { source: clean };
  });
  route('GET', '/api/admin/experiences', ({ req }) => {
    requireAdmin(req);
    // 관리자는 공개 동의된 기록만 본다. 동의 전 비공개 초안은 관리자에게도 내보내지 않는다.
    return { items: db().experiences.filter((x) => ['pending_review', 'published', 'rejected'].includes(x.status)).map(expOwn) };
  });
  route('PATCH', '/api/admin/experiences/(x\\d+)', ({ req, params, body }) => {
    const u = requireAdmin(req);
    const x = db().experiences.find((y) => y.id === params[0] && y.status !== 'draft' && y.status !== 'withdrawn');
    if (!x) throw new HttpError(404, 'not_found');
    if (!['published', 'rejected'].includes(body.status)) throw bad('invalid_status');
    if (body.status === 'published' && !x.consent_public_at) throw new HttpError(409, 'no_consent');
    x.status = body.status; x.review_reason = optText(body.reason, 500, 'reason'); x.published_at = body.status === 'published' ? now() : null; x.updated_at = now();
    audit(u, `experience.${body.status}`, x.id, x.review_reason); store.save();
    return { experience: expOwn(x) };
  });
  route('GET', '/api/admin/contributions', ({ req }) => { requireAdmin(req); return { items: db().contributions.map((c) => ({ ...contribView(c), user_handle: c.user_handle })) }; });
  route('PATCH', '/api/admin/contributions/(k\\d+)', ({ req, params, body }) => {
    const u = requireAdmin(req);
    const c = db().contributions.find((y) => y.id === params[0]); if (!c) throw new HttpError(404, 'not_found');
    if (!CONTRIBUTION_STATUS.includes(body.status)) throw bad('invalid_status');
    const reason = ['on_hold', 'rejected'].includes(body.status) ? cleanText(body.reason, 500, 'reason') : optText(body.reason, 500, 'reason');
    c.status = body.status; c.reason = reason; c.history.push({ status: c.status, reason, at: now() });
    audit(u, `contribution.${c.status}`, c.id, reason); store.save();
    return { contribution: contribView(c) };
  });
  route('GET', '/api/admin/reports', ({ req }) => {
    requireAdmin(req);
    return { items: db().reports.map((r) => { const c = db().comments.find((x) => x.id === r.comment_id); return { ...r, reporter_id: undefined, comment: c ? { id: c.id, entry_id: c.entry_id, tag: c.tag, text: c.text, status: c.status, handle: c.handle } : null }; }) };
  });
  route('PATCH', '/api/admin/reports/(r\\d+)', ({ req, params, body }) => {
    const u = requireAdmin(req);
    const r = db().reports.find((y) => y.id === params[0]); if (!r) throw new HttpError(404, 'not_found');
    if (!['keep', 'hide', 'delete'].includes(body.action)) throw bad('invalid_action');
    const c = db().comments.find((x) => x.id === r.comment_id);
    if (c && body.action === 'hide') c.status = 'hidden';
    if (c && body.action === 'delete') { c.status = 'deleted'; c.text = ''; }
    r.status = 'resolved'; r.resolution = `${body.action}${body.note ? `: ${optText(body.note, 300, 'note')}` : ''}`;
    audit(u, `report.${body.action}`, r.id); store.save();
    return { report: { ...r, reporter_id: undefined } };
  });
  route('PATCH', '/api/admin/comments/(c\\d+)', ({ req, params, body }) => {
    const u = requireAdmin(req);
    const c = db().comments.find((x) => x.id === params[0] && x.status !== 'deleted'); if (!c) throw new HttpError(404, 'not_found');
    if (!['visible', 'hidden'].includes(body.status)) throw bad('invalid_status');
    c.status = body.status; audit(u, `comment.${body.status}`, c.id); store.save();
    return { ok: true };
  });
  route('GET', '/api/admin/users', ({ req }) => {
    requireAdmin(req); const d = db();
    return { items: d.users.map((x) => ({
      id: x.id, handle: x.handle, role: x.role, disabled: x.disabled, created_at: x.created_at,
      comments: d.comments.filter((c) => c.user_id === x.id && c.status !== 'deleted').length,
      experiences_public: d.experiences.filter((e) => e.user_id === x.id && e.status === 'published').length,
      contributions: d.contributions.filter((c) => c.user_id === x.id).length,
      contributions_applied: d.contributions.filter((c) => c.user_id === x.id && c.status === 'applied').length,
    })) };
  });
  route('PATCH', '/api/admin/users/(u\\d+)', ({ req, params, body }) => {
    const u = requireAdmin(req);
    const t = db().users.find((x) => x.id === params[0]); if (!t) throw new HttpError(404, 'not_found');
    if (t.id === u.id) throw new HttpError(409, 'cannot_change_self');
    if (typeof body.disabled !== 'boolean') throw bad('invalid_field', { field: 'disabled' });
    t.disabled = body.disabled; audit(u, body.disabled ? 'user.disable' : 'user.enable', t.id); store.save();
    return { ok: true };
  });
  route('PUT', '/api/admin/settings', ({ req, body }) => {
    const u = requireAdmin(req); const s = db().settings;
    if (body.site_name !== undefined) s.site_name = cleanText(body.site_name, 60, 'site_name');
    if (body.domain !== undefined) s.domain = optText(body.domain, 120, 'domain');
    if (body.contact !== undefined) s.contact = optText(body.contact, 200, 'contact');
    s.ads_enabled = false; // 이번 버전에는 광고·제휴·유료 기능이 없다. 설정으로 켤 수 없다.
    audit(u, 'settings.update', 'settings'); store.save();
    return { settings: s };
  });
  route('GET', '/api/admin/audit', ({ req }) => { requireAdmin(req); return { items: db().audit.slice(-200).reverse() }; });
  // 내보내기는 관리자 전용. 공개 일괄 다운로드는 제공하지 않는다. 계정·세션·비밀번호는 포함하지 않는다.
  route('GET', '/api/admin/export', ({ req }) => {
    const u = requireAdmin(req); const d = db();
    audit(u, 'export', 'content'); store.save();
    return { format: 'context-atlas', schema_version: SCHEMA_VERSION, data_version: store.dataVersion(), exported_at: now(), settings: d.settings, entries: d.entries, sources: d.sources };
  });
  route('POST', '/api/admin/import', ({ req, body }) => {
    const u = requireAdmin(req);
    if (body.format !== 'context-atlas' || body.schema_version !== SCHEMA_VERSION) throw bad('unsupported_format', { expected_schema_version: SCHEMA_VERSION });
    if (!Array.isArray(body.entries)) throw bad('entries_required');
    const report = { added: [], updated: [], forced_to_draft: [], rejected: [] };
    const staged = [];
    for (const raw of body.entries) {
      const e = normalizeEntry(raw || {});
      const invalid = validateEntry(e);
      if (invalid.length) { report.rejected.push({ id: e.id || null, fields: invalid }); continue; }
      // 근거·권리 상태가 갖춰지지 않은 항목은 가져올 때 공개 상태를 유지할 수 없다.
      if (e.publication_status === 'published' && publishBlockers(e).length) { e.publication_status = 'draft'; report.forced_to_draft.push(e.id); }
      staged.push(e);
    }
    for (const e of staged) {
      const i = db().entries.findIndex((x) => x.id === e.id);
      if (i >= 0) {
        const prev = db().entries[i];
        const changes = diffFields(prev, e);
        e.revision_history = [...prev.revision_history, ...(Object.keys(changes).length ? [{ rev: prev.revision_history.length + 1, at: now(), by: u.handle, reason: 'JSON import', changes, contribution_id: null }] : [])];
        db().entries[i] = e; report.updated.push(e.id);
      } else { if (!Array.isArray(e.revision_history)) e.revision_history = []; db().entries.push(e); report.added.push(e.id); }
    }
    if (Array.isArray(body.sources)) for (const s of body.sources) {
      if (!s || typeof s.id !== 'string' || !/^S[A-Za-z0-9_-]+$/.test(s.id) || typeof s.url !== 'string') continue;
      const i = db().sources.findIndex((x) => x.id === s.id);
      if (i >= 0) db().sources[i] = s; else db().sources.push(s);
    }
    store.bumpContent(); audit(u, 'import', 'content', JSON.stringify({ added: report.added.length, updated: report.updated.length })); store.save();
    return { report, data_version: store.dataVersion() };
  }, { maxBody: 8e6 });

  // ── 요청 처리 ──
  function readBody(req, max) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > max) { reject(new HttpError(413, 'body_too_large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { if (!chunks.length) return resolve({}); try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); } catch { reject(bad('invalid_json')); } });
      req.on('error', reject);
    });
  }
  const sendJson = (res, status, body) => { res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

  function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.resolve(publicDir, rel);
    if (!file.startsWith(path.resolve(publicDir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': MIME['.txt'] }); return res.end('Not found');
    }
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed');
        return serveStatic(req, res, url.pathname);
      }
      limit(req, 'api');
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'not_found');
      if (r.opts.limit) limit(req, r.opts.limit);
      let body = {};
      if (req.method !== 'GET') {
        // 교차 사이트 요청 방어: SameSite=Strict 쿠키 + 사용자 정의 헤더 요구.
        if (req.headers['x-atlas-request'] !== '1') throw new HttpError(403, 'missing_request_header');
        body = await readBody(req, r.opts.maxBody || 1e6);
      }
      const out = await r.fn({ req, res, body, user: currentUser(req), query: Object.fromEntries(url.searchParams), params: r.re.exec(url.pathname).slice(1) });
      sendJson(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, ...(e.extra || {}) });
      console.error(e);
      sendJson(res, 500, { error: 'server_error' });
    }
  }

  return { handler, store, ensureAdmin, server: () => http.createServer(handler) };
}
