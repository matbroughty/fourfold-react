import React, { useState } from 'react';

function formatMoney(n) {
  if (n === null || Number.isNaN(n)) return '';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n);
}

function toNumber(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (!s) return null;
  const cleaned = s.replace(/[^0-9\-\.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? null : n;
}

// Check if a gameweek row has any non-zero values
function checkGameWeekValues(row) {
  if (!row.__label || !row.__label.startsWith('GW ')) return null;
  const hasNonZeroValue = Object.entries(row).some(([key, value]) => {
    if (key === '__label' || key === 'Gameweek') return false;
    const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
    return numValue > 0;
  });
  return hasNonZeroValue ? '⚽' : '🤷';
}

// Totals mode: Card-based display for player totals
function TotalsView({ rows }) {
  return (
    <div className="mobile-cards">
      {rows.map((row, idx) => (
        <div key={idx} className="mobile-card">
          <div className="mobile-card-header">
            <span className="mobile-card-rank">
              {idx === 0 && <span title="Leader">👑</span>}
              {idx === rows.length - 1 && rows.length > 1 && <span title="Last place">🎭</span>}
              {idx > 0 && idx < rows.length - 1 && <span className="mobile-rank-number">#{idx + 1}</span>}
            </span>
            <span className="mobile-card-name">{row.name}</span>
          </div>
          <div className="mobile-card-value">
            {formatMoney(row.total)}
          </div>
        </div>
      ))}
    </div>
  );
}

// Gameweeks mode: Expandable cards per gameweek
function GameweeksView({ rows, people }) {
  const [expandedIdx, setExpandedIdx] = useState(null);

  const toggleExpand = (idx) => {
    setExpandedIdx(expandedIdx === idx ? null : idx);
  };

  return (
    <div className="mobile-cards">
      {rows.map((row, idx) => {
        const isExpanded = expandedIdx === idx;
        const gameweekEmoji = checkGameWeekValues(row);

        return (
          <div key={idx} className={`mobile-card mobile-card-expandable ${isExpanded ? 'expanded' : ''}`}>
            <div
              className="mobile-card-header mobile-card-toggle"
              onClick={() => toggleExpand(idx)}
            >
              <span className="mobile-card-name">
                {gameweekEmoji && <span title={gameweekEmoji === '⚽' ? 'At least one competitor scored' : 'All competitors scored 0'}>{gameweekEmoji} </span>}
                {row.__label}
              </span>
              <span className="mobile-card-chevron">
                {isExpanded ? '▼' : '▶'}
              </span>
            </div>
            {isExpanded && (
              <div className="mobile-card-content">
                {people.map((person) => (
                  <div key={person} className="mobile-card-row">
                    <span className="mobile-card-row-label">{person}</span>
                    <span className="mobile-card-row-value">
                      {formatMoney(toNumber(row[person]))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MobileDataTable({ rows, columns, mode = 'totals', people = [] }) {
  if (mode === 'totals') {
    return <TotalsView rows={rows} />;
  }

  if (mode === 'gameweeks') {
    return <GameweeksView rows={rows} people={people} />;
  }

  return null;
}