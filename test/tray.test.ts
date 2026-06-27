import test from 'node:test'
import assert from 'node:assert'
import { collectScanData } from '../src/tray.ts'
import type { PortRow } from '../src/scanner.ts'

const rows = [
  { port: 3000, process: 'node', project_name: 'app', is_dev_service: true, pid: 11 },
  { port: 5432, process: 'postgres', project_name: '', is_dev_service: false, pid: 22 },
] as unknown as PortRow[]

test('collectScanData summarizes scanner rows with the given self pid', async () => {
  const data = await collectScanData(11, async () => rows)
  assert.strictEqual(data.total, 2)
  assert.strictEqual(data.dev_services, 1)
  assert.strictEqual(data.self_pid, 11)
  assert.deepStrictEqual(data.ports, rows)
})
