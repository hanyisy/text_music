// 공통 도구: DOM 생성, API 호출, 본문 번역 표시 규칙, 배지.
// innerHTML 을 쓰지 않는다 — 이용자 글은 항상 textContent 로 넣는다.
import { t, label, langName, getLang } from './i18n.js';

export const state = { site: null, user: null, showOriginals: false, revealed: new Set() };

const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장소를 못 써도 화면은 동작한다 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* noop */ } },
};
export { store };

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'required' || k === 'open') el[k] = !!v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

export class ApiError extends Error { constructor(status, body) { super(body.error || 'error'); this.status = status; this.body = body; } }
export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-atlas-request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new ApiError(0, { error: 'network' }); }
  let data = {};
  try { data = await res.json(); } catch { /* 본문 없는 응답 */ }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export function errorText(e) {
  const code = e instanceof ApiError ? e.body.error : null;
  if (code === 'network') return t('ui.server.down');
  if (code === 'publish_blocked') return t('err.publish_blocked', { blockers: (e.body.blockers || []).map((b) => label('blocker', b)).join(', ') });
  const key = `err.${code}`;
  const msg = t(key);
  return msg === key ? `${t('err.generic')}${code ? ` (${code})` : ''}` : msg;
}

// ── 상태 배지: 색에만 의존하지 않도록 기호 + 글자를 함께 쓴다 ──
const MARK = { ok: '●', warn: '◐', info: '○', wait: '◌', alert: '▲' };
export const badge = (text, tone = 'info') => h('span', { class: `badge badge-${tone}` }, h('span', { class: 'badge-mark', 'aria-hidden': 'true' }, MARK[tone] || MARK.info), text);
const CLS_TONE = { group_derogation: 'alert', prejudice_stereotype: 'warn', rude_insult: 'warn', cultural_misunderstanding: 'info', neutral_in_context: 'ok', insufficient_data: 'wait' };
export const clsBadge = (c) => badge(label('cls', c), CLS_TONE[c] || 'info');
export const sourceBadge = (s) => badge(label('source', s), { checked: 'ok', partial: 'warn', needs_research: 'wait', not_applicable: 'info' }[s]);
export const editorialBadge = (s) => badge(label('editorial', s), { reviewed: 'ok', needs_review: 'warn', initial_draft: 'info', candidate: 'wait' }[s]);

// ── 본문 번역 규칙 ──
// 화면 언어와 표현 원어는 독립적이다. 화면 언어 번역이 없으면 지어내지 않고 원문 + ‘번역 검토 중’을 보여 준다.
export function loc(field, entry) {
  if (!field || typeof field !== 'object') return null;
  const ui = getLang();
  const base = entry.content_lang || 'ko';
  const origText = field[base] || Object.values(field)[0];
  if (!origText) return null;
  const origLang = field[base] ? base : Object.keys(field)[0];
  if (ui === origLang) return { text: origText, lang: origLang, kind: 'original' };
  if (field[ui]) return { text: field[ui], lang: ui, kind: 'translated', status: (entry.translation_status || {})[ui] || 'draft_unreviewed', origText, origLang };
  return { text: origText, lang: origLang, kind: 'pending' };
}
// 한 줄 표시(목록용): 번역이 있으면 번역, 없으면 원문 + 배지.
export function locInline(field, entry, tag = 'p', cls = '') {
  const r = loc(field, entry);
  if (!r) return null;
  return h(tag, { class: cls, lang: r.lang }, r.text, r.kind === 'pending' ? [' ', badge(t('tr.pending'), 'wait')] : null);
}
// 상세 표시: 번역이 있으면 원문과 번역을 나란히, 없으면 원문 + ‘번역 검토 중’.
export function locBlock(field, entry) {
  const r = loc(field, entry);
  if (!r) return null;
  if (r.kind === 'original') return h('p', { class: 'prose', lang: r.lang }, r.text);
  if (r.kind === 'pending') return h('div', { class: 'pending-tr' }, h('p', { class: 'prose', lang: r.lang }, r.text), h('p', { class: 'meta' }, badge(t('tr.pending'), 'wait'), ' ', `${t('tr.original')}: ${langName(r.lang)}`));
  return h('div', { class: 'bilingual' },
    h('div', { class: 'bi-col' }, h('p', { class: 'bi-label' }, `${t('tr.translation')} · ${langName(r.lang)} `, r.status === 'reviewed' ? null : badge(t('tr.draft'), 'warn')), h('p', { class: 'prose', lang: r.lang }, r.text)),
    h('div', { class: 'bi-col bi-orig' }, h('p', { class: 'bi-label' }, `${t('tr.original')} · ${langName(r.origLang)}`), h('p', { class: 'prose', lang: r.origLang }, r.origText)));
}

// ── 원문 표현 표시: 비하 표현을 인용한 항목은 기본으로 가리고, 선택하면 보여 준다. 검색·설명에는 그대로 쓰인다. ──
export function originalText(entry, cls = 'orig') {
  const titled = entry.entry_type === 'scenario' || entry.entry_type === 'nonverbal';
  if (titled) {
    const r = loc(entry.title || { [entry.content_lang || 'ko']: entry.original_text }, entry);
    return h('span', { class: cls, lang: r.lang }, r.text);
  }
  const lang = entry.language === 'und' ? null : entry.language;
  if (!entry.content_note || state.showOriginals || state.revealed.has(entry.id)) return h('span', { class: cls, lang }, entry.original_text);
  const wrap = h('span', { class: `${cls} orig-hidden` });
  const btn = h('button', { type: 'button', class: 'linklike', title: t('orig.note'), onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); state.revealed.add(entry.id); wrap.replaceWith(originalText(entry, cls)); } }, t('orig.show'));
  wrap.append(h('span', { class: 'orig-mask' }, t('orig.hidden')), ' ', btn, h('span', { class: 'sr-only' }, ` — ${t('orig.note')}`));
  return wrap;
}

export const entryMeta = (e) => h('p', { class: 'meta' }, [label('type', e.entry_type), e.language !== 'und' ? langName(e.language) : null, e.id].filter(Boolean).join(' · '));
export const chips = (items) => h('ul', { class: 'chips' }, items.map((x) => h('li', {}, x)));
export const notice = (text, tone = 'info') => h('p', { class: `notice notice-${tone}`, role: tone === 'error' ? 'alert' : 'status' }, text);
export const section = (title, ...body) => h('section', { class: 'block' }, h('h2', {}, title), body);

// 폼 도우미: 라벨과 입력을 항상 연결한다.
let uid = 0;
export function field(labelText, control, hint) {
  const id = control.id || `f${uid += 1}`;
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, labelText), control, hint ? h('p', { class: 'hint' }, hint) : null);
}
export const select = (options, value, attrs = {}) => h('select', attrs, options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
export async function withStatus(statusEl, fn) {
  statusEl.replaceChildren();
  try { return await fn(); } catch (e) { statusEl.replaceChildren(notice(errorText(e), 'error')); return undefined; }
}
export const fmtDate = (iso) => (iso ? String(iso).slice(0, 10) : '—');
