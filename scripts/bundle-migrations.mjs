// Supabase 이전용: db/migrations + db/seed를 순서대로 이어 붙여 한 파일로 만든다.
// 결과물(dist/supabase_init.sql)을 Supabase SQL Editor에 붙여 실행하거나,
// supabase/migrations 폴더로 개별 파일을 복사해 `supabase db push`로 적용한다.
// db/local, db/private/local은 포함하지 않는다.
// --with-data 를 붙이면 db/private/*.sql(실제 명단)도 넣는다. 결과 파일에 개인정보가 들어가므로 공유하지 말 것.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, sqlFiles } from './lib.mjs';

const withData = process.argv.includes('--with-data');
const files = [...sqlFiles('db/migrations'), ...sqlFiles('db/seed'), ...(withData ? sqlFiles('db/private') : [])];
const parts = files.map((f) => {
  const rel = f.slice(f.indexOf('db')).replaceAll('\\', '/');
  return `-- ==================== ${rel} ====================\n${readFileSync(f, 'utf8').trim()}\n`;
});
const out = join(ROOT, 'dist', 'supabase_init.sql');
mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(out, `-- 자동 생성 파일 (npm run db:bundle). 직접 수정하지 말 것.\nbegin;\n\n${parts.join('\n')}\ncommit;\n`);
console.log(`생성: ${out} (${files.length}개 파일)`);
