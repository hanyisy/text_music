// 11. 안내: 편집 기준, 통계 한계, 개인정보, 권리 및 출처, 삭제 요청, 연락 창구.
// 본문은 영어·한국어로 작성했다. 다른 화면 언어에서는 영어 본문과 ‘번역 검토 중’을 보여 준다(지어내지 않는다).
import { t, getLang, langName } from './i18n.js';
import { h, api, state, badge, section } from './core.js';

const TEXT = {
  en: [
    ['Editorial standards', [
      'This dictionary records what expressions mean, in which contexts, and how they can be received. Everyone is looked at by the same standard, but histories and harms are not treated as identical.',
      'A word alone is never used to judge a person’s character or intent. Neutral use and the listener’s discomfort are both acknowledged; we do not say “no harm was meant, so there is no reason to be uncomfortable”.',
      'Practices that used an expression to demean or objectify are analysed without blaming a whole group or asserting intent that has not been established. When the sex industry is discussed, workers themselves are not demeaned.',
      'Classifications — demeaning or excluding a group, prejudice or stereotype, rudeness or insult, cultural misunderstanding, neutral in this context, not enough to judge — are attached to individual usages, never to a word as a whole. They are educational labels by the editors and are separate from any legal finding. There is no universally agreed legal definition of hate speech.',
      '“Words in Context” is this project’s own editorial tag, not an academic category.',
    ]],
    ['Review statuses', [
      'Four things are tracked separately: whether a source was checked, editorial review, review by speakers of the language, and rights review. “Source checked” means only that the source supports the listed claim; it never means “reviewed by local speakers”.',
      '“Editorial example” means a sentence or situation written by the editors for teaching. It is not a real statement collected from social media or a real incident.',
      'Candidates marked “needs research” stay unpublished until meaning, region, usage and the views of the people concerned have been looked into.',
      'Explanations were first written in Korean. English text is a draft translation that has not been reviewed. Where no translation exists, the original is shown with “Translation under review” rather than filling the gap with unverified text.',
    ]],
    ['Limits of the statistics', [
      'Counts cover published entries only. Spelling variants are linked to one headword so they are not counted twice. Experiences are counted as unique records published with consent — not clicks. Candidates, private drafts and withdrawn records are excluded.',
      'An entry can carry several topic tags, so topic counts add up to more than the total.',
      'The numbers describe what this project has collected so far. They are not a measure of hatred in any country and must not be read as a ranking of countries or languages.',
    ]],
    ['Privacy', [
      'An account is a nickname and a password. We do not collect real names, email addresses, phone numbers, detailed addresses or photographs. Because no email is stored, a lost password cannot be recovered.',
      'Experience records start as private drafts visible only to their author. Publication needs separate consent and an editor’s review, and can be withdrawn at any time. Published experiences are shown without the account name.',
      'Self-check answers are kept on your device only and are not sent to the server. A session cookie is used for signing in; there are no advertising or analytics trackers.',
    ]],
    ['Rights and sources', [
      'Explanations, example sentences, situations and the design that the operator holds rights in may not be republished, mass-collected or redistributed without permission. This restriction does not apply to words themselves, to facts, to third-party material (which keeps its own terms) or to uses that the law permits, such as quotation.',
      'A link to a source is not a transfer of rights. Translating or adapting external material does not make it an independent work. HurtLex, Codex Mundi, Hatebase and Culture Crossing were consulted only to find topics and locate original sources; their text, translations and data were not imported.',
      'Reader contributions remain the property of their authors. The service receives only the permission needed to store, review, display and translate them. They are not sold.',
      'Rate limiting and bot detection slow down bulk collection, but published information cannot be made impossible to copy, and we do not claim otherwise. Private drafts and personal records are protected by permission checks on the server.',
      'This version has no advertising, affiliate links, paid features or data sales.',
    ]],
    ['Deletion requests and contact', [
      'You can delete your own records, or your whole account with its records, from the Experiences and Account pages at any time.',
      'To ask for removal or correction of an entry, a source reference or a comment, use the Contribute page or the contact channel below. Requests are answered with a status and a reason.',
    ]],
  ],
  ko: [
    ['편집 기준', [
      '이 사전은 표현이 어떤 맥락에서 무엇을 뜻하고 어떻게 받아들여질 수 있는지를 기록합니다. 누구나 같은 기준으로 살피되, 모든 역사와 피해를 동일시하지 않습니다.',
      '단어만으로 사람의 성향이나 의도를 판정하지 않습니다. 표현의 중립적 사용과 듣는 사람의 불편함을 함께 인정하며, ‘악의가 없었으니 불편해할 이유가 없다’고 설명하지 않습니다.',
      '표현을 비하와 대상화에 사용한 관행을 분석하되, 특정 집단 전체에 책임을 돌리거나 확인되지 않은 의도를 단정하지 않습니다. 성산업과 관련된 설명에서도 종사자를 비하하지 않습니다.',
      '분류(집단 비하·배제, 편견·고정관념, 무례·모욕, 문화적 오해, 해당 맥락에서 중립, 판단 자료 부족)는 단어 전체가 아니라 개별 용법에 붙입니다. 편집자의 교육적 분류이며 법적 위법성 판정과 별개입니다. 혐오표현에 대해 보편적으로 합의된 법적 정의는 없습니다.',
      '‘보호어/Words in Context’는 학계의 확정 분류가 아니라 이 프로젝트의 편집 용어입니다.',
    ]],
    ['검토 상태', [
      '출처 확인, 편집 검토, 해당 언어 사용자의 검토, 권리 검토를 서로 다른 상태로 관리합니다. ‘출처 확인’은 그 출처가 표시된 주장을 뒷받침한다는 뜻일 뿐, ‘현지인 검토 완료’를 뜻하지 않습니다.',
      '‘편집 예시’는 편집자가 교육용으로 직접 쓴 문장·상황입니다. SNS에서 수집한 실제 발언이나 실제 피해 사례가 아닙니다.',
      '‘추가 조사’ 후보는 뜻·지역·사용 범위·당사자 관점을 조사하기 전까지 공개하지 않습니다.',
      '설명은 한국어로 먼저 작성했습니다. 영어 문장은 검수 전 초벌 번역입니다. 번역이 없는 언어에서는 근거 없는 문장으로 채우지 않고 원문과 ‘번역 검토 중’을 보여 줍니다.',
    ]],
    ['통계의 한계', [
      '공개 항목만 셉니다. 철자 변형은 표제어 하나로 연결해 중복 집계하지 않습니다. 경험은 클릭 수가 아니라 동의를 받아 공개된 고유 기록 수입니다. 후보·비공개 초안·철회된 기록은 제외합니다.',
      '한 항목에 여러 주제 태그가 붙을 수 있어 주제별 합계는 전체 수보다 큽니다.',
      '이 숫자는 이 프로젝트가 지금까지 모은 자료의 범위입니다. 어느 나라의 실제 혐오 수준이 아니며, 국가·언어 순위로 해석해서는 안 됩니다.',
    ]],
    ['개인정보', [
      '계정은 별명과 비밀번호로만 만듭니다. 실명, 이메일, 전화번호, 상세 주소, 사진을 수집하지 않습니다. 이메일을 저장하지 않으므로 비밀번호를 잃으면 복구할 수 없습니다.',
      '경험 기록은 작성자만 볼 수 있는 비공개 초안으로 시작합니다. 공개에는 별도 동의와 운영자 검토가 필요하고 언제든 철회할 수 있습니다. 공개된 경험에는 계정 이름을 표시하지 않습니다.',
      '테스트 응답은 기기에만 저장하며 서버로 보내지 않습니다. 로그인에 세션 쿠키를 사용하고, 광고·분석 추적기는 없습니다.',
    ]],
    ['권리 및 출처', [
      '별도 표시가 없는 자체 작성 콘텐츠(해설·예문·상황·디자인) 중 운영자가 권리를 보유한 부분의 무단 재게시·대량 수집·재배포를 허용하지 않습니다. 이 제한은 단어 자체, 사실, 제3자 자료(표시된 원래 조건이 적용됨), 인용 등 법령상 허용되는 이용에는 적용되지 않습니다.',
      '출처 연결은 권리 양도가 아닙니다. 외부 자료를 번역·각색했다고 독립 창작이 되지 않습니다. HurtLex, Codex Mundi, Hatebase, Culture Crossing은 조사 주제 탐색과 원출처 확인에만 참고했으며 본문·번역·데이터를 수입하지 않았습니다.',
      '이용자 제보의 저작권은 작성자에게 있습니다. 서비스는 저장·검토·표시·번역에 필요한 허락만 받으며 판매하지 않습니다.',
      '접근 속도 제한과 봇 탐지는 대량 수집을 늦출 뿐입니다. 공개된 정보의 복제를 완전히 막을 수는 없으며 그렇게 주장하지 않습니다. 비공개 초안과 개인 기록은 서버의 권한 검사로 보호합니다.',
      '이번 버전에는 광고, 제휴 링크, 유료 기능, 데이터 판매가 없습니다.',
    ]],
    ['삭제 요청과 연락 창구', [
      '본인의 기록, 또는 계정과 기록 전체는 경험 기록·계정 화면에서 언제든 직접 삭제할 수 있습니다.',
      '항목·출처 표시·댓글의 삭제나 수정을 요청하려면 기여 화면이나 아래 연락 창구를 이용하세요. 요청에는 처리 상태와 이유를 답합니다.',
    ]],
  ],
};

export async function aboutView() {
  const ui = getLang();
  const lang = TEXT[ui] ? ui : 'en';
  const { items } = await api('GET', '/api/sources');
  return h('div', { class: 'about' }, h('h1', {}, t('nav.about')),
    lang !== ui ? h('p', { class: 'meta' }, badge(t('tr.pending'), 'wait'), ` ${t('tr.original')}: ${langName('en')}`) : null,
    TEXT[lang].map(([title, paras]) => h('section', { class: 'block', lang }, h('h2', {}, title), paras.map((p) => h('p', { class: 'prose' }, p)))),
    h('section', { class: 'block' }, h('h2', {}, lang === 'ko' ? '연락 창구' : 'Contact'),
      h('p', { class: 'prose' }, state.site.contact || (lang === 'ko' ? '운영자가 아직 연락 창구를 설정하지 않았습니다. (관리자 설정에서 입력합니다.)' : 'The operator has not set a contact channel yet. (It is entered in the admin settings.)'))),
    section(t('d.sources'), h('p', { class: 'hint' }, t('d.sources.note')),
      h('ul', { class: 'sources' }, items.map((s) => h('li', {},
        h('p', {}, h('strong', {}, `${s.id} · `), h('a', { href: s.url, rel: 'noopener noreferrer external', target: '_blank' }, s.title), s.author ? ` — ${s.author}` : ''),
        h('p', { class: 'meta', lang: s.supported_claim[ui] ? ui : 'ko' }, s.supported_claim[ui] || s.supported_claim.ko, s.supported_claim[ui] ? null : [' ', badge(t('tr.pending'), 'wait')]),
        h('p', { class: 'meta' }, [s.published_at ? `${t('d.published')} ${s.published_at}` : t('d.published.unknown'), `${t('d.accessed')} ${s.accessed_at}`, s.reuse_license !== 'not_confirmed' ? `${t('d.license')}: ${s.reuse_license}` : null].filter(Boolean).join(' · ')))))),
    h('p', { class: 'meta' }, `${t('ft.version')}: ${state.site.data_version}`));
}
