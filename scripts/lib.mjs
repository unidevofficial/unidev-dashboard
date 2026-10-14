// 로컬 개발 스크립트 공용 함수
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) {
    console.error('.env 파일이 없습니다. .env.example을 복사해 .env를 만들고 PGPASSWORD 등을 채우세요.');
    process.exit(1);
  }
  process.loadEnvFile(envPath);
  const env = process.env;
  for (const key of ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'JWT_SECRET', 'AUTHENTICATOR_PASSWORD', 'LOGIN_DOMAIN', 'DEV_ACCOUNT_PASSWORD']) {
    if (!env[key]) {
      console.error(`.env에 ${key} 값이 없습니다.`);
      process.exit(1);
    }
  }
  if (env.JWT_SECRET.length < 32) {
    console.error('JWT_SECRET은 32자 이상이어야 합니다.');
    process.exit(1);
  }
  return env;
}

// PostgreSQL bin 폴더를 PATH 앞에 붙인 환경 (psql.exe, libpq.dll 사용)
export function pgEnv(env, extra = {}) {
  const bin = env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin';
  return { ...process.env, ...extra, PATH: `${bin}${delimiter}${process.env.PATH}` };
}

export function psqlPath(env) {
  const bin = env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin';
  const exe = join(bin, process.platform === 'win32' ? 'psql.exe' : 'psql');
  return existsSync(exe) ? exe : 'psql';
}

// psql 실행. 실패하면 프로세스를 종료한다.
export function psql(env, { database, file, command, vars = {}, quiet = true }) {
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-d', database ?? env.PGDATABASE];
  if (quiet) args.push('-q');
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  if (file) args.push('-f', file);
  if (command) args.push('-c', command);
  const res = spawnSync(psqlPath(env), args, {
    env: pgEnv(env, { PGCLIENTENCODING: 'UTF8' }),
    encoding: 'utf8',
  });
  if (res.error) {
    console.error(`psql 실행 실패: ${res.error.message}`);
    process.exit(1);
  }
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.status !== 0) {
    process.stderr.write(res.stderr);
    console.error(`\n실패: ${file ?? command}`);
    process.exit(res.status ?? 1);
  }
  // NOTICE 출력 중 테스트 결과(PASS/FAIL)만 보여준다
  for (const line of (res.stderr || '').split(/\r?\n/)) {
    if (/NOTICE:/.test(line)) console.log(line.replace(/^.*NOTICE:\s*/, '  '));
  }
}

export function sqlFiles(dir, filter = () => true) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith('.sql') && filter(f))
    .sort()
    .map((f) => join(abs, f));
}
