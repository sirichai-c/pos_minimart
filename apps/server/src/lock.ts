import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// กันไม่ให้ server สองตัว หรือ restore ระหว่าง server ทำงาน เปิดฐานข้อมูลเดียวกัน (R08)
const lockPath = (dataDir: string) => resolve(dataDir, 'server.lock');

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (err) { return (err as { code?: string }).code === 'EPERM'; }
}

export function runningServerPid(dataDir: string): number | null {
  const path = lockPath(dataDir);
  if (!existsSync(path)) return null;
  const pid = Number(readFileSync(path, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid) ? pid : null;
}

export function acquireServerLock(dataDir: string): void {
  const pid = runningServerPid(dataDir);
  if (pid) throw new Error(`มี server บ้านดี POS ทำงานอยู่แล้ว (pid ${pid})`);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(lockPath(dataDir), String(process.pid));
}

export function releaseServerLock(dataDir: string): void {
  rmSync(lockPath(dataDir), { force: true });
}
