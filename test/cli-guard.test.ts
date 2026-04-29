import test from 'node:test'
import assert from 'node:assert'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

test(
  'tray subcommand fails cleanly on Linux',
  { skip: process.platform === 'darwin' },
  async () => {
    try {
      await run('npm', ['run', 'dev', '--silent', '--', 'tray'])
      assert.fail('expected non-zero exit')
    } catch (err: any) {
      assert.strictEqual(err.code, 1)
      assert.match(err.stderr, /Tray is macOS only/)
    }
  },
)
