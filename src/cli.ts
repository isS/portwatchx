#!/usr/bin/env node
import { Command } from 'commander'
import { platform } from 'node:os'
import { realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import open from 'open'
import Table from 'cli-table3'
import chalk from 'chalk'
import { startServer } from './server.js'
import { scanPorts } from './scanner.js'
import { DASHBOARD_PORT_LINE, spawnDashboard, stopDashboard, type DashboardProc } from './dashboard.js'

const DEFAULT_PORT = 7575
const MAX_PORT_TRIES = 10

async function startWithAutoPort(base: number): Promise<{ port: number; close: () => void }> {
  let last: unknown
  for (let i = 0; i < MAX_PORT_TRIES; i++) {
    const candidate = base + i
    try {
      return await startServer(candidate)
    } catch (err: any) {
      if (err?.code !== 'EADDRINUSE') throw err
      last = err
    }
  }
  const lastMsg = last instanceof Error ? last.message : String(last)
  throw new Error(
    `Could not bind a port in ${base}–${base + MAX_PORT_TRIES - 1}. Last error: ${lastMsg}`,
  )
}

async function startAction(opts: { port: string; open: boolean }) {
  const base = Number.parseInt(opts.port, 10)
  if (!Number.isFinite(base) || base < 1 || base > 65535) {
    console.error(`Invalid port: ${opts.port}. Must be 1–65535.`)
    process.exit(1)
  }
  const { port } = await startWithAutoPort(base)
  const url = `http://127.0.0.1:${port}`
  console.log(`portwatchx listening at ${url}`)
  if (opts.open) {
    await open(url).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[warn] Could not open browser: ${msg}`)
    })
  }
}

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

async function lsAction(opts: { dev: boolean; all: boolean }) {
  let rows = await scanPorts()
  if (!opts.all) rows = rows.filter(r => r.is_dev_service)

  if (rows.length === 0) {
    console.log(opts.all ? 'No listening ports.' : 'No dev services. Use --all to see every listener.')
    return
  }

  const table = new Table({
    head: ['Port', 'Address', 'Process', 'PID', 'Project', 'Command'].map(s => chalk.gray(s)),
    style: { head: [], border: ['gray'] },
    wordWrap: false,
  })

  for (const r of rows) {
    const project = r.project_name
      ? chalk.cyan(r.project_name) + chalk.gray(` (${r.project_dir})`)
      : chalk.dim('—')
    const cmd = r.command.length > 50 ? r.command.slice(0, 47) + '…' : r.command
    table.push([
      chalk.bold(String(r.port)),
      r.address,
      r.is_dev_service ? chalk.green(r.process) : r.process,
      String(r.pid),
      project,
      chalk.dim(cmd),
    ])
  }

  console.log(table.toString())
}

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

async function installTrayAgent() {
  console.error('not implemented yet')
  process.exit(1)
}
async function uninstallTrayAgent() {
  console.error('not implemented yet')
  process.exit(1)
}

const program = new Command()

program
  .name('portwatchx')
  .description('See which local dev project is using each TCP port.')
  .version('0.1.0')

program
  .command('start', { isDefault: true })
  .description('Start the dashboard and open it in your browser')
  .option('-p, --port <port>', 'Preferred port (auto-increments if busy)', String(DEFAULT_PORT))
  .option('--no-open', 'Do not open the browser automatically')
  .action(startAction)

program
  .command('ls')
  .description('Print the port table to the terminal')
  .option('--all', 'Show all listeners, not just dev services', false)
  .option('--dev', 'Show only dev services (default)', true)
  .action(lsAction)

program
  .command('dashboard')
  .description('Run only the dashboard server in the foreground (no browser)')
  .option('-p, --port <port>', 'Preferred port (auto-increments if busy)', String(DEFAULT_PORT))
  .action(dashboardAction)

program
  .command('tray')
  .description('Start a menu-bar icon (macOS only)')
  .option('--install', 'Install as a LaunchAgent that survives reboot')
  .option('--uninstall', 'Remove the LaunchAgent')
  .option('--foreground', 'Run the tray in this terminal (does not install)')
  .action(trayAction)

program.parseAsync()
