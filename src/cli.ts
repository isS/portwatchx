#!/usr/bin/env node
import { Command } from 'commander'
import { platform } from 'node:os'
import open from 'open'
import Table from 'cli-table3'
import chalk from 'chalk'
import { startServer } from './server.js'
import { scanPorts } from './scanner.js'

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

async function trayAction() {
  if (platform() !== 'darwin') {
    console.error('Tray is macOS only. Use `portwatchx` or `portwatchx ls`.')
    process.exit(1)
  }
  const { port } = await startWithAutoPort(DEFAULT_PORT)
  const url = `http://127.0.0.1:${port}`
  const { startTray, fetchScanData } = await import('./tray.js')

  const tick = async () => {
    const data = await fetchScanData(url)
    if (data) await handle.update(data)
  }

  const handle = await startTray(url, tick)
  await tick()
  const timer = setInterval(tick, 5000)

  const shutdown = async () => {
    clearInterval(timer)
    await handle.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  console.log(`portwatchx tray running · dashboard at ${url}`)
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
  .command('tray')
  .description('Start a menu-bar icon (macOS only)')
  .action(trayAction)

program.parseAsync()
