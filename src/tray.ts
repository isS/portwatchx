import * as SysTrayModule from 'systray2'
// systray2 is a CJS module with __esModule:true; under Node ESM interop the class
// ends up at module.default.default (the namespace wrapper adds one extra level).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SysTray: typeof import('systray2').default = (SysTrayModule as any).default?.default ?? (SysTrayModule as any).default ?? SysTrayModule

// 64x64 PNG: Mario-style pipe silhouette (wide rim + narrow body), filled black on
// transparent. Hand-built by `assets/gen-tray-icon.cjs` (qlmanage produces empty PNGs
// from our SVGs on this macOS version). Used as a macOS template icon — auto-tints
// to light/dark menubar. Regenerate with: `node assets/gen-tray-icon.cjs > /tmp/b64`
const ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAW0lEQVR42u3XMREAAAwCsfo33e5IoPk7DGRjRpIkScq2bAAAAAAAAAAAAAAAAAAAoPEtvr/LAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgCRJUnR+klESh692hwAAAABJRU5ErkJggg=='

const MAX_DEV_INLINE = 12
const NAME_WIDTH = 28
const PORT_WIDTH = 5
// U+2007 (figure space) is digit-width in SF Pro, so right-padding the port to a
// fixed character count keeps the name column at the same x-offset on every row
// even though the menu font is otherwise proportional.
const FIGURE_SPACE = ' '

type PortLike = {
  port: number
  process: string
  project_name: string
  is_dev_service: boolean
  pid: number
}

export type ScanData = {
  ports: PortLike[]
  total: number
  dev_services: number
  self_pid: number
}

export type TrayHandle = {
  update(data: ScanData): Promise<void>
  close(): Promise<void>
}

function formatRow(p: PortLike, selfPid: number): string {
  const label = p.project_name || p.process || '?'
  const trimmed = label.length > NAME_WIDTH ? label.slice(0, NAME_WIDTH - 1) + '…' : label
  const tag = p.pid === selfPid ? ' (self)' : ''
  const portStr = String(p.port).padStart(PORT_WIDTH, FIGURE_SPACE)
  return `${portStr}  ${trimmed}${tag}`
}

function buildMenu(data: ScanData) {
  const dev = data.ports.filter(p => p.is_dev_service)
  const inline = dev.slice(0, MAX_DEV_INLINE)
  const overflow = dev.length - inline.length

  const items: any[] = []

  items.push({
    title: `portwatchx · ${data.dev_services} dev / ${data.total} listening`,
    tooltip: '',
    checked: false,
    enabled: false,
  })
  items.push(SysTray.separator)

  if (inline.length === 0) {
    items.push({ title: 'No dev services', tooltip: '', checked: false, enabled: false })
  } else {
    for (const p of inline) {
      items.push({
        title: formatRow(p, data.self_pid),
        tooltip: `Open http://localhost:${p.port}`,
        checked: false,
        enabled: true,
      })
    }
    if (overflow > 0) {
      items.push({
        title: `…  +${overflow} more dev — see All Listeners`,
        tooltip: '',
        checked: false,
        enabled: false,
      })
    }
  }
  items.push(SysTray.separator)

  const allSorted = [...data.ports].sort((a, b) => a.port - b.port || a.process.localeCompare(b.process))
  items.push({
    title: `All Listeners (${data.total})`,
    tooltip: '',
    checked: false,
    enabled: true,
    items: allSorted.map(p => ({
      title: formatRow(p, data.self_pid),
      tooltip: `Open http://localhost:${p.port}`,
      checked: false,
      enabled: true,
    })),
  })
  items.push(SysTray.separator)

  items.push({ title: 'Open Dashboard', tooltip: '', checked: false, enabled: true })
  items.push({ title: 'Refresh', tooltip: '', checked: false, enabled: true })
  items.push(SysTray.separator)
  items.push({ title: 'Quit', tooltip: '', checked: false, enabled: true })

  return {
    icon: ICON_BASE64,
    isTemplateIcon: true,
    // No title — user wants just the icon, no number badge.
    title: '',
    tooltip: data.dev_services > 0
      ? `portwatchx · ${data.dev_services} dev / ${data.total} listening`
      : 'portwatchx',
    items,
  }
}

// Port-row title looks like: "  3000  project-name [(self)]" — right-padded with U+2007.
const PORT_ROW_RE = /^[ ]*(\d+) /

export async function startTray(dashboardUrl: string, refresh: () => Promise<void>): Promise<TrayHandle> {
  // We don't trust systray2's update-menu to redraw items reliably on macOS, so each tick
  // tears down the previous SysTray instance and creates a fresh one. The icon is the same,
  // so the user perceives this as "menu just changed" with no visible flicker on the icon itself.
  let current: any = null
  let lastData: ScanData | null = null

  const wireClicks = (tray: any) => {
    tray.onClick(async (action: any) => {
      const title: string = action?.item?.title ?? ''
      const portMatch = title.match(PORT_ROW_RE)
      if (portMatch) {
        const { default: open } = await import('open')
        await open(`http://localhost:${portMatch[1]}`).catch(() => {})
        return
      }
      if (title === 'Open Dashboard') {
        const { default: open } = await import('open')
        await open(dashboardUrl).catch(() => {})
        return
      }
      if (title === 'Refresh') {
        await refresh().catch(() => {})
        return
      }
      if (title === 'Quit') {
        await tray.kill(true)
        process.exit(0)
      }
    })
  }

  const initial: ScanData = { ports: [], total: 0, dev_services: 0, self_pid: 0 }
  current = new SysTray({ menu: buildMenu(initial), copyDir: true })
  await current.ready()
  wireClicks(current)
  lastData = initial

  return {
    update: async (data: ScanData) => {
      if (lastData
        && lastData.dev_services === data.dev_services
        && lastData.total === data.total
        && lastData.ports.length === data.ports.length
        && lastData.ports.every((p, i) => {
          const q = data.ports[i]
          return q && p.port === q.port && p.pid === q.pid && p.is_dev_service === q.is_dev_service && p.project_name === q.project_name
        })
      ) {
        return
      }

      const next = new SysTray({ menu: buildMenu(data), copyDir: true })
      await next.ready()
      wireClicks(next)
      const old = current
      current = next
      lastData = data
      try { await old.kill(false) } catch { /* ignore */ }
    },
    close: async () => current.kill(true),
  }
}

export async function fetchScanData(url: string): Promise<ScanData | null> {
  try {
    const res = await fetch(`${url}/api/ports`)
    const body = await res.json() as any
    if (!body?.success) return null
    const d = body.data
    return {
      ports: d.ports ?? [],
      total: d.total ?? 0,
      dev_services: d.dev_services ?? 0,
      self_pid: d.self_pid ?? 0,
    }
  } catch {
    return null
  }
}
