export type PortRow = {
  port: number
  protocol: 'TCP'
  address: string
  pid: number
  user: string
  process: string
  command: string
  cwd: string
  project_dir: string
  project_name: string
  has_project_marker: boolean
  uptime_seconds: number
  is_dev_service: boolean
}

export type PortsResponse = {
  success: true
  data: {
    ports: PortRow[]
    total: number
    identified_projects: number
    dev_services: number
    self_pid: number
    refreshed_at: string
  }
}

export async function fetchPorts(): Promise<PortsResponse['data']> {
  const res = await fetch('/api/ports')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as PortsResponse
  if (!body.success) throw new Error('scan failed')
  return body.data
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export type SortKey = 'port' | 'project' | 'process' | 'pid' | 'uptime'
export type SortDir = 'asc' | 'desc'
export type ColumnKey = 'address' | 'process' | 'pid' | 'project' | 'uptime' | 'command'

const HIDDEN_COLS_KEY = 'pwx-hidden-cols'

export function getHiddenColumns(): Set<ColumnKey> {
  try {
    const raw = localStorage.getItem(HIDDEN_COLS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as ColumnKey[]
    return new Set(arr)
  } catch (_) {
    return new Set()
  }
}

export function saveHiddenColumns(hidden: Set<ColumnKey>): void {
  try {
    localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify([...hidden]))
  } catch (_) {}
}

export function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  if (seconds < 60) return `${seconds}s`
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  return `${mins}m`
}

export function compareRows(a: PortRow, b: PortRow, key: SortKey, dir: SortDir): number {
  let cmp = 0
  if (key === 'port') cmp = a.port - b.port
  else if (key === 'pid') cmp = a.pid - b.pid
  else if (key === 'project') cmp = (a.project_name || '￿').localeCompare(b.project_name || '￿')
  else if (key === 'process') cmp = a.process.localeCompare(b.process)
  else if (key === 'uptime') cmp = a.uptime_seconds - b.uptime_seconds
  if (cmp === 0) cmp = a.port - b.port
  return dir === 'asc' ? cmp : -cmp
}
