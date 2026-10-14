// 로컬 DB를 지우고 처음부터 다시 만든다.
//   1) db/local/00~49     : Supabase 호환 준비 (역할, auth 스키마)
//   2) db/migrations      : 스키마·함수·뷰·RLS (Supabase에 그대로 적용할 파일)
//   3) db/seed            : 역할 종류, 현행 팀
//   4) 데이터 (택1)
//      - 기본: db/private/*.sql (실제 명단, scripts/import-roster.py로 생성) + db/private/local/*.sql (개발용 로그인 연결)
//              db/private가 없으면 가상 데이터를 넣는다
//      - --sample : db/local/50~99 가상 데이터
//      - --empty  : 데이터 없음
//   --db=<이름> : .env의 PGDATABASE 대신 다른 DB에 만든다 (테스트용)
import { basename } from 'node:path';
import { loadEnv, psql, sqlFiles } from './lib.mjs';

const env = loadEnv();
const arg = (name) => process.argv.includes(`--${name}`);
const db = process.argv.find((a) => a.startsWith('--db='))?.slice(5) ?? env.PGDATABASE;

if (!/^[a-z_][a-z0-9_]*$/.test(db)) {
  console.error(`DB 이름은 영문 소문자·숫자·밑줄만 쓸 수 있습니다: ${db}`);
  process.exit(1);
}

const prefix = (f) => Number(basename(f).slice(0, 2));
const privateFiles = [...sqlFiles('db/private'), ...sqlFiles('db/private/local')];
const sampleFiles = sqlFiles('db/local', (f) => prefix(f) >= 50);
let dataFiles;
if (arg('empty')) dataFiles = [];
else if (arg('sample')) dataFiles = sampleFiles;
else if (privateFiles.length) dataFiles = privateFiles;
else {
  console.log('db/private에 실제 명단 SQL이 없어 가상 데이터를 넣습니다. (python scripts/import-roster.py 로 생성)');
  dataFiles = sampleFiles;
}

console.log(`데이터베이스 '${db}'를 다시 만듭니다.`);
psql(env, { database: 'postgres', command: `drop database if exists ${db} with (force)` });
psql(env, { database: 'postgres', command: `create database ${db} encoding 'UTF8' template template0` });

// 로컬 전용 파일에 넘기는 psql 변수
const localVars = {
  authenticator_password: env.AUTHENTICATOR_PASSWORD,
  dev_password: env.DEV_ACCOUNT_PASSWORD,
  login_domain: env.LOGIN_DOMAIN,
};
const isLocalFile = (f) => /[\\/]db[\\/](local|private[\\/]local)[\\/]/.test(f);
const steps = [
  ...sqlFiles('db/local', (f) => prefix(f) < 50),
  ...sqlFiles('db/migrations'),
  ...sqlFiles('db/seed'),
  ...dataFiles,
].map((f) => ({ f, vars: isLocalFile(f) ? localVars : {} }));

for (const { f, vars } of steps) {
  console.log(`  적용: ${f.slice(f.indexOf('db'))}`);
  psql(env, { database: db, file: f, vars });
}

// 실행 중인 PostgREST가 있으면 스키마 캐시를 다시 읽게 한다
psql(env, { database: db, command: "notify pgrst, 'reload schema'" });
console.log('완료.');
