# Tray Persistence + Agent Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the macOS tray survive terminal close / logout / reboot by running it as a launchd LaunchAgent, with an on-demand dashboard child, plus a one-paste install path (`install.md` + npm publish prep).

**Architecture:** The tray process becomes the long-lived root. It scans ports directly via `scanPorts()` (no always-on HTTP server) and spawns the dashboard as a child process only when the user clicks "Open Dashboard". `portwatchx tray --install` writes a launchd plist that runs the tray via the **absolute node binary + absolute `cli.js`** (avoids the nvm/`env node` PATH trap) and keeps it alive across reboots.

**Tech Stack:** Node 20+ ESM, TypeScript strict, commander, systray2, hono server (already present), macOS `launchctl`/`plutil`, node:test + tsx.

**Spec:** `docs/superpowers/specs/2026-05-06-agent-install-and-tray-persistence-design.md`

---

## File Structure

**New files:**
- `src/dashboard.ts` — dashboard-child controller used by the tray: `DASHBOARD_PORT_LINE`, `awaitDashboardPort(child)`, `spawnDashboard(nodePath, cliPath)`, `stopDashboard(child)`. *(Deviation from spec's file list: spec folded this into `cli.ts`/`tray.ts`; pulled into its own file to keep `tray.ts` under the ~200-line CONTRIBUTING soft limit and give the child-process concern one home.)*
- `src/launchd.ts` — `buildPlist()`, `installAgent()`, `uninstallAgent()`, `isInstalled()`, `plistPath()`, `LABEL`. launchctl calls go through an injectable `Runner` so install/uninstall are testable off-macOS.
- `install.md` (repo root) — machine-readable install manifest.
- `.github/workflows/publish.yml` — npm publish on `v*` tag.
- `test/dashboard.test.ts`, `test/tray.test.ts`, `test/launchd.test.ts`.

**Modified files:**
- `src/cli.ts` — platform-branched default command; new `dashboard` subcommand; `tray --install/--uninstall/--foreground`; `trayAction` rewritten to use direct scan + dashboard controller.
- `src/tray.ts` — `collectScanData()` (direct scan→ScanData); `startTray()` new callback-based signature; menu "Open Dashboard"/"Stop Dashboard" toggle; remove `fetchScanData` (HTTP poll).
- `package.json` — drop `private: true`, add `publishConfig`, add new test files to the `test` script.
- `README.md` — replace install section with Prompt + CLI modes.

**Out of this plan (handoff to user, per spec):** running the first real `npm publish`, and adding the `NPM_TOKEN` GitHub secret. The agent prepares files only.

---

## Task 1: `dashboard` controller module (port-line reader)

**Files:**
- Create: `src/dashboard.ts`
- Test: `test/dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/dashboard.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/dashboard.test.ts`
Expected: FAIL — `Cannot find module '../src/dashboard.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/dashboard.ts
import { spawn, type ChildProcess } from 'node:child_process'

export const DASHBOARD_PORT_LINE = 'PORTWATCHX_DASHBOARD_PORT='

export type DashboardProc = { child: ChildProcess; url: string }

/** Resolve with the port the dashboard child prints on stdout, or reject if it dies first. */
export function awaitDashboardPort(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let buf = ''
    const onData = (d: Buffer) => {
      buf += d.toString()
      const line = buf.split('\n').find(l => l.startsWith(DASHBOARD_PORT_LINE))
      if (!line) return
      const port = Number(line.slice(DASHBOARD_PORT_LINE.length).trim())
      cleanup()
      if (Number.isInteger(port) && port > 0) resolve(port)
      else reject(new Error(`bad dashboard port line: ${line}`))
    }
    const onExit = (code: number | null) => { cleanup(); reject(new Error(`dashboard exited before reporting a port (code ${code})`)) }
    const onErr = (err: Error) => { cleanup(); reject(err) }
    const cleanup = () => {
      child.stdout?.off('data', onData)
      child.off('exit', onExit)
      child.off('error', onErr)
    }
    child.stdout?.on('data', onData)
    child.once('exit', onExit)
    child.once('error', onErr)
  })
}

/** Spawn `node <cliPath> dashboard` and wait until it reports its bound port. */
export async function spawnDashboard(nodePath: string, cliPath: string): Promise<DashboardProc> {
  const child = spawn(nodePath, [cliPath, 'dashboard'], { stdio: ['ignore', 'pipe', 'inherit'] })
  const port = await awaitDashboardPort(child)
  return { child, url: `http://127.0.0.1:${port}` }
}

export function stopDashboard(child: ChildProcess): void {
  child.kill('SIGTERM')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/dashboard.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.ts test/dashboard.test.ts
git commit -m "feat(dashboard): add dashboard-child controller"
```

---

## Task 2: `dashboard` subcommand (foreground server that reports its port)

**Files:**
- Modify: `src/cli.ts`

This adds a headless server command. It reuses the existing `startWithAutoPort` helper (`src/cli.ts:13`) and prints the port line the controller from Task 1 reads.

- [ ] **Step 1: Add the import for the port-line constant**

At the top of `src/cli.ts`, after the existing imports (around `src/cli.ts:8`), add:

```ts
import { DASHBOARD_PORT_LINE } from './dashboard.js'
```

- [ ] **Step 2: Add the `dashboardAction` function**

Insert after `startAction` (after `src/cli.ts:45`):

```ts
async function dashboardAction(opts: { port: string }) {
  const base = Number.parseInt(opts.port, 10)
  if (!Number.isFinite(base) || base < 1 || base > 65535) {
    console.error(`Invalid port: ${opts.port}. Must be 1–65535.`)
    process.exit(1)
  }
  const { port, close } = await startWithAutoPort(base)
  // Single machine-readable line the tray's dashboard controller parses; keep the format stable.
  process.stdout.write(`${DASHBOARD_PORT_LINE}${port}\n`)
  const shutdown = () => { close(); process.exit(0) }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
```

- [ ] **Step 3: Register the command**

After the `ls` command registration (after `src/cli.ts:128`), add:

```ts
program
  .command('dashboard')
  .description('Run only the dashboard server in the foreground (no browser)')
  .option('-p, --port <port>', 'Preferred port (auto-increments if busy)', String(DEFAULT_PORT))
  .action(dashboardAction)
```

- [ ] **Step 4: Verify it runs and reports a port**

Run: `npm run build && node dist/cli.js dashboard --port 7600 &` then `sleep 1 && curl -s localhost:7600/api/ports | head -c 40; kill %1`
Expected: stdout shows `PORTWATCHX_DASHBOARD_PORT=7600` and the curl prints `{"success":true,...`.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add headless dashboard subcommand"
```

---

## Task 3: Tray direct-scan (`collectScanData`) + remove HTTP poll

**Files:**
- Modify: `src/tray.ts`
- Test: `test/tray.test.ts`

Replace the HTTP polling path with a direct scanner call. `fetchScanData` is deleted.

- [ ] **Step 1: Write the failing test**

```ts
// test/tray.test.ts
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
  assert.strictEqual(data.ports.length, 2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/tray.test.ts`
Expected: FAIL — `collectScanData` is not exported.

- [ ] **Step 3: Implement `collectScanData`, delete `fetchScanData`**

At the top of `src/tray.ts`, add the scanner import below the existing imports (after `src/tray.ts:1`):

```ts
import { scanPorts, type PortRow } from './scanner.js'
```

Add this exported function near the other exports (e.g. just above `export async function startTray`, `src/tray.ts:121`):

```ts
/** Build tray menu data straight from the scanner. selfPid tags portwatchx's own dashboard row. */
export async function collectScanData(
  selfPid: number,
  scan: () => Promise<PortRow[]> = scanPorts,
): Promise<ScanData> {
  const ports = await scan()
  return {
    ports,
    total: ports.length,
    dev_services: ports.filter(p => p.is_dev_service).length,
    self_pid: selfPid,
  }
}
```

Delete the entire `fetchScanData` function (`src/tray.ts:185-200`) — it is replaced by `collectScanData` and the dashboard server's own `/api/ports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/tray.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tray.ts test/tray.test.ts
git commit -m "feat(tray): scan ports directly, drop HTTP poll"
```

---

## Task 4: Tray menu — callback-based `startTray` with dashboard toggle

**Files:**
- Modify: `src/tray.ts`

Rework the menu and `startTray` so the menu has an "Open Dashboard" / "Stop Dashboard" toggle driven by callbacks, instead of a fixed dashboard URL. No new test (systray2 needs a live menu-bar; covered by manual verification at the end).

- [ ] **Step 1: Replace the `TrayHandle` type and add `TrayCallbacks`**

Replace the existing `TrayHandle` type (`src/tray.ts:36-39`) with:

```ts
export type TrayHandle = {
  update(data: ScanData): Promise<void>
  close(): Promise<void>
}

export type TrayCallbacks = {
  onRefresh: () => Promise<void>
  onToggleDashboard: () => Promise<void>
  isDashboardRunning: () => boolean
  onQuit: () => Promise<void>
}
```

- [ ] **Step 2: Make the menu show the dashboard toggle**

Change `buildMenu` (`src/tray.ts:49`) to take a second arg and swap the menu item. Update the signature line:

```ts
function buildMenu(data: ScanData, dashboardRunning: boolean) {
```

Replace the single `Open Dashboard` push (`src/tray.ts:101`) with:

```ts
  items.push({
    title: dashboardRunning ? 'Stop Dashboard' : 'Open Dashboard',
    tooltip: '', checked: false, enabled: true,
  })
```

- [ ] **Step 3: Rewrite `startTray` to use callbacks**

Replace the whole `startTray` function (`src/tray.ts:121-183`) with:

```ts
export async function startTray(cb: TrayCallbacks): Promise<TrayHandle> {
  // systray2's update-menu doesn't reliably redraw on macOS, so each change tears down the
  // previous SysTray instance and builds a fresh one. Icon is identical → no visible flicker.
  let current: any = null
  let lastData: ScanData | null = null
  let lastRunning = false

  const wireClicks = (tray: any) => {
    tray.onClick(async (action: any) => {
      const title: string = action?.item?.title ?? ''
      const portMatch = title.match(PORT_ROW_RE)
      if (portMatch) {
        const { default: open } = await import('open')
        await open(`http://localhost:${portMatch[1]}`).catch(() => {})
        return
      }
      if (title === 'Open Dashboard' || title === 'Stop Dashboard') {
        await cb.onToggleDashboard().catch(() => {})
        return
      }
      if (title === 'Refresh') {
        await cb.onRefresh().catch(() => {})
        return
      }
      if (title === 'Quit') {
        await cb.onQuit()
      }
    })
  }

  const initial: ScanData = { ports: [], total: 0, dev_services: 0, self_pid: 0 }
  current = new SysTray({ menu: buildMenu(initial, false), copyDir: true })
  await current.ready()
  wireClicks(current)
  lastData = initial

  const sameData = (a: ScanData, b: ScanData) =>
    a.dev_services === b.dev_services &&
    a.total === b.total &&
    a.ports.length === b.ports.length &&
    a.ports.every((p, i) => {
      const q = b.ports[i]
      return q && p.port === q.port && p.pid === q.pid && p.is_dev_service === q.is_dev_service && p.project_name === q.project_name
    })

  return {
    update: async (data: ScanData) => {
      const running = cb.isDashboardRunning()
      if (lastData && running === lastRunning && sameData(lastData, data)) return
      const next = new SysTray({ menu: buildMenu(data, running), copyDir: true })
      await next.ready()
      wireClicks(next)
      const old = current
      current = next
      lastData = data
      lastRunning = running
      try { await old.kill(false) } catch { /* ignore */ }
    },
    close: async () => current.kill(true),
  }
}
```

- [ ] **Step 4: Verify it compiles**

Run: `tsc -p tsconfig.json --noEmit`
Expected: no errors. (Note: `cli.ts` will still reference the old `startTray` signature — Task 5 fixes that; if you run the build before Task 5 it will error in `cli.ts`. To check just this file in isolation, confirm there are no errors reported *inside `src/tray.ts`*.)

- [ ] **Step 5: Commit**

```bash
git add src/tray.ts
git commit -m "feat(tray): callback-driven menu with dashboard toggle"
```

---

## Task 5: Wire the tray to the dashboard controller in `cli.ts`

**Files:**
- Modify: `src/cli.ts`

Rewrite `trayAction` to manage a dashboard child via the Task 1 controller and the Task 4 callbacks.

- [ ] **Step 1: Add imports**

At the top of `src/cli.ts`, add:

```ts
import { realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawnDashboard, stopDashboard, type DashboardProc } from './dashboard.js'
```

(`DASHBOARD_PORT_LINE` is already imported from Task 2.)

- [ ] **Step 2: Replace `trayAction`**

Replace the whole `trayAction` function (`src/cli.ts:80-107`) with:

```ts
async function trayAction(opts: { install?: boolean; uninstall?: boolean; foreground?: boolean }) {
  if (platform() !== 'darwin') {
    console.error('Tray is macOS only. Use `portwatchx` or `portwatchx ls`.')
    process.exit(1)
  }
  if (opts.install) return installTrayAgent()
  if (opts.uninstall) return uninstallTrayAgent()

  const { startTray, collectScanData } = await import('./tray.js')
  const nodePath = process.execPath
  const cliPath = realpathSync(process.argv[1])
  let dash: DashboardProc | null = null
  let handle: Awaited<ReturnType<typeof startTray>>

  const tick = async () => {
    const data = await collectScanData(dash?.child.pid ?? 0)
    await handle.update(data)
  }

  const killDash = () => { if (dash) { stopDashboard(dash.child); dash = null } }

  handle = await startTray({
    onRefresh: tick,
    isDashboardRunning: () => dash !== null,
    onToggleDashboard: async () => {
      if (dash) {
        killDash()
      } else {
        dash = await spawnDashboard(nodePath, cliPath)
        dash.child.once('exit', () => { dash = null; tick().catch(() => {}) })
        const { default: open } = await import('open')
        await open(dash.url).catch(() => {})
      }
      await tick()
    },
    onQuit: async () => {
      killDash()
      await handle.close()
      process.exit(0)
    },
  })

  await tick()
  const timer = setInterval(tick, 5000)

  const shutdown = async () => {
    clearInterval(timer)
    killDash()
    await handle.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  console.log('portwatchx tray running')
}
```

- [ ] **Step 3: Add placeholder install/uninstall stubs (filled in Task 7)**

So the file compiles now, add these stubs after `trayAction` (Task 7 replaces their bodies):

```ts
async function installTrayAgent() {
  console.error('not implemented yet')
  process.exit(1)
}
async function uninstallTrayAgent() {
  console.error('not implemented yet')
  process.exit(1)
}
```

- [ ] **Step 4: Update the `tray` command registration with options**

Replace the `tray` command block (`src/cli.ts:130-133`) with:

```ts
program
  .command('tray')
  .description('Start a menu-bar icon (macOS only)')
  .option('--install', 'Install as a LaunchAgent that survives reboot')
  .option('--uninstall', 'Remove the LaunchAgent')
  .option('--foreground', 'Run the tray in this terminal (does not install)')
  .action(trayAction)
```

- [ ] **Step 5: Verify it compiles and the Linux guard still holds**

Run: `tsc -p tsconfig.json --noEmit`
Expected: no errors.
Run: `node --import tsx --test test/cli-guard.test.ts`
Expected: on macOS, the one test is skipped; on Linux, PASS (still errors "Tray is macOS only").

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): tray manages on-demand dashboard child"
```

---

## Task 6: Platform-branched default command

**Files:**
- Modify: `src/cli.ts`

On macOS, bare `portwatchx` should start the tray; elsewhere it keeps the existing dashboard-in-browser behavior.

- [ ] **Step 1: Add the default action**

Add after `dashboardAction` (from Task 2):

```ts
async function defaultAction() {
  if (platform() === 'darwin') return trayAction({})
  return startAction({ port: String(DEFAULT_PORT), open: true })
}
```

- [ ] **Step 2: Repoint the default command**

Change the `start` command block (`src/cli.ts:116-121`) so the default invokes `defaultAction`, and keep `start` as an explicit browser-opening alias. Replace it with:

```ts
program
  .command('start', { isDefault: true })
  .description('Default: macOS starts the tray; otherwise opens the dashboard in your browser')
  .option('-p, --port <port>', 'Preferred port (auto-increments if busy)', String(DEFAULT_PORT))
  .option('--no-open', 'Do not open the browser automatically')
  .action((opts: { port: string; open: boolean }, cmd: any) => {
    // Bare `portwatchx` (no args beyond the implicit default) → platform default.
    // Explicit `portwatchx start [flags]` → always the dashboard+browser path.
    const calledExplicitly = process.argv[2] === 'start'
    return calledExplicitly ? startAction(opts) : defaultAction()
  })
```

- [ ] **Step 3: Verify behavior**

Run: `node --import tsx src/cli.ts --help`
Expected: help lists `start`, `ls`, `dashboard`, `tray`.
Run (non-macOS or with `--no-open`): `node --import tsx src/cli.ts start --no-open --port 7610 &` then `sleep 1 && curl -s localhost:7610/api/ports | head -c 20; kill %1`
Expected: server responds; `start` path works.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): platform-branched default command"
```

---

## Task 7: launchd plist builder + install/uninstall

**Files:**
- Create: `src/launchd.ts`
- Test: `test/launchd.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/launchd.test.ts
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
  // first install (fake reports not-installed so it proceeds)
  await installAgent({ nodePath: '/bin/node', cliPath: '/a/cli.js', nodeBinDir: '/bin' }, run, home)
  const removed = await uninstallAgent(run, home)
  assert.strictEqual(removed, true)
  assert.ok(calls.some(c => c.cmd === 'launchctl' && c.args[0] === 'bootout'))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test test/launchd.test.ts`
Expected: FAIL — `Cannot find module '../src/launchd.ts'`.

- [ ] **Step 3: Implement `src/launchd.ts`**

```ts
// src/launchd.ts
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const execFile = promisify(execFileCb)

export const LABEL = 'com.portwatchx.tray'

export type Runner = (cmd: string, args: string[]) => Promise<void>
const defaultRunner: Runner = async (cmd, args) => { await execFile(cmd, args) }

export function plistPath(home: string = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`)
}

export function buildPlist(o: { nodePath: string; cliPath: string; nodeBinDir: string; logDir: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${o.nodePath}</string>
        <string>${o.cliPath}</string>
        <string>tray</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${o.logDir}/tray.log</string>
    <key>StandardErrorPath</key>
    <string>${o.logDir}/tray.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${o.nodeBinDir}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
`
}

function uid(): number {
  // getuid is present on darwin/linux; tray --install is darwin-gated upstream.
  return typeof process.getuid === 'function' ? process.getuid() : 0
}

export async function isInstalled(run: Runner = defaultRunner): Promise<boolean> {
  try {
    await run('launchctl', ['print', `gui/${uid()}/${LABEL}`])
    return true
  } catch {
    return false
  }
}

export async function installAgent(
  o: { nodePath: string; cliPath: string; nodeBinDir: string },
  run: Runner = defaultRunner,
  home: string = homedir(),
): Promise<string> {
  if (await isInstalled(run)) {
    throw new Error('already installed; run `portwatchx tray --uninstall` first')
  }
  const logDir = join(home, 'Library', 'Logs', 'portwatchx')
  await mkdir(logDir, { recursive: true })
  const path = plistPath(home)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, buildPlist({ ...o, logDir }), 'utf8')
  try {
    await run('plutil', ['-lint', path])
  } catch (err) {
    await rm(path, { force: true })
    throw new Error(`generated plist failed plutil -lint: ${err instanceof Error ? err.message : err}`)
  }
  await run('launchctl', ['bootstrap', `gui/${uid()}`, path])
  return path
}

export async function uninstallAgent(run: Runner = defaultRunner, home: string = homedir()): Promise<boolean> {
  const path = plistPath(home)
  const loaded = await isInstalled(run)
  if (loaded) {
    try { await run('launchctl', ['bootout', `gui/${uid()}/${LABEL}`]) } catch { /* already gone */ }
  }
  await rm(path, { force: true })
  return loaded
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test test/launchd.test.ts`
Expected: PASS (the `plutil` test is skipped off-macOS).

- [ ] **Step 5: Fill in the CLI install/uninstall functions**

In `src/cli.ts`, add the import:

```ts
import { installAgent, uninstallAgent } from './launchd.js'
```

Replace the Task 5 stubs `installTrayAgent` / `uninstallTrayAgent` with:

```ts
async function installTrayAgent() {
  const cliPath = realpathSync(process.argv[1])
  try {
    const path = await installAgent({
      nodePath: process.execPath,
      cliPath,
      nodeBinDir: dirname(process.execPath),
    })
    console.log(`portwatchx tray installed as a LaunchAgent.\n  plist: ${path}\n  It will start now and after every reboot. Quit from the tray menu to stop it.`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

async function uninstallTrayAgent() {
  const removed = await uninstallAgent()
  console.log(removed ? 'portwatchx tray LaunchAgent removed.' : 'portwatchx tray was not installed.')
}
```

- [ ] **Step 6: Verify the whole build + full suite**

Run: `npm run build`
Expected: CLI + UI build clean.
Run: `npm test`
Expected: all tests pass (after Task 9 adds the new files to the script; if running before Task 9, run `node --import tsx --test test/launchd.test.ts` directly).

- [ ] **Step 7: Commit**

```bash
git add src/launchd.ts test/launchd.test.ts src/cli.ts
git commit -m "feat(launchd): install/uninstall tray as a LaunchAgent"
```

---

## Task 8: `package.json` — publish config + test script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Drop `private`, add `publishConfig`**

Remove the `"private": true,` line and add (next to `version`/`license`):

```json
  "publishConfig": { "access": "public" },
```

- [ ] **Step 2: Add the new test files to the `test` script**

Replace the `test` script value with:

```json
    "test": "node --import tsx --test test/cli-guard.test.ts test/scanner.test.ts test/server.test.ts test/dashboard.test.ts test/tray.test.ts test/launchd.test.ts"
```

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: every test file runs; all pass (macOS-only tests skip off-macOS).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(pkg): make publishable, register new test files"
```

---

## Task 9: `install.md` manifest

**Files:**
- Create: `install.md` (repo root)

- [ ] **Step 1: Write the manifest**

```markdown
# Install portwatchx

You are an AI coding agent installing portwatchx (a local TCP-port
dashboard). Follow these steps in order. If any step fails, stop and
ask the user — do not retry, do not improvise.

1. `node --version`            (must be >= 20)
2. `npm install -g portwatchx`
3. `portwatchx ls`             (verification — must print a table or "No dev services")
4. (macOS only) `portwatchx tray --install`

## Do not
- Run sudo for any of these.
- Start the dashboard from your own shell (it dies when your shell exits;
  use step 4 instead).
```

- [ ] **Step 2: Commit**

```bash
git add install.md
git commit -m "docs: add agent install manifest"
```

---

## Task 10: npm publish workflow

**Files:**
- Create: `.github/workflows/publish.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: publish
on:
  push:
    tags:
      - 'v*'
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Lint the YAML locally (optional but cheap)**

Run: `node -e "require('node:fs').readFileSync('.github/workflows/publish.yml','utf8')" && echo ok`
Expected: `ok` (basic existence/read check; GitHub validates on push).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: publish to npm on version tag"
```

---

## Task 11: README install section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Locate the current install section**

Run: `grep -n -i "install" README.md`
Expected: find the existing install heading and its body.

- [ ] **Step 2: Replace that section's body with the two-mode install**

Replace the existing install section (from its `## Install`-style heading down to the next `##` heading) with:

````markdown
## Install

**Prompt mode** — paste into Claude Code, Codex, Cursor, or Cline:

    Install portwatchx — a local TCP-port dashboard.
    Manifest: https://raw.githubusercontent.com/isS/portwatchx/main/install.md
    Read the manifest and follow it exactly.
    Keep the work scoped to this install only.

**CLI mode** — paste into a terminal:

    npm install -g portwatchx
    portwatchx tray --install   # macOS only

What this does:
1. Installs portwatchx via npm
2. Verifies with `portwatchx ls`
3. (macOS) Loads the menu-bar tray as a LaunchAgent that survives reboot
````

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): two-mode install"
```

---

## Task 12: Final verification + manual macOS check

**Files:** none (verification only)

- [ ] **Step 1: Full build + full test suite**

Run: `npm run build && npm test`
Expected: build clean; all tests pass.

- [ ] **Step 2: Manual macOS smoke test (run on a real Mac)**

Run, one at a time, confirming each:
```bash
node dist/cli.js tray --install
launchctl list | grep com.portwatchx.tray     # appears
ls ~/Library/LaunchAgents/com.portwatchx.tray.plist  # exists
# Close the terminal entirely → tray icon stays in the menu bar.
# Click the tray icon → "Open Dashboard" → browser opens; menu now shows "Stop Dashboard".
# Reboot → tray reappears.
# Tray → Quit → tray disappears and does NOT relaunch.
launchctl list | grep com.portwatchx.tray     # gone after Quit (KeepAlive only restarts on crash)
node dist/cli.js tray --uninstall
ls ~/Library/LaunchAgents/com.portwatchx.tray.plist  # gone
```
Expected: tray survives terminal close and reboot; Quit ends it; uninstall removes the plist.

- [ ] **Step 3: Verify the nvm PATH fix actually took**

Run: `grep -A4 ProgramArguments ~/Library/LaunchAgents/com.portwatchx.tray.plist` (after re-installing)
Expected: first `<string>` is the absolute node path under `~/.nvm/...`, second is the absolute `dist/cli.js`.

---

## Handoff to user (not agent steps)

After the plan is implemented and merged:
1. **First npm publish:** `npm version <patch|minor|major>` then `npm publish` from a clean checkout, signed in to npm.
2. **Add `NPM_TOKEN`** as a GitHub Actions repo secret so the `publish.yml` workflow can publish on future `v*` tags.

Until step 1 is done, `install.md`'s `npm install -g portwatchx` will not resolve — expected.
