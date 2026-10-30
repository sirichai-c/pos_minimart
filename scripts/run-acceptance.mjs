// npm run test:acceptance -- A03 A05   → รันเฉพาะกรณีที่ระบุ (จับจากชื่อ test)
// เรียก vitest ด้วย node โดยตรง ไม่ผ่าน shell เพราะ cmd.exe ตีความ ( | ) ใน pattern
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const ids = process.argv.slice(2).filter(a => /^A\d{2}$/i.test(a)).map(a => a.toUpperCase());
const args = [vitest, 'run', '--project', 'acceptance'];
if (ids.length) args.push('-t', `(${ids.join('|')})\\b`);
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
