// 참여 화면: 계정, 댓글, 경험 기록, 기여 신청. 모든 저장은 서버에서 권한을 검사한다.
import { t, langName, UI_LANGS } from './i18n.js';
import { h, api, state, badge, notice, section, field, select, withStatus, originalText, fmtDate, errorText } from './core.js';

const signInPrompt = () => h('p', { class: 'notice notice-info' }, t('ui.signin.needed'), ' ', h('a', { href: '#/account' }, t('nav.account')));
const entryOptions = async (noneLabel) => {
  const { items } = await api('GET', '/api/entries');
  return [['', noneLabel], ...items.map((e) => [e.id, `${e.id} · ${e.content_note && !state.showOriginals ? t('orig.hidden') : (e.title && (e.title.en || e.title.ko)) || e.original_text}`.slice(0, 70)])];
};

// ── 계정 ──
export async function accountView(rerenderShell) {
  const status = h('div', {});
  if (state.user) {
    return h('div', {}, h('h1', {}, t('a.title')), h('p', { class: 'lead' }, t('a.signed', { handle: state.user.handle })), status,
      h('p', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => withStatus(status, async () => { await api('POST', '/api/auth/logout', {}); state.user = null; rerenderShell(); }) }, t('a.logout')),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: () => { if (window.confirm(t('a.delete.q'))) withStatus(status, async () => { await api('DELETE', '/api/me', {}); state.user = null; rerenderShell(); }); } }, t('a.delete'))));
  }
  const handle = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, maxlength: '24' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true, minlength: '10' });
  const go = (path) => withStatus(status, async () => {
    const r = await api('POST', path, { handle: handle.value, password: password.value });
    state.user = r.user; rerenderShell();
  });
  return h('div', { class: 'narrow' }, h('h1', {}, t('a.title')), h('p', { class: 'lead' }, t('a.lead')),
    h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); go('/api/auth/login'); } },
      field(t('a.handle'), handle), field(t('a.password'), password), status,
      h('p', { class: 'actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, t('a.login')),
        h('button', { type: 'button', class: 'btn', onclick: () => go('/api/auth/register') }, t('a.register')))));
}

// ── 댓글 (상세 화면 하단) ──
export async function commentsSection(entryId) {
  const list = h('div', {});
  const status = h('div', {});
  async function load() {
    const { items } = await api('GET', `/api/entries/${entryId}/comments`);
    list.replaceChildren(items.length ? h('ul', { class: 'comments' }, items.map((c) => h('li', { class: 'comment' },
      h('p', { class: 'meta' }, badge(t(`c.tag.${c.tag}`), 'info'), ` ${c.handle} · ${fmtDate(c.created_at)}`),
      c.status === 'hidden' ? h('p', { class: 'hint' }, t('c.hidden')) : h('p', { class: 'prose' }, c.text),
      c.status === 'visible' && state.user ? h('p', { class: 'actions small' },
        c.mine ? h('button', { type: 'button', class: 'linklike', onclick: () => withStatus(status, async () => { await api('DELETE', `/api/comments/${c.id}`, {}); await load(); }) }, t('ui.delete'))
          : h('button', { type: 'button', class: 'linklike', onclick: () => { const reason = window.prompt(t('c.report.reason')); if (reason && reason.trim()) withStatus(status, async () => { await api('POST', `/api/comments/${c.id}/report`, { reason }); status.replaceChildren(notice(t('c.reported'))); }); } }, t('c.report'))) : null))) : h('p', { class: 'hint' }, t('c.none')));
  }
  await load();
  let form = signInPrompt();
  if (state.user) {
    const tag = select(['question', 'experience', 'regional_difference', 'evidence', 'disagreement'].map((x) => [x, t(`c.tag.${x}`)]), 'question');
    const text = h('textarea', { rows: '3', required: true, maxlength: '2000' });
    form = h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); withStatus(status, async () => { await api('POST', `/api/entries/${entryId}/comments`, { tag: tag.value, text: text.value }); text.value = ''; await load(); }); } },
      field(t('c.tag'), tag), field(t('c.text'), text, t('x.privacy')), h('p', { class: 'actions' }, h('button', { type: 'submit', class: 'btn' }, t('c.post'))));
  }
  return h('section', { class: 'block comments-block' }, h('h2', {}, t('c.title')), h('p', { class: 'hint' }, t('c.note')), list, status, form);
}

// ── 7. 경험 기록 ──
export async function experiencesView(query) {
  const pub = (await api('GET', '/api/experiences')).items;
  const mineBox = h('div', {});
  const status = h('div', {});
  const head = [h('h1', {}, t('nav.experiences')), h('p', { class: 'lead' }, t('x.lead')), notice(t('x.privacy'))];
  const publicBlock = section(t('x.public'), h('p', { class: 'hint' }, t('x.public.note')),
    pub.length ? h('ul', { class: 'exp-list' }, pub.map((x) => h('li', {}, h('p', { class: 'meta' }, [t(`x.kind.${x.kind}`), x.entry_id, x.region_broad, x.period].filter(Boolean).join(' · ')), h('p', { class: 'prose' }, x.text)))) : h('p', { class: 'hint' }, t('x.public.none')));
  if (!state.user) return h('div', {}, head, signInPrompt(), publicBlock);

  const options = await entryOptions(t('ui.none'));
  let editing = null;
  const kinds = ['heard', 'witnessed', 'used', 'changed_mind'].map((k, i) => ({ k, input: h('input', { type: 'radio', name: 'kind', value: k, checked: i === 0 }) }));
  const entry = select(options, query.entry || '');
  const text = h('textarea', { rows: '5', required: true, maxlength: '3000' });
  const region = h('input', { type: 'text', maxlength: '60' });
  const period = h('input', { type: 'text', maxlength: '40' });
  const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, t('x.save'));
  const cancelBtn = h('button', { type: 'button', class: 'btn', hidden: true, onclick: () => resetForm() }, t('ui.cancel'));
  function resetForm() { editing = null; text.value = ''; region.value = ''; period.value = ''; kinds[0].input.checked = true; cancelBtn.hidden = true; }
  const form = h('form', { class: 'form', onsubmit: (ev) => {
    ev.preventDefault();
    withStatus(status, async () => {
      const body = { kind: kinds.find((x) => x.input.checked).k, entry_id: entry.value || null, text: text.value, region_broad: region.value, period: period.value };
      if (editing) await api('PUT', `/api/experiences/${editing}`, body); else await api('POST', '/api/experiences', body);
      resetForm(); await loadMine();
    });
  } },
    h('fieldset', {}, h('legend', {}, t('x.kind')), kinds.map((x) => h('label', { class: 'option' }, x.input, h('span', {}, t(`x.kind.${x.k}`)))), h('p', { class: 'hint' }, t('x.kind.note'))),
    field(`${t('x.entry')} (${t('ui.optional')})`, entry), field(t('x.text'), text),
    field(`${t('x.region')} (${t('ui.optional')})`, region), field(`${t('x.period')} (${t('ui.optional')})`, period),
    status, h('p', { class: 'actions' }, submitBtn, cancelBtn));

  const tone = { draft: 'info', pending_review: 'wait', published: 'ok', withdrawn: 'info', rejected: 'warn' };
  async function loadMine() {
    const { items } = await api('GET', '/api/me/experiences');
    const act = (label2, fn, cls = 'btn') => h('button', { type: 'button', class: cls, onclick: () => withStatus(status, async () => { await fn(); await loadMine(); }) }, label2);
    mineBox.replaceChildren(items.length ? h('ul', { class: 'exp-list' }, items.map((x) => {
      const consent = h('input', { type: 'checkbox' });
      const canEdit = ['draft', 'withdrawn', 'rejected'].includes(x.status);
      return h('li', {},
        h('p', { class: 'meta' }, badge(t(`xs.${x.status}`), tone[x.status]), ` ${[t(`x.kind.${x.kind}`), x.entry_id, x.region_broad, x.period].filter(Boolean).join(' · ')}`),
        h('p', { class: 'prose' }, x.text),
        x.review_reason ? h('p', { class: 'hint' }, `${t('k.reason')}: ${x.review_reason}`) : null,
        x.status === 'draft' ? h('div', { class: 'consent' }, h('label', { class: 'check' }, consent, ' ', t('x.consent.q')),
          h('p', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => withStatus(status, async () => { await api('POST', `/api/experiences/${x.id}/consent`, { consent: consent.checked }); await loadMine(); }) }, t('x.consent')))) : null,
        h('p', { class: 'actions small' },
          canEdit ? h('button', { type: 'button', class: 'btn', onclick: () => { editing = x.id; text.value = x.text; region.value = x.region_broad; period.value = x.period; entry.value = x.entry_id || ''; kinds.find((k) => k.k === x.kind).input.checked = true; cancelBtn.hidden = false; text.focus(); } }, t('ui.edit')) : null,
          ['pending_review', 'published'].includes(x.status) ? act(t('x.withdraw'), () => api('POST', `/api/experiences/${x.id}/withdraw`, {})) : null,
          act(t('ui.delete'), () => api('DELETE', `/api/experiences/${x.id}`, {}), 'btn btn-danger')));
    })) : h('p', { class: 'hint' }, t('x.mine.none')));
  }
  await loadMine();
  return h('div', {}, head, form, section(t('x.mine'), mineBox), publicBlock);
}

// ── 8. 기여 ──
export async function contributeView(query) {
  const head = [h('h1', {}, t('nav.contribute')), h('p', { class: 'lead' }, t('k.lead')),
    h('ul', { class: 'chips' }, ['received', 'in_review', 'applied', 'on_hold', 'rejected'].map((s) => h('li', {}, t(`ks.${s}`))))];
  if (!state.user) return h('div', {}, head, signInPrompt());
  const status = h('div', {});
  const mineBox = h('div', {});
  const kind = select(['add', 'edit', 'source', 'translation'].map((k) => [k, t(`k.kind.${k}`)]), query.entry ? 'edit' : 'add');
  const entry = select(await entryOptions(t('k.entry.new')), query.entry || '');
  const text = h('textarea', { rows: '6', required: true, maxlength: '4000' });
  const url = h('input', { type: 'url', maxlength: '500', placeholder: 'https://' });
  const tlang = select([['', t('ui.none')], ...UI_LANGS.map((l) => [l, langName(l)])], '');
  const grant = h('input', { type: 'checkbox' });
  const tone = { received: 'info', in_review: 'wait', applied: 'ok', on_hold: 'warn', rejected: 'warn' };
  async function loadMine() {
    const { items } = await api('GET', '/api/me/contributions');
    mineBox.replaceChildren(items.length ? h('ul', { class: 'exp-list' }, items.map((c) => h('li', {},
      h('p', { class: 'meta' }, badge(t(`ks.${c.status}`), tone[c.status]), ` ${[t(`k.kind.${c.kind}`), c.entry_id, fmtDate(c.created_at)].filter(Boolean).join(' · ')}`),
      h('p', { class: 'prose' }, c.text),
      c.reason ? h('p', { class: 'hint' }, `${t('k.reason')}: ${c.reason}`) : null,
      c.applied_revision ? h('p', { class: 'hint' }, h('a', { href: `#/entry/${c.applied_revision.entry_id}` }, t('k.applied.rev', { id: c.applied_revision.entry_id, rev: String(c.applied_revision.rev) }))) : null,
      h('ol', { class: 'history' }, c.history.map((x) => h('li', {}, `${fmtDate(x.at)} — ${t(`ks.${x.status}`)}${x.reason ? `: ${x.reason}` : ''}`)))))) : h('p', { class: 'hint' }, t('k.mine.none')));
  }
  await loadMine();
  const form = h('form', { class: 'form', onsubmit: (ev) => {
    ev.preventDefault();
    withStatus(status, async () => {
      await api('POST', '/api/contributions', { kind: kind.value, entry_id: entry.value || null, text: text.value, source_url: url.value, target_language: tlang.value, license_grant: grant.checked });
      text.value = ''; url.value = ''; grant.checked = false; await loadMine();
    });
  } },
    field(t('k.kind'), kind), field(t('k.entry'), entry), field(t('k.text'), text, t('k.own')),
    field(`${t('k.url')} (${t('ui.optional')})`, url), field(`${t('k.tlang')} (${t('ui.optional')})`, tlang),
    h('label', { class: 'check' }, grant, ' ', t('k.grant')), status,
    h('p', { class: 'actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, t('ui.submit'))));
  return h('div', {}, head, notice(t('x.privacy')), form, section(t('k.mine'), mineBox));
}
export { errorText, originalText };
