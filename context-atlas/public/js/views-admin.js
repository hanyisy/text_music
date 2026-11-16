// 10. 관리자 화면. 여기의 메뉴 숨김은 편의일 뿐이고, 권한은 서버(/api/admin/*)가 매 요청마다 검사한다.
// 관리자 화면 문구는 영어·한국어만 제공한다(그 밖의 화면 언어에서는 영어).
import { getLang, label, t } from './i18n.js';
import { h, api, state, badge, notice, section, field, select, withStatus, fmtDate, sourceBadge, editorialBadge } from './core.js';

const a = (en, ko) => (getLang() === 'ko' ? ko : en);
const STATUS_FIELDS = {
  publication_status: ['draft', 'published'], source_check_status: ['checked', 'partial', 'needs_research', 'not_applicable'],
  editorial_review_status: ['candidate', 'initial_draft', 'needs_review', 'reviewed'], local_review_status: ['not_reviewed', 'needs_native_review', 'reviewed'],
  rights_status: ['unclear', 'self_declared_independent', 'reviewed'], evidence_type: ['candidate', 'institutional_source', 'editorial_example'],
};
const NOT_IN_JSON = new Set(['id', 'origin', 'revision_history', 'publish_blockers', ...Object.keys(STATUS_FIELDS)]);
const pre = (v) => h('pre', { class: 'json' }, typeof v === 'string' ? v : JSON.stringify(v, null, 2));

export async function adminView() {
  if (!state.user || state.user.role !== 'admin') return h('div', {}, h('h1', {}, t('nav.admin')), notice(t('err.admin_only'), 'error'));
  const panel = h('div', {});
  const status = h('div', {});
  const tabs = [
    ['overview', a('Overview', '개요'), overview], ['entries', a('Entries & drafts', '항목·초안'), entries], ['sources', a('Sources', '출처'), sources],
    ['experiences', a('Experiences', '경험 검토'), experiences], ['contributions', a('Requests', '기여 신청'), contributions], ['reports', a('Reports', '신고'), reports],
    ['users', a('Contributors', '기여자'), users], ['data', a('Settings & data', '설정·데이터'), data],
  ];
  let current = 'overview';
  const nav = h('div', { class: 'pills', role: 'group', 'aria-label': t('nav.admin') });
  async function show(key) {
    current = key;
    nav.replaceChildren(...tabs.map(([k, text]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(k === current), onclick: () => show(k) }, text)));
    status.replaceChildren();
    await withStatus(status, async () => panel.replaceChildren(await tabs.find((x) => x[0] === key)[2]()));
  }
  const run = (fn, after = current) => withStatus(status, async () => { await fn(); await show(after); });

  async function overview() {
    const o = await api('GET', '/api/admin/overview');
    const row = (k, v) => [h('dt', {}, k), h('dd', {}, String(v))];
    return h('div', {}, h('dl', { class: 'status' },
      row(a('Entries (published / draft)', '항목(공개 / 초안)'), `${o.entries.published} / ${o.entries.draft}`),
      row(a('Experiences awaiting review', '검토 대기 경험'), o.pending_experiences), row(a('Open reports', '미처리 신고'), o.open_reports),
      row(a('Open requests', '처리 중 신청'), o.open_contributions), row(a('Accounts', '계정'), o.users), row(t('ft.version'), o.data_version)),
    notice(a('Only administrators can change publication status. Entries marked “needs research” or with unclear rights cannot be published until those statuses are resolved.', '공개 상태는 관리자만 바꿀 수 있습니다. ‘추가 조사’ 또는 권리 불명확 항목은 해당 상태를 먼저 해소해야 공개할 수 있습니다.')));
  }

  let editingId = null;
  async function entries() {
    const { items } = await api('GET', '/api/admin/entries');
    const filter = select([['', t('ui.all')], ['draft', a('Drafts', '초안')], ['published', a('Published', '공개')]], '');
    const tbody = h('tbody', {});
    const editor = h('div', {});
    const draw = () => tbody.replaceChildren(...items.filter((e) => !filter.value || e.publication_status === filter.value).map((e) => h('tr', {},
      h('th', { scope: 'row' }, e.id), h('td', { lang: e.language === 'und' ? null : e.language }, e.original_text.slice(0, 40)),
      h('td', {}, badge(e.publication_status === 'published' ? a('Published', '공개') : a('Draft', '초안'), e.publication_status === 'published' ? 'ok' : 'wait')),
      h('td', {}, sourceBadge(e.source_check_status)), h('td', {}, editorialBadge(e.editorial_review_status)),
      h('td', {}, e.publish_blockers.map((b) => label('blocker', b)).join(', ') || '—'),
      h('td', {}, h('button', { type: 'button', class: 'btn', onclick: () => edit(e) }, t('ui.edit'))))));
    filter.addEventListener('change', draw);
    async function edit(e) {
      editingId = e.id;
      const contribs = (await api('GET', '/api/admin/contributions')).items.filter((c) => ['received', 'in_review', 'on_hold'].includes(c.status));
      const sel = Object.fromEntries(Object.entries(STATUS_FIELDS).map(([k, opts]) => [k, select(opts.map((o) => [o, o]), e[k])]));
      const json = h('textarea', { rows: '16', class: 'json', spellcheck: 'false' });
      json.value = JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !NOT_IN_JSON.has(k))), null, 2);
      const reason = h('input', { type: 'text', required: true, maxlength: '500' });
      const contrib = select([['', '—'], ...contribs.map((c) => [c.id, `${c.id} · ${c.kind} · ${(c.text || '').slice(0, 40)}`])], '');
      const save = () => run(async () => {
        let content;
        try { content = JSON.parse(json.value); } catch { throw Object.assign(new Error('json'), { body: { error: 'invalid_json' } }); }
        const patch = { ...content, ...Object.fromEntries(Object.entries(sel).map(([k, s]) => [k, s.value])) };
        await api('PUT', `/api/admin/entries/${e.id}`, { patch, reason: reason.value, contribution_id: contrib.value || undefined });
      }, 'entries');
      editor.replaceChildren(h('section', { class: 'block' }, h('h2', {}, `${t('ui.edit')}: ${e.id}`),
        e.publish_blockers.length ? notice(`${a('Cannot be published yet', '아직 공개 불가')}: ${e.publish_blockers.map((b) => label('blocker', b)).join(', ')}`, 'info') : null,
        h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); save(); } },
          h('div', { class: 'filter-grid' }, Object.entries(sel).map(([k, s]) => field(k, s))),
          field(a('Content fields (JSON)', '내용 필드(JSON)'), json), field(a('Reason for change (shown in public history)', '수정 이유(공개 이력에 표시)'), reason),
          field(a('Apply a request (optional)', '반영할 기여 신청(선택)'), contrib),
          h('p', { class: 'actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, t('ui.save')))),
        h('h3', {}, t('d.history')),
        e.revision_history.length ? h('ol', { class: 'history' }, e.revision_history.map((r) => h('li', {},
          h('p', {}, `#${r.rev} · ${fmtDate(r.at)} · ${r.by} — ${r.reason} `, h('button', { type: 'button', class: 'btn', onclick: () => { if (window.confirm(a(`Revert revision ${r.rev}?`, `수정 ${r.rev}번을 되돌릴까요?`))) run(() => api('POST', `/api/admin/entries/${e.id}/revert`, { rev: r.rev }), 'entries'); } }, a('Revert', '되돌리기'))),
          Object.entries(r.changes).map(([k, c]) => h('div', { class: 'diff' }, h('p', { class: 'bi-label' }, k),
            h('div', { class: 'bilingual' }, h('div', { class: 'bi-col' }, h('p', { class: 'bi-label' }, a('Before', '수정 전')), pre(c.before)), h('div', { class: 'bi-col' }, h('p', { class: 'bi-label' }, a('After', '수정 후')), pre(c.after)))))))) : h('p', { class: 'hint' }, t('d.history.none'))));
      editor.scrollIntoView();
    }
    draw();
    const reopen = editingId && items.find((e) => e.id === editingId);
    if (reopen) await edit(reopen);
    return h('div', {}, field(a('Show', '보기'), filter),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['ID', a('Original', '원문'), a('Publication', '공개'), t('d.status.source'), t('d.status.editorial'), a('Blockers', '공개 차단 사유'), ''].map((x) => h('th', { scope: 'col' }, x)))), tbody)), editor);
  }

  async function sources() {
    const { items } = await api('GET', '/api/sources');
    const json = h('textarea', { rows: '12', class: 'json', spellcheck: 'false' });
    const pick = select(items.map((s) => [s.id, `${s.id} · ${s.title}`]), items[0] ? items[0].id : '', { onchange: () => fill() });
    const fill = () => { json.value = JSON.stringify(items.find((s) => s.id === pick.value), null, 2); };
    fill();
    return h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); run(async () => { const s = JSON.parse(json.value); await api('PUT', `/api/admin/sources/${s.id}`, { source: s }); }); } },
      field(a('Source', '출처'), pick), field('JSON (title, author, url, published_at, accessed_at, supported_claim, reuse_license, copied_excerpt)', json, a('Change the id to add a new source. Leave published_at null if the date is not confirmed.', 'id를 바꾸면 새 출처가 추가됩니다. 출판일을 확인하지 못했으면 published_at 은 null 로 둡니다.')),
      h('p', { class: 'actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, t('ui.save'))));
  }

  async function experiences() {
    const { items } = await api('GET', '/api/admin/experiences');
    return h('div', {}, notice(a('Only records whose author has consented to publication appear here. Private drafts are never sent to administrators.', '작성자가 공개에 동의한 기록만 여기에 나옵니다. 비공개 초안은 관리자에게도 전송되지 않습니다.')),
      items.length ? h('ul', { class: 'exp-list' }, items.map((x) => {
        const reason = h('input', { type: 'text', maxlength: '500', 'aria-label': t('k.reason') });
        const set = (s) => run(() => api('PATCH', `/api/admin/experiences/${x.id}`, { status: s, reason: reason.value }));
        return h('li', {}, h('p', { class: 'meta' }, badge(t(`xs.${x.status}`), x.status === 'published' ? 'ok' : 'wait'), ` ${[x.id, t(`x.kind.${x.kind}`), x.entry_id, x.region_broad, x.period].filter(Boolean).join(' · ')}`),
          h('p', { class: 'prose' }, x.text), field(t('k.reason'), reason),
          h('p', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => set('published') }, a('Approve for publication', '공개 승인')), h('button', { type: 'button', class: 'btn', onclick: () => set('rejected') }, a('Do not publish', '공개하지 않음'))));
      })) : h('p', { class: 'hint' }, t('ui.none')));
  }

  async function contributions() {
    const { items } = await api('GET', '/api/admin/contributions');
    return items.length ? h('ul', { class: 'exp-list' }, items.map((c) => {
      const st = select(['received', 'in_review', 'on_hold', 'rejected', 'applied'].map((s) => [s, t(`ks.${s}`)]), c.status);
      const reason = h('input', { type: 'text', maxlength: '500', value: c.reason || '' });
      return h('li', {}, h('p', { class: 'meta' }, badge(t(`ks.${c.status}`), 'info'), ` ${[c.id, t(`k.kind.${c.kind}`), c.entry_id, c.user_handle, fmtDate(c.created_at)].filter(Boolean).join(' · ')}`),
        h('p', { class: 'prose' }, c.text), c.source_url ? h('p', {}, h('a', { href: c.source_url, rel: 'noopener noreferrer external nofollow', target: '_blank' }, c.source_url)) : null,
        h('div', { class: 'filter-grid' }, field(a('Status', '상태'), st), field(a('Reason (required for on hold / declined)', '이유(보류·반려는 필수)'), reason)),
        h('p', { class: 'hint' }, a('To apply a correction, edit the entry and choose this request there — the revision is then linked to it.', '수정을 반영하려면 항목 편집에서 이 신청을 선택하세요. 수정 이력과 연결됩니다.')),
        h('p', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => run(() => api('PATCH', `/api/admin/contributions/${c.id}`, { status: st.value, reason: reason.value })) }, t('ui.save'))));
    })) : h('p', { class: 'hint' }, t('ui.none'));
  }

  async function reports() {
    const { items } = await api('GET', '/api/admin/reports');
    return items.length ? h('ul', { class: 'exp-list' }, items.map((r) => {
      const act = (action, text) => h('button', { type: 'button', class: 'btn', onclick: () => run(() => api('PATCH', `/api/admin/reports/${r.id}`, { action })) }, text);
      return h('li', {}, h('p', { class: 'meta' }, badge(r.status, r.status === 'open' ? 'wait' : 'ok'), ` ${r.id} · ${fmtDate(r.created_at)}${r.resolution ? ` · ${r.resolution}` : ''}`),
        h('p', {}, `${t('k.reason')}: ${r.reason}`),
        r.comment ? h('blockquote', {}, h('p', { class: 'meta' }, `${r.comment.id} · ${r.comment.entry_id} · ${r.comment.handle} · ${r.comment.status}`), h('p', { class: 'prose' }, r.comment.text)) : null,
        r.status === 'open' ? h('p', { class: 'actions' }, act('keep', a('Keep comment', '댓글 유지')), act('hide', a('Hide comment', '댓글 가리기')), act('delete', a('Delete comment', '댓글 삭제'))) : null);
    })) : h('p', { class: 'hint' }, t('ui.none'));
  }

  async function users() {
    const { items } = await api('GET', '/api/admin/users');
    return h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, [a('Nickname', '별명'), a('Role', '역할'), a('Joined', '가입'), a('Comments', '댓글'), a('Public experiences', '공개 경험'), a('Requests (applied)', '신청(반영)'), ''].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, items.map((u) => h('tr', {}, h('th', { scope: 'row' }, u.handle), h('td', {}, u.role), h('td', {}, fmtDate(u.created_at)), h('td', {}, String(u.comments)), h('td', {}, String(u.experiences_public)), h('td', {}, `${u.contributions} (${u.contributions_applied})`),
        h('td', {}, u.id === state.user.id ? '—' : h('button', { type: 'button', class: 'btn', onclick: () => run(() => api('PATCH', `/api/admin/users/${u.id}`, { disabled: !u.disabled })) }, u.disabled ? a('Enable', '사용 재개') : a('Disable', '사용 중지'))))))));
  }

  async function data() {
    const name = h('input', { type: 'text', value: state.site.site_name, maxlength: '60', required: true });
    const domain = h('input', { type: 'text', value: state.site.domain || '', maxlength: '120' });
    const contact = h('input', { type: 'text', value: state.site.contact || '', maxlength: '200' });
    const file = h('input', { type: 'file', accept: 'application/json,.json' });
    const out = h('div', {});
    const audit = (await api('GET', '/api/admin/audit')).items;
    return h('div', {},
      section(a('Site settings', '사이트 설정'), h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); run(async () => { await api('PUT', '/api/admin/settings', { site_name: name.value, domain: domain.value, contact: contact.value }); Object.assign(state.site, await api('GET', '/api/site')); document.dispatchEvent(new Event('atlas:site')); }); } },
        field(a('Site name', '사이트명'), name), field(a('Domain (shown in notices; DNS is configured at your host)', '도메인(안내에 표시. 실제 연결은 호스팅에서 설정)'), domain),
        field(a('Contact channel shown on the About page', '안내 화면에 표시할 연락 창구'), contact),
        h('p', { class: 'hint' }, a('Advertising, affiliate links and paid features do not exist in this version and cannot be switched on here. This site’s pages load scripts only from this site.', '이번 버전에는 광고·제휴 링크·유료 기능이 없으며 여기서 켤 수 없습니다. 이 사이트의 페이지는 이 사이트의 스크립트만 불러옵니다.')),
        h('p', { class: 'actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, t('ui.save'))))),
      section(a('Export (administrators only)', '내보내기(관리자 전용)'), h('p', { class: 'hint' }, a('Includes private drafts. Accounts, passwords and community records are not included. There is no public bulk download.', '비공개 초안이 포함됩니다. 계정·비밀번호·이용자 기록은 포함하지 않습니다. 공개 일괄 다운로드는 제공하지 않습니다.')),
        h('p', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => withStatus(status, async () => {
          const d = await api('GET', '/api/admin/export');
          const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
          const link = h('a', { href: url, download: `context-atlas-${d.data_version}.json` }); document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
        }) }, a('Download JSON', 'JSON 내려받기')))),
      section(a('Import JSON', 'JSON 가져오기'), h('p', { class: 'hint' }, a('Entries with the same ID are replaced and the change is recorded. Entries that still need research or have unclear rights are imported as drafts even if the file marks them published.', '같은 ID의 항목은 교체되고 변경이 기록됩니다. 추가 조사가 필요하거나 권리가 불명확한 항목은 파일에 공개로 적혀 있어도 초안으로 가져옵니다.')),
        field(a('File', '파일'), file), h('p', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => withStatus(status, async () => {
          if (!file.files[0]) return;
          const r = await api('POST', '/api/admin/import', JSON.parse(await file.files[0].text()));
          out.replaceChildren(pre(r));
        }) }, a('Import', '가져오기'))), out),
      section(a('Audit log (latest 200)', '작업 기록(최근 200건)'), h('ol', { class: 'history' }, audit.map((x) => h('li', {}, `${x.at.slice(0, 16).replace('T', ' ')} · ${x.by} · ${x.action} · ${x.target}${x.note ? ` — ${x.note}` : ''}`)))));
  }

  await show('overview');
  return h('div', {}, h('h1', {}, t('nav.admin')), nav, status, panel);
}
