// JSON 파일 하나에 전체 상태를 저장한다. 쓰기는 임시 파일 → rename 으로 원자적으로 한다.
// 소규모 편집 사전용이다. 동시 접속이 커지면 DB로 교체한다(인터페이스는 db 객체 + save()).
import fs from 'node:fs';
import path from 'node:path';
import { seedEntries, SEED_VERSION } from './seed-entries.js';
import { seedSources } from './seed-sources.js';

export const SCHEMA_VERSION = 1;

export function freshDb() {
  const now = new Date().toISOString();
  return {
    meta: { format: 'context-atlas', schema_version: SCHEMA_VERSION, seed_version: SEED_VERSION, revision: 1, created_at: now, updated_at: now },
    settings: { site_name: 'Context Atlas', domain: '', contact: '', ads_enabled: false },
    entries: seedEntries(),
    sources: seedSources(),
    users: [], sessions: {}, comments: [], reports: [], experiences: [], contributions: [], audit: [],
    counters: { user: 0, comment: 0, report: 0, experience: 0, contribution: 0 },
  };
}

export function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'atlas-db.json');
  let db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : freshDb();
  if (db.meta.schema_version !== SCHEMA_VERSION) throw new Error(`Unsupported schema_version ${db.meta.schema_version}`);
  const save = () => {
    db.meta.updated_at = new Date().toISOString();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file);
  };
  if (!fs.existsSync(file)) save();
  return {
    get db() { return db; },
    save,
    nextId(kind, prefix) { db.counters[kind] += 1; return `${prefix}${db.counters[kind]}`; },
    bumpContent() { db.meta.revision += 1; },
    dataVersion() { return `${db.meta.seed_version}+r${db.meta.revision}`; },
  };
}
