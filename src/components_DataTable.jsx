import React from 'react'

function formatMoney(n) {
  if (n === null || Number.isNaN(n)) return ''
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n)
}

export default function DataTable({ rows, columns, sortBy, sortDir, onSortChange, totalsLabel='Total' }) {
  const handleSort = (col) => {
    if (!onSortChange) return
    if (sortBy === col) {
      onSortChange(col, sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      onSortChange(col, 'desc')
    }
  }

  // Function to check if a row is a Game Week row and if all values are 0
  const checkGameWeekValues = (row) => {
    // Check if the row is a Game Week row
    if (!row.__label || !row.__label.startsWith('GW ')) return null;

    // Check if all values (except the label) are 0
    const hasNonZeroValue = Object.entries(row).some(([key, value]) => {
      // Skip the label and any non-numeric values
      if (key === '__label' || key === 'Gameweek') return false;
      const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
      return numValue > 0;
    });

    return hasNonZeroValue ? '⚽' : '🤷';
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={c.key}
                className={c.sortable ? 'sortable' : ''}
                onClick={() => c.sortable && handleSort(c.key)}
                style={{position: 'sticky', top: 0}}
              >
                <div style={{display:'flex', alignItems:'baseline', gap:8, justifyContent: i===0?'flex-start':'flex-end'}}>
                  <span>{c.label}</span>
                  {c.sortable && (
                    <span className="hint">
                      {sortBy === c.key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx}>
              {columns.map((c, i) => (
                <td key={c.key} style={{textAlign: i===0?'left':'right'}}>
                  {i === 0 && idx === 0 && <span title="Leader">👑 </span>}
                  {i === 0 && idx === rows.length - 1 && <span title="Last place">🎭 </span>}
                  {i === 0 && r.__label && r.__label.startsWith('GW ') && (
                    <span title={checkGameWeekValues(r) === '⚽' ? 'At least one competitor scored' : 'All competitors scored 0'}>
                      {checkGameWeekValues(r)} 
                    </span>
                  )}
                  {c.isMoney ? formatMoney(r[c.key]) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
