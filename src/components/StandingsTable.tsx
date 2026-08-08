/**
 * The season table.
 *
 * Ranked on total returns, which is how FourFold has always been scored. Profit,
 * stake and ROI are shown for interest but do not affect the order.
 */
import {
  formatPenceWithSeparators,
  formatRoi,
} from '../../shared/domain/money'
import type { StandingRow } from '../../shared/domain/types'

interface Props {
  standings: StandingRow[]
}

function ProfitCell({ pence }: { pence: number }) {
  const className = pence > 0 ? 'money-up' : pence < 0 ? 'money-down' : undefined
  return <td className={className}>{formatPenceWithSeparators(pence)}</td>
}

export default function StandingsTable({ standings }: Props) {
  if (standings.length === 0) {
    return <p className="subtle">No players in this season yet.</p>
  }

  return (
    <>
      {/* Desktop: the full table. */}
      <div className="table-wrap desktop-only">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Returns</th>
              <th>Stake</th>
              <th>Profit/Loss</th>
              <th>ROI</th>
              <th>Wins</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row) => (
              <tr key={row.playerId}>
                <td>{row.position}</td>
                <td>{row.playerName}</td>
                <td className="strong">{formatPenceWithSeparators(row.totalReturnPence)}</td>
                <td className="subtle">{formatPenceWithSeparators(row.totalStakePence)}</td>
                <ProfitCell pence={row.profitPence} />
                <td className={row.roi !== null && row.roi > 0 ? 'money-up' : 'subtle'}>
                  {formatRoi(row.roi)}
                </td>
                <td>{row.winningRounds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: one card per player, keeping the returns figure prominent. */}
      <div className="mobile-cards mobile-only">
        {standings.map((row) => (
          <div className="mobile-card" key={row.playerId}>
            <div className="mobile-card-header">
              <span className="mobile-rank-number">{row.position}</span>
              <span className="mobile-card-name">{row.playerName}</span>
              <span className="mobile-card-value">
                {formatPenceWithSeparators(row.totalReturnPence)}
              </span>
            </div>
            <div className="mobile-card-content">
              <div className="mobile-card-row">
                <span className="mobile-card-row-label">Staked</span>
                <span>{formatPenceWithSeparators(row.totalStakePence)}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-row-label">Profit/Loss</span>
                <span className={row.profitPence >= 0 ? 'money-up' : 'money-down'}>
                  {formatPenceWithSeparators(row.profitPence)}
                </span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-row-label">ROI</span>
                <span>{formatRoi(row.roi)}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-row-label">Winning rounds</span>
                <span>{row.winningRounds}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
