import React, { useMemo, useState, useEffect } from 'react'
import Papa from 'papaparse'
import DataTable from './components_DataTable.jsx'
import MobileDataTable from './components_MobileDataTable.jsx'
import LineChart from './components_LineChart.jsx'
import CsvEditor from './components_CsvEditor.jsx'
import CsvLoader from './components_CsvLoader.jsx'
import MultiUserLineChart from './components_MultiUserLineChart.jsx'
import UserWinningsBarChart from './components_UserWinningsBarChart.jsx'
import Dashboard from './components_Dashboard.jsx'
import { useMediaQuery } from './hooks/useMediaQuery.js'

const DEFAULT_REMOTE_URL = import.meta.env.VITE_CSV_URL || ''

function toNumber(val) {
  if (val === null || val === undefined) return null
  if (typeof val === 'number') return val
  const s = String(val).trim()
  if (!s) return null
  const cleaned = s.replace(/[^0-9\-\.]/g, '')
  const n = parseFloat(cleaned)
  return Number.isNaN(n) ? null : n
}

function computeTotals(rows) {
  if (!rows.length) return {}
  const totals = {}
  const keys = Object.keys(rows[0]).filter(k => k !== '__label' && k !== 'Gameweek')
  for (const k of keys) totals[k] = 0
  for (const r of rows) {
    for (const k of keys) {
      const v = toNumber(r[k])
      totals[k] += v || 0
    }
  }
  return totals
}

function parseCsvFile(file, onDone, onError) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    complete: (results) => {
      const data = results.data.map((row, i) => {
        const newRow = { ...row }
        // Always set the __label to ensure consistent labeling
        newRow['__label'] = `GW ${i + 1}`
        return newRow
      })
      onDone(data)
    },
    error: onError,
  })
}

function parseCsvUrl(url, onDone, onError, { cacheBust=false } = {}) {
  if (!url) { onError?.(new Error('No URL provided')); return; }
  const finalUrl = cacheBust ? `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}` : url
  Papa.parse(finalUrl, {
    header: true,
    skipEmptyLines: true,
    download: true,
    dynamicTyping: false,
    complete: (results) => {
      const data = results.data.map((row, i) => {
        const newRow = { ...row }
        // Always set the __label to ensure consistent labeling
        newRow['__label'] = `GW ${i + 1}`
        return newRow
      })
      onDone(data)
    },
    error: (e) => onError?.(e || new Error('Failed to parse remote CSV'))
  })
}

export default function App() {
  const [rawRows, setRawRows] = useState([])
  const [error, setError] = useState('')
  const [sortBy, setSortBy] = useState('total')
  const [sortDir, setSortDir] = useState('desc')
  const [fileName, setFileName] = useState('')
  const [remoteUrl, setRemoteUrl] = useState(DEFAULT_REMOTE_URL)
  const [isLoading, setIsLoading] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [showLoader, setShowLoader] = useState(false)
  const [showDashboard, setShowDashboard] = useState(false)
  const isMobile = useMediaQuery('(max-width: 639px)')

  const handleFile = (file) => {
    if (!file) return
    setFileName(file.name)
    setError('')
    parseCsvFile(file, setRawRows, (e) => setError(e?.message || 'Failed to parse CSV'))
  }

  useEffect(() => {
    if (remoteUrl) {
      setIsLoading(true)
      parseCsvUrl(
        remoteUrl,
        (rows) => { setRawRows(rows); setIsLoading(false); setError('') },
        (e) => { setIsLoading(false); setError(e?.message || 'Failed to load remote CSV') },
        { cacheBust: false }
      )
    }
  }, [remoteUrl])

  const people = useMemo(() => {
    if (!rawRows.length) return []
    const sample = rawRows[0]
    return Object.keys(sample).filter(k => k !== '__label' && k !== 'Gameweek')
  }, [rawRows])

  const totals = useMemo(() => {
    if (!rawRows.length) return []
    const t = computeTotals(rawRows)
    return people.map(name => ({
      name,
      total: t[name] ?? 0,
    }))
  }, [rawRows, people])

  const sortedTotals = useMemo(() => {
    const arr = [...totals]
    arr.sort((a, b) => {
      const av = a[sortBy] ?? 0
      const bv = b[sortBy] ?? 0
      if (av === bv) return 0
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
    })
    return arr
  }, [totals, sortBy, sortDir])

  const columnsTotals = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'total', label: 'Total', sortable: true, isMoney: true },
  ]

  const [rawSortBy, setRawSortBy] = useState('__label')
  const [rawSortDir, setRawSortDir] = useState('asc')

  const rawColumns = useMemo(() => {
    const cols = [{ key: '__label', label: 'Gameweek', sortable: true }]
    for (const p of people) cols.push({ key: p, label: p, sortable: true, isMoney: true })
    return cols
  }, [people])

  const rawRowsNormalized = useMemo(() => {
    return rawRows.map((r) => ({
      // Use the __label that was set during parsing
      __label: r.__label,
      ...r,
    }))
  }, [rawRows])

  const sortedRaw = useMemo(() => {
    const arr = [...rawRowsNormalized]
    arr.sort((a, b) => {
      let av, bv;
      if (rawSortBy === '__label') {
        // Extract the numeric part from "GW X" format
        av = parseInt(a[rawSortBy].replace('GW ', '')) || 0
        bv = parseInt(b[rawSortBy].replace('GW ', '')) || 0
      } else {
        av = toNumber(a[rawSortBy]) ?? 0
        bv = toNumber(b[rawSortBy]) ?? 0
      }
      if (av === bv) return 0
      return rawSortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
    })
    return arr
  }, [rawRowsNormalized, rawSortBy, rawSortDir])

  const handleSaveEdits = (updatedRows) => {
    setRawRows(updatedRows);
    setShowEditor(false);
  };

  const handleCancelEdit = () => {
    setShowEditor(false);
  };

  const handleCancelLoad = () => {
    setShowLoader(false);
  };

  const handleDashboardToggle = () => {
    setShowDashboard(prev => !prev);
  };

  if (showEditor) {
    return (
      <div className="container">
        <CsvEditor 
          rawRows={rawRows} 
          onSave={handleSaveEdits} 
          onCancel={handleCancelEdit} 
        />
      </div>
    );
  }

  if (showLoader) {
    return (
      <div className="container">
        <CsvLoader 
          onFileSelect={(file) => {
            handleFile(file);
            setShowLoader(false);
          }} 
          onCancel={handleCancelLoad} 
        />
      </div>
    );
  }

  if (showDashboard) {
    return (
      <Dashboard 
        rawRowsNormalized={rawRowsNormalized} 
        people={people} 
        onBack={handleDashboardToggle} 
      />
    );
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>FourFold Winnings</h1>
        </div>
        <div className="controls">
          {remoteUrl && (
            <button
              className="button"
              onClick={() => {
                setIsLoading(true)
                parseCsvUrl(
                  remoteUrl,
                  (rows) => { setRawRows(rows); setIsLoading(false); setError('') },
                  (e) => { setIsLoading(false); setError(e?.message || 'Failed to refresh CSV') },
                  { cacheBust: true }
                )
              }}
              title="Re-fetch CSV from server"
            >
              🔄 Refresh
            </button>
          )}
          <button
            className="button"
            onClick={() => setShowLoader(true)}
            title="Load CSV file"
          >
            📤 Load CSV
          </button>
          <button
            className="button"
            onClick={() => setShowEditor(true)}
            title="Edit CSV data"
          >
            ✏️ Edit CSV
          </button>
          <button
            className="button"
            onClick={handleDashboardToggle}
            title="View charts and visualizations"
          >
            📊 Dashboard
          </button>
          {remoteUrl && <span className="badge">Remote: {remoteUrl}</span>}
          {isLoading && <span className="badge">Loading…</span>}
          {fileName && <span className="badge">Loaded: {fileName}</span>}
        </div>
      </div>

      {error && (
        <div className="card" style={{borderColor:'#ff6b6b'}}>
          <strong>Parse error:</strong> {error}
        </div>
      )}

      <div className="grid">
        <div className="card">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
            <div>
              <h2 style={{margin:'0 0 4px'}}>Totals</h2>
              <div className="subtle">Click a column to sort</div>
            </div>
          </div>

          {isMobile ? (
            <MobileDataTable
              rows={sortedTotals}
              columns={columnsTotals}
              mode="totals"
            />
          ) : (
            <DataTable
              rows={sortedTotals}
              columns={columnsTotals}
              sortBy={sortBy}
              sortDir={sortDir}
              onSortChange={(col, dir) => { setSortBy(col); setSortDir(dir); }}
            />
          )}
        </div>

        {rawRows.length > 0 && (
          <div className="card">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
              <div>
                <h2 style={{margin:'0 0 4px'}}>Gameweeks (raw)</h2>
                <div className="subtle">As uploaded / fetched</div>
              </div>
            </div>
            {isMobile ? (
              <MobileDataTable
                rows={sortedRaw}
                columns={rawColumns}
                mode="gameweeks"
                people={people}
              />
            ) : (
              <DataTable
                rows={sortedRaw}
                columns={rawColumns}
                sortBy={setRawSortBy ? rawSortBy : '__label'}
                sortDir={rawSortDir}
                onSortChange={(col, dir) => { setRawSortBy(col); setRawSortDir(dir); }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
