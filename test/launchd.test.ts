import test from 'node:test'
import assert from 'node:assert'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildPlist, installAgent, uninstallAgent, plistPath, LABEL } from '../src/launchd.ts'

const run = promisify(execFile)

test('buildPlist embeds absolute node + cli paths and prepends node bin dir to PATH', () => {
  const xml = buildPlist({
    nodePath: '/Users/x/.nvm/versions/node/v22.0.0/bin/node',
    cliPath: '/Users/x/app/dist/cli.js',
    nodeBinDir: '/Users/x/.nvm/versions/node/v22.0.0/bin',
    logDir: '/Users/x/Library/Logs/portwatchx',
  })
  assert.match(xml, /<string>com\.portwatchx\.tray<\/string>/)
  assert.match(xml, /<string>\/Users\/x\/\.nvm\/versions\/node\/v22\.0\.0\/bin\/node<\/string>\s*<string>\/Users\/x\/app\/dist\/cli\.js<\/string>\s*<string>tray<\/string>/)
  assert.match(xml, /<key>PATH<\/key>\s*<string>\/Users\/x\/\.nvm\/versions\/node\/v22\.0\.0\/bin:/)
  assert.match(xml, /<key>SuccessfulExit<\/key>\s*<false\/>/)
})

test('plutil accepts the generated plist', { skip: process.platform !== 'darwin' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pwx-'))
  const file = join(dir, 'test.plist')
  await writeFile(file, buildPlist({ nodePath: '/bin/node', cliPath: '/a/cli.js', nodeBinDir: '/bin', logDir: dir }))
  await run('plutil', ['-lint', file]) // throws on invalid
})

function fakeRunner(installed: boolean) {
  const calls: { cmd: string; args: string[] }[] = []
  const run = async (cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    if (cmd === 'launchctl' && args[0] === 'print' && !installed) throw new Error('not loaded')
  }
  return { run, calls }
}

test('installAgent writes the plist and bootstraps when not already installed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'pwx-home-'))
  const { run, calls } = fakeRunner(false)
  const path = await installAgent(
    { nodePath: '/bin/node', cliPath: '/a/cli.js', nodeBinDir: '/bin' },
    run, home,
  )
  assert.strictEqual(path, plistPath(home))
  const xml = await readFile(path, 'utf8')
  assert.match(xml, /\/a\/cli\.js/)
  assert.ok(calls.some(c => c.cmd === 'launchctl' && c.args[0] === 'bootstrap'))
})

test('installAgent refuses when already installed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'pwx-home-'))
  const { run } = fakeRunner(true)
  await assert.rejects(
    installAgent({ nodePath: '/bin/node', cliPath: '/a/cli.js', nodeBinDir: '/bin' }, run, home),
    /already installed/,
  )
})

test('uninstallAgent boots out and removes the plist', async () => {
  const home = await mkdtemp(join(tmpdir(), 'pwx-home-'))
  const { run, calls } = fakeRunner(false)
  await installAgent({ nodePath: '/bin/node', cliPath: '/a/cli.js', nodeBinDir: '/bin' }, run, home)
  const removed = await uninstallAgent(run, home)
  assert.strictEqual(removed, true)
  assert.ok(calls.some(c => c.cmd === 'launchctl' && c.args[0] === 'bootout'))
})
