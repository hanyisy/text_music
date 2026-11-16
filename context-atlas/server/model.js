// 항목 모델의 허용 값, 공개 뷰, 검색·필터, 통계. HTTP와 무관한 순수 함수만 둔다.

export const ENTRY_TYPES = ['word', 'sentence', 'scenario', 'nonverbal'];
export const CLASSIFICATIONS = ['group_derogation', 'prejudice_stereotype', 'rude_insult', 'cultural_misunderstanding', 'neutral_in_context', 'insufficient_data'];
export const LINK_TYPES = ['meaning_similar', 'sound_similar', 'same_spelling', 'misunderstanding_possible', 'no_direct_equivalent', 'variant', 'related'];
export const PUBLICATION = ['draft', 'published'];
export const SOURCE_CHECK = ['checked', 'partial', 'needs_research', 'not_applicable'];
export const EDITORIAL = ['candidate', 'initial_draft', 'needs_review', 'reviewed'];
export const LOCAL_REVIEW = ['not_reviewed', 'needs_native_review', 'reviewed'];
export const TRANSLATION = ['none', 'draft_unreviewed', 'reviewed'];
export const RIGHTS = ['unclear', 'self_declared_independent', 'reviewed'];
export const UI_LANGS = ['en', 'ko', 'ja', 'zh-Hans', 'es'];

const EDITABLE = ['entry_type', 'original_text', 'title', 'language', 'script', 'region', 'local_scope', 'topics', 'situations',
  'content_lang', 'content_note', 'protected_word', 'variant_of', 'neutral_meaning', 'usages', 'intent_claim', 'observed_effect',
  'explanation', 'risk_factors', 'alternative', 'alternative_native', 'response_note', 'ambiguity_note', 'related_entries',
  'evidence_type', 'source_ids', 'source_scope', 'source_checked_at', 'source_check_status', 'editorial_review_status',
  'local_review_status', 'translation_status', 'rights_basis', 'rights_status', 'publication_status', 'last_reviewed_at', 'quiz', 'internal_note'];
export const EDITABLE_FIELDS = new Set(EDITABLE);

export const isPublic = (e) => e.publication_status === 'published';

// 공개 승격을 막는 사유. 관리자라도 이 조건을 먼저 해소해야 공개할 수 있다.
export function publishBlockers(e) {
  const out = [];
  if (e.source_check_status === 'needs_research' || e.evidence_type === 'candidate') out.push('needs_research');
  if (!['self_declared_independent', 'reviewed'].includes(e.rights_status)) out.push('rights_unclear');
  return out;
}

export function validateEntry(e) {
  const err = [];
  if (typeof e.id !== 'string' || !/^[A-Z][A-Z0-9_-]{1,15}$/.test(e.id)) err.push('id');
  if (!ENTRY_TYPES.includes(e.entry_type)) err.push('entry_type');
  if (typeof e.original_text !== 'string' || !e.original_text.trim()) err.push('original_text');
  if (typeof e.language !== 'string' || !e.language) err.push('language');
  if (e.publication_status && !PUBLICATION.includes(e.publication_status)) err.push('publication_status');
  if (e.source_check_status && !SOURCE_CHECK.includes(e.source_check_status)) err.push('source_check_status');
  if (e.editorial_review_status && !EDITORIAL.includes(e.editorial_review_status)) err.push('editorial_review_status');
  if (e.rights_status && !RIGHTS.includes(e.rights_status)) err.push('rights_status');
  if (e.usages && (!Array.isArray(e.usages) || e.usages.some((u) => !u || !u.id || !CLASSIFICATIONS.includes(u.classification)))) err.push('usages');
  if (e.related_entries && (!Array.isArray(e.related_entries) || e.related_entries.some((r) => !r || !LINK_TYPES.includes(r.link_type)))) err.push('related_entries');
  return err;
}

export function normalizeEntry(e) {
  return {
    script: '', region: null, local_scope: {}, topics: [], situations: [], content_lang: 'ko', content_note: false,
    protected_word: null, variant_of: null, neutral_meaning: {}, usages: [], risk_factors: [], related_entries: [],
    evidence_type: 'candidate', source_ids: [], source_scope: {}, source_checked_at: null, source_check_status: 'needs_research',
    editorial_review_status: 'candidate', local_review_status: 'not_reviewed', translation_status: {}, rights_basis: '',
    rights_status: 'unclear', publication_status: 'draft', origin: 'imported', last_reviewed_at: null, revision_history: [],
    ...e,
  };
}

// 공개 응답: 내부 메모 제거, 비공개 항목으로의 연결 제거, 수정 이력은 요약만.
export function publicView(e, publicIds) {
  const { internal_note, revision_history, ...rest } = e;
  rest.related_entries = (e.related_entries || []).filter((r) => !r.id || publicIds.has(r.id));
  rest.revision_history = (revision_history || []).map((r) => ({ rev: r.rev, at: r.at, reason: r.reason, fields: Object.keys(r.changes || {}) }));
  return rest;
}

const norm = (s) => String(s || '').normalize('NFKC').toLowerCase();
const vals = (o) => (o && typeof o === 'object' ? Object.values(o) : [o]);

export function haystack(e) {
  return norm([
    e.id, e.original_text, ...vals(e.title), ...vals(e.neutral_meaning), ...vals(e.alternative), ...vals(e.local_scope),
    e.alternative_native && e.alternative_native.text,
    ...(e.usages || []).flatMap((u) => vals(u.context)),
  ].filter(Boolean).join('\n'));
}

// 필터 사이는 AND, 한 필터 안의 여러 값(쉼표)은 OR.
export function filterEntries(entries, q) {
  const list = (k) => (q[k] ? String(q[k]).split(',').filter(Boolean) : null);
  const needle = norm(q.q).trim();
  const f = {
    language: list('language'), region: list('region'), topic: list('topic'), type: list('type'), situation: list('situation'),
    classification: list('classification'), review: list('review'), source: list('source'),
  };
  return entries.filter((e) => {
    if (needle && !haystack(e).includes(needle)) return false;
    if (f.language && !f.language.includes(e.language)) return false;
    if (f.region && !f.region.includes(e.region || 'none')) return false;
    if (f.type && !f.type.includes(e.entry_type)) return false;
    if (f.topic && !f.topic.some((t) => e.topics.includes(t))) return false;
    if (f.situation && !f.situation.some((t) => (e.situations || []).includes(t))) return false;
    if (f.classification && !f.classification.some((c) => e.usages.some((u) => u.classification === c))) return false;
    if (f.review && !f.review.includes(e.editorial_review_status)) return false;
    if (f.source && !f.source.includes(e.source_check_status)) return false;
    if (q.protected === '1' && !e.protected_word) return false;
    return true;
  });
}

const countBy = (items, keyFn) => {
  const m = new Map();
  for (const it of items) for (const k of [].concat(keyFn(it))) m.set(k, (m.get(k) || 0) + 1);
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
};

export function facets(pub) {
  return {
    language: countBy(pub, (e) => e.language), region: countBy(pub, (e) => e.region || 'none'),
    topic: countBy(pub, (e) => e.topics), type: countBy(pub, (e) => e.entry_type), situation: countBy(pub, (e) => e.situations || []),
    classification: countBy(pub, (e) => [...new Set(e.usages.map((u) => u.classification))]),
    review: countBy(pub, (e) => e.editorial_review_status), source: countBy(pub, (e) => e.source_check_status),
  };
}

// 통계: 공개 항목만. 철자 변형(variant_of)은 표제어 하나로 센다. 경험은 공개 승인된 고유 기록만.
export function computeStats(db) {
  const pub = db.entries.filter(isPublic);
  const pubIds = new Set(pub.map((e) => e.id));
  const headOf = (e) => (e.variant_of && pubIds.has(e.variant_of) ? e.variant_of : e.id);
  const heads = new Map();
  for (const e of pub) if (!heads.has(headOf(e))) heads.set(headOf(e), pub.find((x) => x.id === headOf(e)));
  const headList = [...heads.values()];
  const usageIds = new Set(pub.flatMap((e) => e.usages.map((u) => u.id)));
  const pubExp = db.experiences.filter((x) => x.status === 'published');
  const entryLang = new Map(db.entries.map((e) => [e.id, e.language]));
  const contributorsByLang = new Map();
  const addC = (lang, uid) => { if (!lang) return; if (!contributorsByLang.has(lang)) contributorsByLang.set(lang, new Set()); contributorsByLang.get(lang).add(uid); };
  for (const x of pubExp) if (x.entry_id && pubIds.has(x.entry_id)) addC(entryLang.get(x.entry_id), x.user_id);
  for (const c of db.contributions) if (c.status === 'applied' && c.entry_id && pubIds.has(c.entry_id)) addC(entryLang.get(c.entry_id), c.user_id);
  const allContrib = new Set([...pubExp.map((x) => x.user_id), ...db.contributions.filter((c) => c.status === 'applied').map((c) => c.user_id)]);
  const by_language = countBy(headList, (e) => e.language).map(({ key, count }) => {
    const inLang = headList.filter((e) => e.language === key);
    return {
      language: key, entries: count, contributors: (contributorsByLang.get(key) || new Set()).size,
      scope: {
        institutional_source: inLang.filter((e) => e.evidence_type === 'institutional_source').length,
        editorial_example: inLang.filter((e) => e.evidence_type === 'editorial_example').length,
        locally_reviewed: inLang.filter((e) => e.local_review_status === 'reviewed').length,
      },
    };
  });
  const by_type = Object.fromEntries(ENTRY_TYPES.map((t) => [t, headList.filter((e) => e.entry_type === t).length]));
  return {
    entries_total: headList.length, records_total: pub.length, by_type, sentences: by_type.sentence, usages_total: usageIds.size,
    experiences_public: pubExp.length, contributors_total: allContrib.size,
    initial_seed_entries: headList.filter((e) => e.origin === 'initial_editorial_seed').length,
    by_language, by_topic: countBy(headList, (e) => e.topics).map(({ key, count }) => ({ topic: key, count })),
    by_classification: countBy(pub.flatMap((e) => e.usages), (u) => u.classification).map(({ key, count }) => ({ classification: key, count })),
  };
}

export function diffFields(before, patch) {
  const changes = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!EDITABLE_FIELDS.has(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(v)) changes[k] = { before: before[k] === undefined ? null : before[k], after: v };
  }
  return changes;
}
