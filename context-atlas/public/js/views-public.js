// 공개 화면: 홈, 사전, 상세, 보호어, 여행·문화 비교, 테스트.
import { t, label, langName, regionName, getLang, REGION_CONTINENT, CONTINENTS } from './i18n.js';
import { h, api, state, store, badge, clsBadge, sourceBadge, editorialBadge, loc, locInline, locBlock, originalText, entryMeta, chips, notice, section, select, field, fmtDate } from './core.js';
import { commentsSection } from './views-community.js';

const uniq = (a) => [...new Set(a)];

export function entryCard(e) {
  return h('article', { class: 'card' },
    h('h3', { class: 'card-title' }, originalText(e)),
    entryMeta(e),
    locInline(e.neutral_meaning, e, 'p', 'card-text'),
    h('div', { class: 'badges' }, uniq(e.usages.map((u) => u.classification)).map(clsBadge), e.protected_word ? badge(t('nav.protected'), 'info') : null),
    h('p', { class: 'card-foot' }, h('a', { href: `#/entry/${e.id}`, 'aria-label': `${t('ui.view')} ${e.id}` }, `${t('ui.view')} →`)));
}

// ── 1. 홈 ──
export async function homeView() {
  const s = await api('GET', '/api/stats');
  const q = h('input', { type: 'search', name: 'q', placeholder: t('ui.search.ph'), autocomplete: 'off' });
  const tile = (n, text, extra) => h('div', { class: 'stat' }, h('p', { class: 'stat-n' }, String(n)), h('p', { class: 'stat-l' }, text), extra);
  const bars = (rows, max) => h('ul', { class: 'bars' }, rows.map((r) => h('li', {},
    h('div', { class: 'bar-head' }, h('span', {}, r.name), h('span', { class: 'bar-n' }, r.count === 1 ? t('home.entries.one') : t('home.entries.n', { n: String(r.count) }))),
    h('div', { class: 'bar-track', 'aria-hidden': 'true' }, h('div', { class: 'bar-fill', style: { width: `${Math.round((r.count / max) * 100)}%` } })),
    r.note ? h('p', { class: 'hint' }, r.note) : null)));
  const maxL = Math.max(1, ...s.by_language.map((x) => x.entries));
  const maxT = Math.max(1, ...s.by_topic.map((x) => x.count));
  return h('div', {},
    h('section', { class: 'hero' },
      h('h1', {}, state.site.site_name),
      h('p', { class: 'lead' }, t('home.lead')),
      h('form', { class: 'searchbar', role: 'search', onsubmit: (ev) => { ev.preventDefault(); location.hash = `#/dictionary?q=${encodeURIComponent(q.value.trim())}`; } },
        h('label', { class: 'sr-only', for: 'home-q' }, t('ui.search')), Object.assign(q, { id: 'home-q' }), h('button', { type: 'submit', class: 'btn btn-primary' }, t('ui.search')))),
    h('section', { class: 'stats', 'aria-label': t('home.seed') },
      tile(s.entries_total, t('home.stat.entries'), badge(t('home.seed'), 'info')),
      tile(s.sentences, t('home.stat.sentences')),
      tile(s.experiences_public, t('home.stat.exp'))),
    h('p', { class: 'hint' }, t('home.seed.note', { n: String(s.initial_seed_entries) })),
    h('div', { class: 'two-col' },
      section(t('home.bylang'), bars(s.by_language.map((x) => ({
        name: langName(x.language), count: x.entries,
        note: `${t('home.scope', { a: String(x.scope.institutional_source), b: String(x.scope.editorial_example), c: String(x.scope.locally_reviewed) })} ${x.contributors} ${t('home.contributors')}.`,
      })), maxL)),
      section(t('home.bytopic'), bars(s.by_topic.map((x) => ({ name: label('topic', x.topic), count: x.count })), maxT), h('p', { class: 'hint' }, t('home.topic.note')))),
    notice(t('home.rank.note')));
}

// ── 2. 사전 ──
const FILTERS = [['language', 'f.language', langName], ['region', 'f.region', regionName], ['topic', 'f.topic', (c) => label('topic', c)], ['type', 'f.type', (c) => label('type', c)],
  ['classification', 'f.classification', (c) => label('cls', c)], ['situation', 'f.situation', (c) => label('situation', c)], ['review', 'f.review', (c) => label('editorial', c)], ['source', 'f.source', (c) => label('source', c)]];

export async function dictionaryView(query) {
  const fac = await api('GET', '/api/facets');
  const q = h('input', { type: 'search', value: query.q || '', placeholder: t('ui.search.ph'), autocomplete: 'off' });
  const selects = {};
  const prot = h('input', { type: 'checkbox', checked: query.protected === '1' });
  const results = h('div', { class: 'results', 'aria-live': 'polite' });
  const params = () => {
    const p = new URLSearchParams();
    if (q.value.trim()) p.set('q', q.value.trim());
    for (const [k] of FILTERS) if (selects[k].value) p.set(k, selects[k].value);
    if (prot.checked) p.set('protected', '1');
    return p;
  };
  async function update() {
    const p = params();
    history.replaceState(null, '', `#/dictionary${p.size ? `?${p}` : ''}`);
    const r = await api('GET', `/api/entries?${p}`);
    results.replaceChildren(
      h('p', { class: 'meta' }, t('dict.results', { n: String(r.count), total: String(r.total_public) })),
      r.count ? h('div', { class: 'cards' }, r.items.map(entryCard)) : h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, t('dict.empty')), h('p', {}, t('dict.empty.hint'))));
  }
  const filterFields = FILTERS.map(([k, key, name]) => {
    selects[k] = select([['', t('ui.all')], ...fac[k].map((x) => [x.key, `${name(x.key)} (${x.count})`])], query[k] || '', { onchange: update });
    return field(t(key), selects[k]);
  });
  const reset = () => { q.value = ''; for (const s of Object.values(selects)) s.value = ''; prot.checked = false; update(); };
  prot.addEventListener('change', update);
  await update();
  return h('div', {},
    h('h1', {}, t('nav.dictionary')),
    h('form', { class: 'searchbar', role: 'search', onsubmit: (ev) => { ev.preventDefault(); update(); } },
      h('label', { class: 'sr-only', for: 'dict-q' }, t('ui.search')), Object.assign(q, { id: 'dict-q' }), h('button', { type: 'submit', class: 'btn btn-primary' }, t('ui.search'))),
    h('details', { class: 'filters', open: window.matchMedia('(min-width: 720px)').matches || Object.keys(query).some((k) => k !== 'q') },
      h('summary', {}, t('f.filters')),
      h('div', { class: 'filter-grid' }, filterFields),
      h('div', { class: 'filter-foot' }, h('label', { class: 'check' }, prot, ' ', t('f.protected')), h('button', { type: 'button', class: 'btn', onclick: reset }, t('ui.reset')))),
    results);
}

// ── 3. 상세 ──
export async function entryView(id) {
  const { entry: e, sources, related } = await api('GET', `/api/entries/${encodeURIComponent(id)}`);
  const exps = (await api('GET', `/api/experiences?entry=${encodeURIComponent(e.id)}`)).items;
  const ui = getLang();
  const opt = (titleKey, f) => (loc(f, e) ? section(t(titleKey), locBlock(f, e)) : null);
  const relSummary = new Map(related.map((r) => [r.id, r]));
  const trStatus = ui === (e.content_lang || 'ko') ? 'original' : ((e.translation_status || {})[ui] || 'none');
  const row = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
  return h('article', { class: 'entry' },
    h('p', {}, h('a', { href: '#/dictionary' }, `← ${t('nav.dictionary')}`)),
    h('header', { class: 'entry-head' },
      h('h1', { class: 'entry-title' }, originalText(e)),
      entryMeta(e),
      e.content_note ? h('p', { class: 'hint' }, t('orig.note')) : null,
      loc(e.local_scope, e) ? h('p', { class: 'meta' }, `${t('f.region')}: `, e.region ? regionName(e.region) : '', e.region && loc(e.local_scope, e).text === regionName(e.region) ? null : [e.region ? ' — ' : '', locInline(e.local_scope, e, 'span')]) : null,
      h('div', { class: 'badges' }, sourceBadge(e.source_check_status), editorialBadge(e.editorial_review_status), e.protected_word ? badge(`${t('nav.protected')}${e.protected_word === 'candidate' ? ` · ${t('p.candidate')}` : ''}`, 'info') : null),
      chips(e.topics.map((x) => label('topic', x)))),
    notice(t('d.legal')),
    section(t(e.entry_type === 'scenario' ? 'f.situation' : 'd.meaning'), locBlock(e.neutral_meaning, e)),
    e.usages.length ? section(t('d.usages'), h('p', { class: 'hint' }, t('d.usages.note')),
      h('ol', { class: 'usages' }, e.usages.map((u) => h('li', { class: 'usage' },
        h('p', { class: 'usage-head' }, h('span', { class: 'meta' }, `${t('d.usage')} ${u.id}`), ' ', clsBadge(u.classification)),
        locBlock(u.context, e),
        loc(u.relation, e) ? h('div', { class: 'usage-rel' }, h('p', { class: 'bi-label' }, t('d.relation')), locInline(u.relation, e)) : null)))) : null,
    e.quiz ? section(t('q.explain'), locBlock(e.quiz.explanation, e), h('p', { class: 'hint' }, t('d.scenario.goto'), ' ', h('a', { href: '#/test' }, t('nav.test')))) : null,
    opt('d.intent', e.intent_claim), opt('d.effect', e.observed_effect), opt('d.context', e.explanation),
    e.risk_factors.length ? section(t('d.risk'), h('p', { class: 'hint' }, t('d.risk.note')), chips(e.risk_factors.map((x) => label('risk', x)))) : null,
    loc(e.alternative || (e.quiz && e.quiz.alternative), e) ? section(t('d.alt'), locBlock(e.alternative || e.quiz.alternative, e),
      e.alternative_native ? h('div', { class: 'usage-rel' }, h('p', { class: 'bi-label' }, `${t('d.alt.native')} · ${langName(e.alternative_native.lang)} `, e.local_review_status !== 'reviewed' ? badge(label('local', 'needs_native_review'), 'warn') : null), h('p', { class: 'prose', lang: e.alternative_native.lang }, e.alternative_native.text)) : null) : null,
    opt('d.response', e.response_note), opt('d.ambiguity', e.ambiguity_note),
    section(t('d.scope'), locBlock(e.source_scope, e),
      h('h3', {}, t('d.status')),
      h('dl', { class: 'status' },
        row(t('d.status.source'), sourceBadge(e.source_check_status)),
        row(t('d.status.editorial'), editorialBadge(e.editorial_review_status)),
        row(t('d.status.local'), badge(label('local', e.local_review_status), e.local_review_status === 'reviewed' ? 'ok' : 'wait')),
        row(t('d.status.translation', { lang: langName(ui) }), badge(label('translation', trStatus), trStatus === 'reviewed' || trStatus === 'original' ? 'ok' : 'wait')),
        row(t('d.status.rights'), [badge(label('rights', e.rights_status), e.rights_status === 'reviewed' ? 'ok' : 'info'), h('p', { class: 'hint' }, label('basis', e.rights_basis))]),
        row(t('d.evidence'), label('evidence', e.evidence_type)),
        row(t('d.reviewed'), fmtDate(e.last_reviewed_at)))),
    section(t('d.sources'), h('p', { class: 'hint' }, t('d.sources.note')),
      sources.length ? h('ul', { class: 'sources' }, sources.map((s) => h('li', {},
        h('p', {}, h('strong', {}, `${s.id} · `), h('a', { href: s.url, rel: 'noopener noreferrer external', target: '_blank' }, s.title), s.author ? ` — ${s.author}` : ''),
        h('p', { class: 'bi-label' }, t('d.supports')), locInline(s.supported_claim, e),
        h('p', { class: 'meta' }, [s.published_at ? `${t('d.published')} ${s.published_at}` : t('d.published.unknown'), `${t('d.accessed')} ${fmtDate(s.accessed_at)}`, s.reuse_license !== 'not_confirmed' ? `${t('d.license')}: ${s.reuse_license}` : null].filter(Boolean).join(' · '))))) : h('p', {}, t('d.sources.none'))),
    e.related_entries.length ? section(t('d.related'), h('ul', { class: 'related' }, e.related_entries.map((r) => {
      const target = r.id ? relSummary.get(r.id) : null;
      if (r.id && !target) return null;
      return h('li', {}, badge(label('link', r.link_type), 'info'), ' ', target ? h('a', { href: `#/entry/${target.id}` }, originalText(target, 'rel-text'), ` (${target.id})`) : locInline(r.label, e, 'span'));
    }))) : null,
    section(t('d.history'), e.revision_history.length ? h('ol', { class: 'history' }, e.revision_history.map((r) => h('li', {}, `${fmtDate(r.at)} — ${r.reason} `, h('span', { class: 'meta' }, `[${r.fields.join(', ')}]`)))) : h('p', { class: 'hint' }, t('d.history.none'))),
    section(t('x.public'), h('p', { class: 'hint' }, t('x.public.note')), exps.length ? experienceList(exps) : h('p', { class: 'hint' }, t('x.public.none')),
      h('p', {}, h('a', { href: `#/experiences?entry=${e.id}` }, t('d.share')), ' · ', h('a', { href: `#/contribute?entry=${e.id}` }, t('d.suggest')))),
    await commentsSection(e.id));
}
export const experienceList = (items) => h('ul', { class: 'exp-list' }, items.map((x) => h('li', {},
  h('p', { class: 'meta' }, [t(`x.kind.${x.kind}`), x.entry_id, x.region_broad, x.period].filter(Boolean).join(' · ')), h('p', { class: 'prose' }, x.text))));

// ── 4. 보호어 ──
export async function protectedView() {
  const { items } = await api('GET', '/api/entries?protected=1');
  return h('div', {},
    h('h1', {}, t('nav.protected')), h('p', { class: 'lead' }, t('p.lead')), notice(t('p.stance')),
    items.length ? items.map((e) => {
      const neutral = e.usages.filter((u) => u.classification === 'neutral_in_context');
      const other = e.usages.filter((u) => u.classification !== 'neutral_in_context');
      const col = (title, list) => h('div', { class: 'bi-col' }, h('h3', {}, title), list.length ? h('ul', { class: 'plain' }, list.map((u) => h('li', {}, clsBadge(u.classification), locInline(u.context, e)))) : h('p', { class: 'hint' }, t('ui.none')));
      return h('section', { class: 'block protected' },
        h('h2', {}, originalText(e), ' ', e.protected_word === 'candidate' ? badge(t('p.candidate'), 'wait') : null),
        entryMeta(e), locBlock(e.neutral_meaning, e),
        h('div', { class: 'bilingual' }, col(t('p.neutral'), neutral), col(t('p.other'), other)),
        loc(e.response_note, e) ? h('div', {}, h('p', { class: 'bi-label' }, t('d.response')), locInline(e.response_note, e)) : null,
        h('p', {}, h('a', { href: `#/entry/${e.id}` }, `${t('ui.view')} →`)));
    }) : h('div', { class: 'empty' }, t('dict.empty')));
}

// ── 5. 여행·문화 비교: 대륙 → 국가·지역 → 상황 ──
export async function travelView() {
  const { items } = await api('GET', '/api/entries?type=word,nonverbal');
  const placeOf = (e) => (e.region ? e.region : e.language !== 'und' ? `lang:${e.language}` : 'situational');
  const continentOf = (place) => REGION_CONTINENT[place] || 'unplaced';
  const placeName = (p) => (p === 'situational' ? t('region.situational') : p.startsWith('lang:') ? t('region.lang', { lang: langName(p.slice(5)) }) : regionName(p));
  const sel = { continent: null, place: null, situation: '' };
  const body = h('div', { 'aria-live': 'polite' });
  const pick = (label2, options, current, on) => h('div', { class: 'step' }, h('h2', {}, label2),
    h('div', { class: 'pills', role: 'group', 'aria-label': label2 }, options.map(([v, text, n]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(current === v), onclick: () => on(v) }, text, n === undefined ? null : h('span', { class: 'pill-n' }, ` ${n}`)))));
  function render() {
    const inC = items.filter((e) => continentOf(placeOf(e)) === sel.continent);
    const places = uniq(inC.map(placeOf));
    const inP = inC.filter((e) => placeOf(e) === sel.place);
    const sits = uniq(inP.flatMap((e) => e.situations || []));
    const shown = inP.filter((e) => !sel.situation || (e.situations || []).includes(sel.situation));
    body.replaceChildren(h('div', {},
      pick(t('tv.continent'), CONTINENTS.map((c) => [c, t(`cont.${c}`), items.filter((e) => continentOf(placeOf(e)) === c).length]), sel.continent, (v) => { Object.assign(sel, { continent: v, place: null, situation: '' }); render(); }),
      sel.continent ? (places.length ? pick(t('tv.region'), places.map((p) => [p, placeName(p), inC.filter((e) => placeOf(e) === p).length]), sel.place, (v) => { Object.assign(sel, { place: v, situation: '' }); render(); }) : h('div', { class: 'empty' }, t('tv.empty'))) : null,
      sel.place ? pick(t('f.situation'), [['', t('ui.all'), inP.length], ...sits.map((s) => [s, label('situation', s), inP.filter((e) => (e.situations || []).includes(s)).length])], sel.situation, (v) => { sel.situation = v; render(); }) : null,
      sel.place ? h('div', { class: 'cards' }, shown.map(entryCard)) : null));
  }
  render();
  return h('div', {}, h('h1', {}, t('nav.travel')), h('p', { class: 'lead' }, t('tv.lead')),
    h('ul', { class: 'caveats' }, ['tv.c1', 'tv.c2', 'tv.c3'].map((k) => h('li', {}, t(k)))), body);
}

// ── 6. 테스트: 응답은 이 기기에만 둔다. 인격 점수는 없다. ──
const QUIZ_KEY = 'atlas.quiz.history';
export async function testView() {
  const root = h('div', {});
  const intro = () => {
    const status = h('div', {});
    root.replaceChildren(h('h1', {}, t('nav.test')), h('p', { class: 'lead' }, t('q.lead')), notice(t('q.no_score')), h('p', { class: 'hint' }, t('q.device')),
      h('p', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: start }, t('q.start')),
        store.get(QUIZ_KEY, []).length ? h('button', { type: 'button', class: 'btn', onclick: () => { store.del(QUIZ_KEY); intro(); root.append(notice(t('q.cleared'))); } }, t('q.clear')) : null), status);
  };
  async function start() {
    const { items } = await api('GET', '/api/quiz?n=6');
    const answers = [];
    const ask = (i) => {
      const e = items[i];
      const boxes = e.quiz.options.map((o) => ({ o, input: h('input', { type: 'checkbox', value: o.key }) }));
      const status = h('div', {});
      const form = h('form', { class: 'quiz', onsubmit: (ev) => {
        ev.preventDefault();
        const chosen = boxes.filter((b) => b.input.checked).map((b) => b.o.key);
        if (!chosen.length) { status.replaceChildren(notice(t('q.selected.none'), 'error')); return; }
        answers.push({ id: e.id, chosen });
        feedback(i, chosen);
      } },
        h('p', { class: 'meta' }, t('q.progress', { i: String(i + 1), n: String(items.length) })),
        h('h1', { class: 'quiz-title' }, originalText(e)),
        locBlock(e.neutral_meaning, e),
        h('fieldset', {}, h('legend', {}, t('q.choose')), boxes.map((b) => h('label', { class: 'option' }, b.input, h('span', {}, h('strong', {}, `${b.o.key}. `), locInline(b.o.text, e, 'span'))))),
        status, h('p', { class: 'actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, t('q.answer'))));
      root.replaceChildren(form); focusTop();
    };
    const parts = (e, chosen) => ({
      checked: e.quiz.options.filter((o) => o.recommended && chosen.includes(o.key)),
      missed: e.quiz.options.filter((o) => o.recommended && !chosen.includes(o.key)),
      premise: e.quiz.options.filter((o) => !o.recommended && chosen.includes(o.key)),
    });
    const optList = (e, list, withNote) => h('ul', { class: 'plain' }, list.map((o) => h('li', {}, h('strong', {}, `${o.key}. `), locInline(o.text, e, 'span'), withNote && o.note ? locInline(o.note, e, 'p', 'hint') : null)));
    const feedback = (i, chosen) => {
      const e = items[i]; const p = parts(e, chosen); const last = i === items.length - 1;
      root.replaceChildren(h('div', { class: 'quiz' },
        h('p', { class: 'meta' }, t('q.progress', { i: String(i + 1), n: String(items.length) })),
        h('h1', { class: 'quiz-title' }, originalText(e)),
        h('div', { class: 'fb fb-ok' }, h('h2', {}, `${MARKS.ok} ${t('q.checked')}`), p.checked.length ? optList(e, p.checked) : h('p', { class: 'hint' }, t('ui.none'))),
        h('div', { class: 'fb fb-miss' }, h('h2', {}, `${MARKS.miss} ${t('q.missed')}`), p.missed.length ? optList(e, p.missed) : h('p', { class: 'hint' }, t('q.none.missed'))),
        p.premise.length ? h('div', { class: 'fb fb-premise' }, h('h2', {}, `${MARKS.premise} ${t('q.premise')}`), optList(e, p.premise, true)) : null,
        section(t('q.explain'), locBlock(e.quiz.explanation, e)),
        section(t('q.alt'), locBlock(e.quiz.alternative, e)),
        section(t('q.ask'), locBlock(e.quiz.check_question, e)),
        h('p', { class: 'hint' }, t('d.legal')),
        h('p', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => (last ? summary() : ask(i + 1)) }, t(last ? 'q.finish' : 'q.next')), h('a', { href: `#/entry/${e.id}` }, t('ui.view')))));
      focusTop();
    };
    const summary = () => {
      const rows = items.map((e, i) => ({ e, ...parts(e, answers[i].chosen) }));
      const a = rows.reduce((n, r) => n + r.checked.length, 0);
      const b = rows.reduce((n, r) => n + r.checked.length + r.missed.length, 0);
      const hist = store.get(QUIZ_KEY, []);
      hist.push({ at: new Date().toISOString(), answers });
      store.set(QUIZ_KEY, hist.slice(-20));
      root.replaceChildren(h('div', { class: 'quiz' }, h('h1', {}, t('q.summary')),
        h('p', { class: 'lead' }, t('q.summary.line', { n: String(items.length), a: String(a), b: String(b) })),
        notice(t('q.summary.note')),
        rows.map((r) => h('section', { class: 'block' }, h('h2', {}, originalText(r.e)),
          h('p', { class: 'bi-label' }, t('q.checked')), r.checked.length ? optList(r.e, r.checked) : h('p', { class: 'hint' }, t('ui.none')),
          h('p', { class: 'bi-label' }, t('q.missed')), r.missed.length ? optList(r.e, r.missed) : h('p', { class: 'hint' }, t('q.none.missed')),
          h('p', {}, h('a', { href: `#/entry/${r.e.id}` }, t('ui.view'))))),
        h('p', { class: 'hint' }, t('q.device')),
        h('p', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: start }, t('q.again')), h('button', { type: 'button', class: 'btn', onclick: () => { store.del(QUIZ_KEY); intro(); root.append(notice(t('q.cleared'))); } }, t('q.clear')))));
      focusTop();
    };
    ask(0);
  }
  const focusTop = () => { const m = document.getElementById('main'); m.focus(); m.scrollIntoView(); };
  intro();
  return root;
}
const MARKS = { ok: '●', miss: '◌', premise: '◐' };
