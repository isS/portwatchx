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
