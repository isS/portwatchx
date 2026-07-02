import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

// macOS-only feature (the tray is darwin-only), so the lock lives under Application Support.
export function lockPath(home: string = homedir()): string {
  return join(home, 'Library', 'Application Support', 'portwatchx', 'tray.pid')
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // ESRCH = no such process (dead); EPERM = exists but not signalable (alive, other user).
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Acquire the single-instance lock. Returns false if another LIVE process already holds it;
 * a stale lock (owner pid dead) is reclaimed. On success the current pid owns the lock file.
 */
export function acquireSingleInstanceLock(path: string = lockPath()): boolean {
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, 'utf8').trim())
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && isAlive(pid)) {
      return false
    }
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, String(process.pid), 'utf8')
  return true
}

/** Remove the lock file, but only if it still belongs to the current process. */
export function releaseSingleInstanceLock(path: string = lockPath()): void {
  try {
    if (existsSync(path) && Number(readFileSync(path, 'utf8').trim()) === process.pid) {
      unlinkSync(path)
    }
  } catch {
    /* best-effort cleanup */
  }
}
