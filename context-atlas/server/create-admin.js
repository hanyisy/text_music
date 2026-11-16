// 사용: npm run create-admin -- <handle> <password>
// 관리자 계정을 만들거나, 같은 이름이 있으면 관리자로 올리고 비밀번호를 바꾼다. 서버를 멈춘 상태에서 실행한다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const [handle, password] = process.argv.slice(2);
if (!handle || !password) { console.error('usage: npm run create-admin -- <handle> <password(10자 이상)>'); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
const app = createApp({ dataDir: process.env.ATLAS_DATA_DIR || path.join(here, '..', 'data') });
try { const u = app.ensureAdmin(handle, password); console.log(`admin ready: ${u.handle}`); } catch (e) { console.error(e.message); process.exit(1); }
