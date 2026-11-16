// 실행: npm start  (PORT, ATLAS_DATA_DIR, ATLAS_ADMIN_HANDLE, ATLAS_ADMIN_PASSWORD 환경 변수)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.ATLAS_DATA_DIR || path.join(here, '..', 'data');
const { ATLAS_ADMIN_HANDLE: handle, ATLAS_ADMIN_PASSWORD: password } = process.env;
const app = createApp({ dataDir, admin: handle && password ? { handle, password } : null });
const port = Number(process.env.PORT) || 8090;

app.server().listen(port, () => {
  const admins = app.store.db.users.filter((u) => u.role === 'admin').length;
  console.log(`Context Atlas → http://localhost:${port}  (data: ${dataDir}, version ${app.store.dataVersion()})`);
  if (!admins) console.log('관리자 계정이 없습니다. `npm run create-admin -- <handle> <password>` 로 만드세요.');
});
