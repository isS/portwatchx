import test from 'node:test'
import assert from 'node:assert'
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireSingleInstanceLock, releaseSingleInstanceLock } from '../src/single-instance.ts'

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

async function lockFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pwx-lock-'))
  return join(dir, 'tray.pid')
}

test('acquire succeeds and writes our pid when no lock exists', async () => {
  const path = await lockFile()
  assert.strictEqual(acquireSingleInstanceLock(path), true)
  assert.strictEqual((await readFile(path, 'utf8')).trim(), String(process.pid))
})

test('acquire fails when a live process already holds the lock', async () => {
  const path = await lockFile()
  // pid 1 (launchd/init) is always alive and is never our pid.
  await writeFile(path, '1', 'utf8')
  assert.strictEqual(acquireSingleInstanceLock(path), false)
  // the foreign lock must be left intact
  assert.strictEqual((await readFile(path, 'utf8')).trim(), '1')
})

test('acquire reclaims a stale lock held by a dead pid', async () => {
  const path = await lockFile()
  await writeFile(path, '2147483647', 'utf8') // not a live pid
  assert.strictEqual(acquireSingleInstanceLock(path), true)
  assert.strictEqual((await readFile(path, 'utf8')).trim(), String(process.pid))
})

test('release removes a lock we own', async () => {
  const path = await lockFile()
  acquireSingleInstanceLock(path)
  releaseSingleInstanceLock(path)
  assert.strictEqual(await exists(path), false)
})

test('release leaves a lock owned by another process intact', async () => {
  const path = await lockFile()
  await writeFile(path, '1', 'utf8')
  releaseSingleInstanceLock(path)
  assert.strictEqual(await exists(path), true)
})
