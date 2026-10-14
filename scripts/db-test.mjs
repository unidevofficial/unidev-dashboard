// RLS·트리거 검증 테스트 (db/local/tests/*.sql)
// 개발 DB를 건드리지 않도록 별도 DB(<PGDATABASE>_test)를 가상 데이터로 새로 만든 뒤 실행한다.
// 각 테스트 파일은 begin ... rollback 으로 감싸져 있다.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, loadEnv, psql, sqlFiles } from './lib.mjs';

const env = loadEnv();
const testDb = `${env.PGDATABASE}_test`;

const reset = spawnSync(process.execPath, [join(ROOT, 'scripts', 'db-reset.mjs'), '--sample', `--db=${testDb}`], { stdio: 'inherit' });
if (reset.status !== 0) process.exit(reset.status ?? 1);

for (const f of sqlFiles('db/local/tests')) {
  console.log(`테스트: ${f.slice(f.indexOf('db'))}`);
  psql(env, { database: testDb, file: f });
}
console.log('모든 테스트 통과.');
