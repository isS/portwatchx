import test from 'node:test'
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { awaitDashboardPort, DASHBOARD_PORT_LINE } from '../src/dashboard.ts'

test('awaitDashboardPort reads the port line from child stdout', async () => {
  const script = `process.stdout.write('noise\\n'); process.stdout.write('${DASHBOARD_PORT_LINE}4321\\n'); setInterval(() => {}, 1000)`
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
  try {
    const port = await awaitDashboardPort(child)
    assert.strictEqual(port, 4321)
  } finally {
    child.kill('SIGTERM')
  }
})

test('awaitDashboardPort rejects if the child exits before printing', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(3)'], { stdio: ['ignore', 'pipe', 'inherit'] })
  await assert.rejects(awaitDashboardPort(child), /exited/)
})
