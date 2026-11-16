// 앱 셸과 해시 라우터.
import { t, setLang, getLang, UI_LANGS, UI_LANG_NAMES } from './i18n.js';
import { h, api, state, store, notice, errorText, ApiError } from './core.js';
import { homeView, dictionaryView, entryView, protectedView, travelView, testView } from './views-public.js';
import { accountView, experiencesView, contributeView } from './views-community.js';
import { adminView } from './views-admin.js';
import { aboutView } from './views-about.js';

const app = document.getElementById('app');
const NAV = [['', 'nav.home'], ['dictionary', 'nav.dictionary'], ['protected', 'nav.protected'], ['travel', 'nav.travel'], ['test', 'nav.test'], ['experiences', 'nav.experiences'], ['contribute', 'nav.contribute'], ['about', 'nav.about']];

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || '', arg: parts[1] || '', query: Object.fromEntries(new URLSearchParams(qs)) };
}
const ROUTES = {
  '': () => homeView(), dictionary: (r) => dictionaryView(r.query), entry: (r) => entryView(r.arg), protected: () => protectedView(), travel: () => travelView(),
  test: () => testView(), experiences: (r) => experiencesView(r.query), contribute: (r) => contributeView(r.query), about: () => aboutView(),
  admin: () => adminView(), account: () => accountView(() => { location.hash = '#/'; render(); }),
};

let main; let seq = 0;
function shell(route) {
  const langSel = h('select', { id: 'ui-lang', onchange: (ev) => { setLang(ev.target.value); store.set('atlas.lang', getLang()); render(); } },
    UI_LANGS.map((l) => h('option', { value: l, selected: l === getLang(), lang: l }, UI_LANG_NAMES[l])));
  const link = (path, key) => h('li', {}, h('a', { href: `#/${path}`, 'aria-current': route.name === path || (path === 'dictionary' && route.name === 'entry') ? 'page' : null }, t(key)));
  const origToggle = h('input', { type: 'checkbox', checked: state.showOriginals, onchange: (ev) => { state.showOriginals = ev.target.checked; store.set('atlas.showOriginals', state.showOriginals); render(); } });
  main = h('main', { id: 'main', tabindex: '-1' }, h('p', { class: 'hint' }, t('ui.loading')));
  document.title = state.site.site_name;
  app.replaceChildren(
    h('a', { class: 'skip', href: '#main', onclick: (ev) => { ev.preventDefault(); main.focus(); } }, t('skip')),
    h('header', { class: 'site-head' },
      h('div', { class: 'head-row' },
        h('a', { class: 'brand', href: '#/' }, state.site.site_name),
        h('div', { class: 'head-tools' },
          h('label', { class: 'sr-only', for: 'ui-lang' }, t('ui.language')), langSel,
          h('a', { class: 'btn', href: '#/account' }, state.user ? state.user.handle : t('nav.account')))),
      h('nav', { 'aria-label': t('nav.menu') }, h('ul', { class: 'nav' }, NAV.map(([p, k]) => link(p, k)), state.user && state.user.role === 'admin' ? link('admin', 'nav.admin') : null))),
    main,
    h('footer', { class: 'site-foot' },
      h('p', {}, t('ft.noads'), ' ', t('ft.edu')),
      h('p', {}, h('label', { class: 'check' }, origToggle, ' ', t('orig.always'))),
      h('p', { class: 'meta' }, `${t('ft.version')}: ${state.site.data_version} · `, h('a', { href: '#/about' }, t('nav.about')))));
}

async function render() {
  const mine = (seq += 1);
  const route = parseHash();
  shell(route);
  let view;
  try {
    view = await (ROUTES[route.name] || (() => { throw new ApiError(404, { error: 'not_found' }); }))(route);
  } catch (e) {
    view = h('div', {}, h('h1', {}, state.site.site_name), notice(e instanceof ApiError && e.status === 404 ? t('ui.notfound') : errorText(e), 'error'), h('p', {}, h('a', { href: '#/' }, t('nav.home'))));
    if (!(e instanceof ApiError)) console.error(e);
  }
  if (mine !== seq) return; // 더 최근 탐색이 있으면 버린다
  main.replaceChildren(view);
  const h1 = main.querySelector('h1');
  document.title = h1 && route.name ? `${h1.textContent} — ${state.site.site_name}` : state.site.site_name;
  if (render.moved) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  render.moved = true;
}

async function boot() {
  const saved = store.get('atlas.lang', null);
  const browser = UI_LANGS.find((l) => (navigator.language || '').toLowerCase().startsWith(l.toLowerCase().slice(0, 2)));
  setLang(saved || 'en'); // 기본 화면 언어는 영어. 브라우저 언어는 자동 적용하지 않고 선택만 쉽게 둔다.
  void browser;
  state.showOriginals = store.get('atlas.showOriginals', false);
  try {
    state.site = await api('GET', '/api/site');
    state.user = state.site.user;
  } catch {
    app.replaceChildren(h('main', { class: 'offline' }, h('h1', {}, 'Context Atlas'), notice(t('ui.server.down'), 'error')));
    return;
  }
  window.addEventListener('hashchange', render);
  document.addEventListener('atlas:site', render);
  render();
}
boot();
