// 프로젝트 전용 로컬 PostgreSQL 클러스터 관리 (.pgdata/)
//   node scripts/db-cluster.mjs init    : 클러스터 생성 (관리자 비밀번호를 무작위로 만들어 .env에 기록)
//   node scripts/db-cluster.mjs start   : 서버 시작
//   node scripts/db-cluster.mjs stop    : 서버 중지
//   node scripts/db-cluster.mjs status  : 상태 확인
// 시스템에 설치된 PostgreSQL 서비스와 별개로, 설치된 실행 파일(initdb, pg_ctl)만 빌려 쓴다.
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, pgEnv } from './lib.mjs';

const DATA = join(ROOT, '.pgdata');
const ENV_PATH = join(ROOT, '.env');
const DEFAULT_PORT = '54329';

function readEnvFile() {
  if (!existsSync(ENV_PATH)) writeFileSync(ENV_PATH, readFileSync(join(ROOT, '.env.example'), 'utf8'));
  return readFileSync(ENV_PATH, 'utf8');
}
function setEnvValue(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
}

const envText = readEnvFile();
process.loadEnvFile(ENV_PATH);
const env = process.env;
const bin = env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin';
const exe = (name) => join(bin, process.platform === 'win32' ? `${name}.exe` : name);

function run(cmd, args, { allowFail = false, detachOutput = false } = {}) {
  // pg_ctl start는 서버 프로세스가 출력 파이프를 물려받아 끝나지 않으므로 출력을 연결하지 않는다
  const r = spawnSync(exe(cmd), args, { env: pgEnv(env), encoding: 'utf8', stdio: detachOutput ? 'ignore' : 'pipe' });
  if (r.error) { console.error(`${cmd} 실행 실패: ${r.error.message}`); process.exit(1); }
  if (r.status !== 0 && !allowFail) {
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    process.exit(r.status ?? 1);
  }
  return r;
}

const port = () => process.env.PGPORT || DEFAULT_PORT;
const ctl = (action, extra = []) => run('pg_ctl', [action, '-D', DATA, ...extra], {
  allowFail: action === 'status',
  detachOutput: action === 'start',
});

const cmd = process.argv[2] ?? 'status';

if (cmd === 'init') {
  if (existsSync(join(DATA, 'PG_VERSION'))) {
    console.log('이미 .pgdata 클러스터가 있습니다. 다시 만들려면 서버를 멈추고 .pgdata 폴더를 지우세요.');
    process.exit(0);
  }
  const password = randomBytes(18).toString('base64url');
  const tmp = mkdtempSync(join(tmpdir(), 'unidev-'));
  const pwfile = join(tmp, 'pw');
  writeFileSync(pwfile, password);
  try {
    run('initdb', ['-D', DATA, '-U', 'postgres', '--auth=scram-sha-256', `--pwfile=${pwfile}`, '--encoding=UTF8', '--no-locale']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  let text = envText;
  text = setEnvValue(text, 'PGHOST', 'localhost');
  text = setEnvValue(text, 'PGPORT', DEFAULT_PORT);
  text = setEnvValue(text, 'PGUSER', 'postgres');
  text = setEnvValue(text, 'PGPASSWORD', password);
  writeFileSync(ENV_PATH, text);
  process.env.PGPORT = DEFAULT_PORT;
  console.log(`클러스터를 만들었습니다: ${DATA}`);
  console.log('.env에 접속 정보(PGPORT, PGPASSWORD)를 기록했습니다.');
} else if (cmd === 'start') {
  if (!existsSync(join(DATA, 'PG_VERSION'))) {
    console.error('클러스터가 없습니다. 먼저 npm run db:init 을 실행하세요.');
    process.exit(1);
  }
  if (ctl('status').status === 0) {
    console.log('이미 실행 중입니다.');
    process.exit(0);
  }
  const r = ctl('start', ['-w', '-l', join(DATA, 'server.log'), '-o', `-p ${port()} -c listen_addresses=localhost`]);
  if (r.status !== 0) {
    console.error(`시작하지 못했습니다. 로그를 확인하세요: ${join(DATA, 'server.log')}`);
    process.exit(1);
  }
  console.log(`PostgreSQL 실행 중: localhost:${port()}`);
} else if (cmd === 'stop') {
  ctl('stop', ['-m', 'fast']);
  console.log('중지했습니다.');
} else {
  const r = ctl('status');
  console.log(r.status === 0 ? `실행 중 (localhost:${port()})` : '중지됨');
}
