import test from 'node:test'
import assert from 'node:assert'
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
