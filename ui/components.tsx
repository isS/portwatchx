import { useEffect, useState, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useTheme } from 'next-themes'
import { Check, ExternalLink, FolderOpen, Moon, Settings, Sun, Terminal } from 'lucide-react'
import type { ColumnKey, PortRow, SortDir, SortKey } from './lib.ts'
import { copyToClipboard, formatUptime } from './lib.ts'

export function MetricsStrip({
  total, dev, projects, refreshedAt, loaded, onRefresh,
  hiddenCols, toggleColumn,
}: {
  total: number; dev: number; projects: number
  refreshedAt: string; loaded: boolean; onRefresh: () => void
  hiddenCols: Set<ColumnKey>; toggleColumn: (k: ColumnKey) => void
}) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">portwatchx</h1>
      <div className="flex items-center gap-4 text-sm text-neutral-500">
        <span><span className="font-mono tabular-nums">{loaded ? total : '—'}</span> listening</span>
        <span><span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{loaded ? dev : '—'}</span> dev</span>
        <span><span className="font-mono tabular-nums">{loaded ? projects : '—'}</span> projects</span>
        <span className="tabular-nums">Updated {refreshedAt ? refreshedAt.slice(11) : '—'}</span>
        <ThemeToggle />
        <SettingsMenu hiddenCols={hiddenCols} toggleColumn={toggleColumn} />
        <button
          onClick={onRefresh}
          className="px-3 py-1 rounded-md border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-700 dark:text-neutral-300"
        >
          Refresh
        </button>
      </div>
    </div>
  )
}

function Tip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={5}
          className="z-50 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs px-2 py-1 shadow-lg select-none"
        >
          {content}
          <Tooltip.Arrow className="fill-neutral-900 dark:fill-neutral-100" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // While hydrating, render a stable placeholder to avoid icon flash
  if (!mounted) {
    return <div className="w-7 h-7 rounded-md border border-neutral-200 dark:border-neutral-800" aria-hidden />
  }

  const isDark = resolvedTheme === 'dark'
  return (
    <Tip content={isDark ? 'Switch to light' : 'Switch to dark'}>
      <button
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        aria-label="Toggle theme"
        className="w-7 h-7 flex items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900 hover:text-neutral-700 dark:hover:text-neutral-300"
      >
        {isDark ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
      </button>
    </Tip>
  )
}

function SettingsMenu({
  hiddenCols, toggleColumn,
}: {
  hiddenCols: Set<ColumnKey>; toggleColumn: (k: ColumnKey) => void
}) {
  const cols: { key: ColumnKey; label: string }[] = [
    { key: 'address', label: 'Address' },
    { key: 'process', label: 'Process' },
    { key: 'pid', label: 'PID' },
    { key: 'project', label: 'Project' },
    { key: 'uptime', label: 'Uptime' },
    { key: 'command', label: 'Command' },
  ]
  return (
    <Popover.Root>
      <Tip content="Settings">
        <Popover.Trigger asChild>
          <button
            aria-label="Settings"
            className="w-7 h-7 flex items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900 hover:text-neutral-700 dark:hover:text-neutral-300"
          >
            <Settings size={14} strokeWidth={2} />
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="w-52 rounded-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-lg p-3 text-sm text-neutral-700 dark:text-neutral-300"
        >
          <div className="text-xs uppercase tracking-wider text-neutral-400 mb-2">Columns</div>
          <div className="flex flex-col gap-1.5">
            {cols.map(({ key, label }) => {
              const visible = !hiddenCols.has(key)
              return (
                <label key={key} className="flex items-center gap-2 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 px-1.5 py-0.5 rounded -mx-1.5">
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() => toggleColumn(key)}
                    className="accent-emerald-500"
                  />
                  <span>{label}</span>
                </label>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function Toolbar({
  query, setQuery, filter, setFilter,
}: {
  query: string; setQuery: (v: string) => void
  filter: 'dev' | 'all'; setFilter: (v: 'dev' | 'all') => void
}) {
  return (
    <div className="mt-6 flex items-center gap-4">
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search port, process, project, command"
        className="flex-1 h-9 px-3 rounded-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 outline-none focus:border-emerald-500 text-sm"
      />
      <div className="flex rounded-md border border-neutral-200 dark:border-neutral-800 text-sm overflow-hidden">
        <button
          onClick={() => setFilter('dev')}
          className={`px-3 h-9 ${filter === 'dev' ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900' : 'text-neutral-500'}`}
        >
          Dev
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`px-3 h-9 ${filter === 'all' ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900' : 'text-neutral-500'}`}
        >
          All
        </button>
      </div>
    </div>
  )
}

export function PortsTable({
  rows, sortKey, sortDir, onSort, hiddenCols, selfPid,
}: {
  rows: PortRow[]
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  hiddenCols: Set<ColumnKey>
  selfPid: number
}) {
  const [copied, setCopied] = useState<string>('')
  async function copy(key: string, text: string) {
    await copyToClipboard(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 900)
  }
  if (rows.length === 0) {
    return <div className="mt-8 text-sm text-neutral-500 text-center py-10">No matching ports.</div>
  }
  const show = (k: ColumnKey) => !hiddenCols.has(k)
  return (
    <table className="mt-6 w-full text-sm">
      <thead className="text-neutral-500 uppercase text-xs tracking-wider">
        <tr>
          <SortableHeader label="Port" k="port" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          {show('address') && <th className="text-left font-medium py-2 px-3">Address</th>}
          {show('process') && <SortableHeader label="Process" k="process" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />}
          {show('pid') && <SortableHeader label="PID" k="pid" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />}
          {show('project') && <SortableHeader label="Project" k="project" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />}
          {show('uptime') && <SortableHeader label="Uptime" k="uptime" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />}
          {show('command') && <th className="text-left font-medium py-2 px-3">Command</th>}
          <th className="text-right font-medium py-2 px-3"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const pathKey = `path:${r.pid}:${r.port}`
          const killKey = `kill:${r.pid}:${r.port}`
          const isSelf = selfPid > 0 && r.pid === selfPid
          return (
            <tr key={`${r.pid}:${r.port}`} className="border-t border-neutral-100 dark:border-neutral-900 hover:bg-neutral-100/50 dark:hover:bg-neutral-900/40">
              <td className="py-2.5 px-3 font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-50">
                <span className="inline-flex items-center gap-2">
                  <a
                    href={`http://localhost:${r.port}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open http://localhost:${r.port} in browser`}
                    className="inline-flex items-center gap-1.5 group hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                  >
                    {r.port}
                    <ExternalLink
                      size={11}
                      strokeWidth={2.25}
                      className="opacity-0 group-hover:opacity-80 transition-opacity"
                    />
                  </a>
                  {isSelf && (
                    <Tip content="This is portwatchx itself">
                      <span className="text-[10px] font-sans font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 cursor-default">
                        self
                      </span>
                    </Tip>
                  )}
                </span>
              </td>
              {show('address') && <td className="py-2.5 px-3 font-mono text-neutral-400 dark:text-neutral-500 text-xs">{r.address}</td>}
              {show('process') && (
                <td className={`py-2.5 px-3 font-medium ${r.is_dev_service ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-700 dark:text-neutral-300'}`}>{r.process}</td>
              )}
              {show('pid') && <td className="py-2.5 px-3 font-mono tabular-nums text-neutral-400 dark:text-neutral-500 text-xs">{r.pid}</td>}
              {show('project') && (
                <td className="py-2.5 px-3" title={r.project_dir}>
                  {r.project_name
                    ? <span className="inline-block px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-xs font-medium">{r.project_name}</span>
                    : <span className="text-neutral-300 dark:text-neutral-600">—</span>}
                </td>
              )}
              {show('uptime') && (
                <td className="py-2.5 px-3 font-mono tabular-nums text-neutral-500 dark:text-neutral-400 text-xs">{formatUptime(r.uptime_seconds)}</td>
              )}
              {show('command') && (
                <td className="py-2.5 px-3 font-mono text-xs text-neutral-500 dark:text-neutral-400 truncate max-w-xs" title={r.command}>{r.command}</td>
              )}
              <td className="py-2.5 px-3 text-right whitespace-nowrap">
                {r.project_dir && (
                  <Tip content={copied === pathKey ? 'Copied' : `Copy ${r.project_dir}`}>
                    <button
                      onClick={() => copy(pathKey, r.project_dir)}
                      aria-label="Copy project path"
                      className="p-1.5 mr-0.5 rounded text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
                    >
                      {copied === pathKey
                        ? <Check size={14} strokeWidth={2.25} className="text-emerald-500" />
                        : <FolderOpen size={14} strokeWidth={2} />}
                    </button>
                  </Tip>
                )}
                <Tip content={copied === killKey ? 'Copied' : `Copy "kill ${r.pid}"`}>
                  <button
                    onClick={() => copy(killKey, `kill ${r.pid}`)}
                    aria-label="Copy kill command"
                    className="p-1.5 rounded text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
                  >
                    {copied === killKey
                      ? <Check size={14} strokeWidth={2.25} className="text-emerald-500" />
                      : <Terminal size={14} strokeWidth={2} />}
                  </button>
                </Tip>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function SortableHeader({
  label, k, sortKey, sortDir, onSort,
}: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void
}) {
  const active = sortKey === k
  const arrow = !active ? '' : sortDir === 'asc' ? '▲' : '▼'
  return (
    <th className="text-left font-medium py-2 px-3">
      <button
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 uppercase text-xs tracking-wider ${active ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
      >
        {label}
        <span className="text-[9px]">{arrow || '·'}</span>
      </button>
    </th>
  )
}
