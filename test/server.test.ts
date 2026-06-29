import test from 'node:test'
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createApp } from '../src/server.ts'
import type { PortRow } from '../src/scanner.ts'

const stubRows: PortRow[] = [
  {
    process: 'node', pid: 1, user: 'u',
    protocol: 'TCP', address: '127.0.0.1', port: 3000,
    command: 'node server.js', cwd: '/tmp/app', project_dir: '/tmp/app',
    project_name: 'app', has_project_marker: true, uptime_seconds: 3600, is_dev_service: true,
  },
]

test('GET /api/ports returns the scanner output', async () => {
  const app = createApp(async () => stubRows)
  const res = await app.request('/api/ports')
  assert.strictEqual(res.status, 200)
  const body = await res.json() as any
  assert.strictEqual(body.success, true)
  assert.strictEqual(body.data.total, 1)
  assert.strictEqual(body.data.dev_services, 1)
  assert.strictEqual(body.data.identified_projects, 1)
  assert.strictEqual(body.data.self_pid, process.pid)
  assert.deepStrictEqual(body.data.ports, stubRows)
})

test('GET /api/ports handles scanner errors', async () => {
  const app = createApp(async () => { throw new Error('lsof missing') })
  const res = await app.request('/api/ports')
  assert.strictEqual(res.status, 500)
  const body = await res.json() as any
  assert.strictEqual(body.success, false)
})

function killReq(body: unknown) {
  return new Request('http://x/api/kill', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('POST /api/kill rejects an invalid pid', async () => {
  const app = createApp(async () => stubRows)
  const res = await app.request(killReq({ pid: 'abc' }))
  assert.strictEqual(res.status, 400)
  assert.strictEqual((await res.json() as any).success, false)
})

test('POST /api/kill refuses to kill itself', async () => {
  const app = createApp(async () => stubRows)
  const res = await app.request(killReq({ pid: process.pid }))
  assert.strictEqual(res.status, 400)
  assert.match((await res.json() as any).error, /itself/)
})

test('POST /api/kill reports a missing process', async () => {
  const app = createApp(async () => stubRows)
  // pid 0x7fffffff is virtually guaranteed not to exist
  const res = await app.request(killReq({ pid: 2147483647 }))
  assert.strictEqual(res.status, 404)
  assert.strictEqual((await res.json() as any).success, false)
})

test('POST /api/kill terminates a live process', async () => {
  const app = createApp(async () => stubRows)
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
  const exited = once(child, 'exit')
  const res = await app.request(killReq({ pid: child.pid }))
  assert.strictEqual(res.status, 200)
  assert.strictEqual((await res.json() as any).success, true)
  const [code, signal] = await exited
  assert.strictEqual(signal, 'SIGTERM')
  assert.strictEqual(code, null)
})
