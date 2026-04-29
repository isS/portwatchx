import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  compareRows,
  fetchPorts,
  getHiddenColumns,
  saveHiddenColumns,
} from './lib.ts'
import type { ColumnKey, PortRow, SortDir, SortKey } from './lib.ts'
import { MetricsStrip, Toolbar, PortsTable } from './components.tsx'

export function App() {
  const [rows, setRows] = useState<PortRow[]>([])
  const [total, setTotal] = useState(0)
  const [dev, setDev] = useState(0)
  const [projects, setProjects] = useState(0)
  const [refreshedAt, setRefreshedAt] = useState('')
  const [selfPid, setSelfPid] = useState(0)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'dev' | 'all'>('dev')
  const [sortKey, setSortKey] = useState<SortKey>('port')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [hiddenCols, setHiddenCols] = useState<Set<ColumnKey>>(getHiddenColumns)

  const toggleColumn = useCallback((key: ColumnKey) => {
    setHiddenCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveHiddenColumns(next)
      return next
    })
  }, [])

  const refresh = useCallback(async () => {
    try {
      const data = await fetchPorts()
      setRows(data.ports)
      setTotal(data.total)
      setDev(data.dev_services)
      setProjects(data.identified_projects)
      setRefreshedAt(data.refreshed_at)
      setSelfPid(data.self_pid)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    document.title = loaded && dev > 0 ? `(${dev}) portwatchx` : 'portwatchx'
  }, [loaded, dev])

  useEffect(() => {
    refresh()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        ;(document.querySelector('input[type=search]') as HTMLInputElement | null)?.focus()
      }
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey) refresh()
      if (e.key === 'd') setFilter('dev')
      if (e.key === 'a') setFilter('all')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh])

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDir('asc')
      return key
    })
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = rows.filter(r => {
      if (filter === 'dev' && !r.is_dev_service) return false
      if (!q) return true
      return (
        String(r.port).includes(q) ||
        r.process.toLowerCase().includes(q) ||
        r.project_dir.toLowerCase().includes(q) ||
        r.command.toLowerCase().includes(q)
      )
    })
    return [...filtered].sort((a, b) => compareRows(a, b, sortKey, sortDir))
  }, [rows, query, filter, sortKey, sortDir])

  return (
    <main className="max-w-6xl mx-auto px-8 py-10">
      <MetricsStrip
        total={total}
        dev={dev}
        projects={projects}
        refreshedAt={refreshedAt}
        loaded={loaded}
        onRefresh={refresh}
        hiddenCols={hiddenCols}
        toggleColumn={toggleColumn}
      />
      <Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} />
      <div className="min-h-[320px]">
        {error ? (
          <div className="mt-8 text-sm text-red-500">error: {error}</div>
        ) : !loaded ? (
          <div className="mt-8 text-sm text-neutral-400 text-center py-10">Loading…</div>
        ) : (
          <PortsTable
            rows={visible}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            hiddenCols={hiddenCols}
            selfPid={selfPid}
          />
        )}
      </div>
    </main>
  )
}
