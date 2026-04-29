import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { PortRow } from './scanner.js'
import { scanPorts } from './scanner.js'

export type ScanFn = () => Promise<PortRow[]>

export function createApp(scan: ScanFn = scanPorts) {
  const app = new Hono()

  app.get('/api/ports', async (c) => {
    try {
      const ports = await scan()
      const identified = new Set(
        ports.filter(r => r.project_dir).map(r => r.project_dir),
      )
      return c.json({
        success: true,
        data: {
          ports,
          total: ports.length,
          identified_projects: identified.size,
          dev_services: ports.filter(r => r.is_dev_service).length,
          self_pid: process.pid,
          refreshed_at: new Date().toISOString().slice(0, 19),
        },
      })
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : 'scan failed' },
        500,
      )
    }
  })

  // Static UI
  const here = dirname(fileURLToPath(import.meta.url))
  const uiRoot = join(here, 'ui')
  app.use('/*', serveStatic({ root: uiRoot }))

  return app
}

export async function startServer(port: number): Promise<{ port: number; close: () => void }> {
  const app = createApp()
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      resolve({
        port: info.port,
        close: () => server.close(),
      })
    })
    server.on('error', reject)
  })
}
