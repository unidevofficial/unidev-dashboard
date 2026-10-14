// 로컬 개발 서버 (Supabase 흉내)
//   - tools/postgrest.exe 를 띄워 로컬 PostgreSQL을 REST로 연다 (Supabase가 쓰는 것과 같은 PostgREST)
//   - http://localhost:DEV_PORT/          → web/ 정적 파일
//   - http://localhost:DEV_PORT/rest/v1/* → PostgREST (Supabase와 같은 경로)
//   - /auth/v1/*, /functions/v1/admin-accounts → Supabase Auth·Edge Function 흉내 (scripts/local-auth.mjs)
//   - /dev/accounts, /dev/quick-login     → 개발용 빠른 로그인
// 로컬 전용이며 배포 대상이 아니다.
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { ROOT, loadEnv, pgEnv } from './lib.mjs';
import { createLocalAuth } from './local-auth.mjs';

const env = loadEnv();
const DEV_PORT = Number(env.DEV_PORT || 5173);
const PGRST_PORT = Number(env.POSTGREST_PORT || 3001);
const WEB_ROOT = join(ROOT, 'web');
const auth = createLocalAuth(env, { pgrstUrl: `http://127.0.0.1:${PGRST_PORT}` });

// 화면 설정(web/config.js)의 로그인 도메인이 .env와 같아야 로그인된다
if (!readFileSync(join(WEB_ROOT, 'config.js'), 'utf8').includes(`'${env.LOGIN_DOMAIN}'`)) {
  console.warn(`경고: web/config.js의 loginDomain이 .env의 LOGIN_DOMAIN(${env.LOGIN_DOMAIN})과 다릅니다.`);
}

// ---------------------------------------------------------------------
// PostgREST 실행
// ---------------------------------------------------------------------
const exe = join(ROOT, 'tools', process.platform === 'win32' ? 'postgrest.exe' : 'postgrest');
if (!existsSync(exe)) {
  console.error(`PostgREST 실행 파일이 없습니다: ${exe}`);
  console.error('https://github.com/PostgREST/postgrest/releases 에서 내려받아 tools/ 폴더에 두세요.');
  process.exit(1);
}
const dbUri = `postgres://authenticator:${encodeURIComponent(env.AUTHENTICATOR_PASSWORD)}@${env.PGHOST}:${env.PGPORT}/${env.PGDATABASE}`;
const pgrst = spawn(exe, [], {
  env: pgEnv(env, {
    PGRST_DB_URI: dbUri,
    PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: env.JWT_SECRET,
    PGRST_SERVER_HOST: '127.0.0.1',
    PGRST_SERVER_PORT: String(PGRST_PORT),
    PGRST_LOG_LEVEL: 'error',
  }),
  stdio: ['ignore', 'inherit', 'inherit'],
});
pgrst.on('exit', (code) => {
  console.error(`PostgREST가 종료되었습니다 (code ${code}).`);
  process.exit(1);
});
const stop = () => { pgrst.removeAllListeners('exit'); pgrst.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// ---------------------------------------------------------------------
// HTTP 서버
// ---------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function proxyToPostgrest(req, res, path) {
  const headers = { ...req.headers, host: `127.0.0.1:${PGRST_PORT}` };
  // 로그인 전 supabase-js는 anon key를 Bearer로 보낸다. 로컬 anon key는 JWT가 아니므로 떼어 내 anon 역할로 처리되게 한다.
  if (headers.authorization && headers.authorization.split('.').length !== 3) delete headers.authorization;
  delete headers.apikey;
  const upstream = httpRequest(
    { host: '127.0.0.1', port: PGRST_PORT, method: req.method, path, headers },
    (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); },
  );
  upstream.on('error', (e) => sendJson(res, 502, { message: `PostgREST 연결 실패: ${e.message}` }));
  req.pipe(upstream);
}

function sendJson(res, status, body) {
  if (res.headersSent) return res.end();
  if (status === 204) {
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(WEB_ROOT, rel));
  if (!file.startsWith(WEB_ROOT + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/rest/v1/')) {
      return proxyToPostgrest(req, res, url.pathname.slice('/rest/v1'.length) + url.search);
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      return await auth.handleAuth(req, res, url, await readBody(req), sendJson);
    }
    if (url.pathname === '/functions/v1/admin-accounts' && req.method === 'POST') {
      return await auth.handleAdminAccounts(req, res, await readBody(req), sendJson);
    }
    if (url.pathname === '/dev/accounts' && req.method === 'GET') {
      return sendJson(res, 200, await auth.devAccounts());
    }
    if (url.pathname === '/dev/quick-login' && req.method === 'POST') {
      const session = auth.devQuickLogin((await readBody(req)).username);
      return session ? sendJson(res, 200, session) : sendJson(res, 404, { message: '계정을 찾을 수 없습니다.' });
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
    sendJson(res, 405, { message: 'Method not allowed' });
  } catch (e) {
    sendJson(res, 500, { message: e.message });
  }
});

server.listen(DEV_PORT, '127.0.0.1', () => {
  console.log(`UNIDEV 대시보드 (로컬): http://localhost:${DEV_PORT}/`);
  console.log(`PostgREST: http://127.0.0.1:${PGRST_PORT}/ (프록시 경로 /rest/v1)`);
});
