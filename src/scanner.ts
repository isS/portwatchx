import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'

const run = promisify(execFile)

export type ParsedRow = {
  process: string
  pid: number
  user: string
  protocol: 'TCP'
  address: string
  port: number
}

// lsof escapes non-printable / whitespace chars in COMMAND as \xHH literal text.
// "Google\x20Chrome" → "Google Chrome".
export function decodeLsofProcess(s: string): string {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

export function parseLsofOutput(output: string): ParsedRow[] {
  const rows: ParsedRow[] = []
  const seen = new Set<string>()

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('COMMAND ')) continue

    const parts = line.split(/\s+/)
    if (parts.length < 9) continue

    const tail = parts.slice(7).join(' ')
    const match = tail.match(/\b(TCP)\s+(.+?)\s+\(LISTEN\)/)
    if (!match) continue

    const [, protocol, endpoint] = match
    if (!endpoint.includes(':')) continue

    const lastColon = endpoint.lastIndexOf(':')
    const address = endpoint.slice(0, lastColon)
    const portText = endpoint.slice(lastColon + 1)

    const pid = Number.parseInt(parts[1], 10)
    const port = Number.parseInt(portText, 10)
    if (!Number.isFinite(pid) || !Number.isFinite(port)) continue

    const dedupeKey = `${pid}|${protocol}|${port}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    rows.push({
      process: decodeLsofProcess(parts[0]),
      pid,
      user: parts[2],
      protocol: 'TCP',
      address,
      port,
    })
  }

  return rows
}

export const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pnpm-workspace.yaml',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'docker-compose.yml',
  'compose.yml',
] as const

export function findProjectRoot(cwd: string, home: string = homedir()): string | null {
  if (!cwd) return null

  let current = cwd
  try {
    if (existsSync(current) && statSync(current).isFile()) {
      current = dirname(current)
    }
  } catch {
    // ignore
  }

  const start = current
  while (true) {
    for (const marker of PROJECT_MARKERS) {
      if (existsSync(join(current, marker))) return current
    }
    if (current === home && current !== start) return start
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}

const DEV_PROCESS_PREFIXES = [
  'node', 'bun', 'npm', 'pnpm', 'yarn', 'vite', 'next',
  'python', 'python3', 'flask', 'django', 'uvicorn', 'gunicorn',
  'java', 'ruby', 'rails', 'go', 'air', 'cargo',
  'docker', 'com.docke', 'nginx',
] as const

const DEV_COMMAND_TOKENS = [
  'npm', 'pnpm', 'yarn', 'vite', 'next',
  'flask', 'django', 'uvicorn', 'gunicorn',
  'rails', 'cargo', 'air',
] as const

export function isDevService(row: {
  process: string
  command: string
  has_project_marker: boolean
}): boolean {
  const processLower = row.process.toLowerCase()
  if (DEV_PROCESS_PREFIXES.some(p => processLower.startsWith(p))) return true

  const commandLower = row.command.toLowerCase()
  for (const token of DEV_COMMAND_TOKENS) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(^|[\\s/-])${escaped}($|[\\s/-])`)
    if (pattern.test(commandLower)) return true
  }

  return row.has_project_marker
}

export type PortRow = ParsedRow & {
  command: string
  cwd: string
  project_dir: string
  project_name: string
  has_project_marker: boolean
  uptime_seconds: number
  is_dev_service: boolean
}

async function getProcessCommand(pid: number): Promise<string> {
  try {
    const { stdout } = await run('ps', ['-p', String(pid), '-o', 'command='])
    return stdout.trim()
  } catch {
    return ''
  }
}

async function getProcessEtime(pid: number): Promise<number> {
  try {
    const { stdout } = await run('ps', ['-p', String(pid), '-o', 'etime='])
    return parseEtime(stdout.trim())
  } catch {
    return 0
  }
}

// ps -o etime= returns e.g. "   15:23", "2-03:45:12", "45", "1:05"
export function parseEtime(raw: string): number {
  const s = raw.trim()
  if (!s) return 0
  let days = 0
  let rest = s
  const dayIdx = rest.indexOf('-')
  if (dayIdx !== -1) {
    days = Number.parseInt(rest.slice(0, dayIdx), 10) || 0
    rest = rest.slice(dayIdx + 1)
  }
  const parts = rest.split(':').map(p => Number.parseInt(p, 10))
  if (parts.some(n => !Number.isFinite(n))) return 0
  let h = 0, m = 0, sec = 0
  if (parts.length === 3) [h, m, sec] = parts
  else if (parts.length === 2) [m, sec] = parts
  else if (parts.length === 1) [sec] = parts
  return days * 86400 + h * 3600 + m * 60 + sec
}

async function getProcessCwd(pid: number): Promise<string> {
  try {
    const { stdout } = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    for (const line of stdout.split('\n')) {
      if (line.startsWith('n')) return line.slice(1).trim()
    }
  } catch {
    // ignore
  }
  return ''
}

function hasProjectMarker(dir: string): boolean {
  if (!dir) return false
  for (const marker of PROJECT_MARKERS) {
    if (existsSync(join(dir, marker))) return true
  }
  return false
}

export async function scanPorts(): Promise<PortRow[]> {
  // +c 0 disables the default 9-character truncation of the COMMAND column,
  // so names like "com.docker.backend" come through in full. lsof escapes
  // whitespace and special characters inside COMMAND as \xHH, which decodeLsofProcess unescapes.
  const { stdout } = await run('lsof', ['+c', '0', '-nP', '-iTCP', '-sTCP:LISTEN'])
  const base = parseLsofOutput(stdout)

  const enriched: PortRow[] = []
  for (const row of base) {
    const [command, cwd, uptime_seconds] = await Promise.all([
      getProcessCommand(row.pid),
      getProcessCwd(row.pid),
      getProcessEtime(row.pid),
    ])
    const project_dir = findProjectRoot(cwd) ?? ''
    const project_name = project_dir ? basename(project_dir) : ''
    const has_project_marker = hasProjectMarker(project_dir)
    enriched.push({
      ...row,
      command,
      cwd,
      project_dir,
      project_name,
      has_project_marker,
      uptime_seconds,
      is_dev_service: isDevService({
        process: row.process,
        command,
        has_project_marker,
      }),
    })
  }

  enriched.sort((a, b) => a.port - b.port || a.process.localeCompare(b.process))
  return enriched
}
