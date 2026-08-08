/**
 * Home: the current season's table and the latest round.
 */
import { Link } from 'react-router-dom'
import { formatPenceWithSeparators } from '../../shared/domain/money'
import RoundCard from '../components/RoundCard'
import StandingsTable from '../components/StandingsTable'
import { useApi } from '../useApi'
import { api } from '../api'

function SummaryStrip({
  playedRounds,
  announcedRounds,
  totalReturnPence,
  profitPence,
  winningEntries,
}: {
  playedRounds: number
  announcedRounds: number
  totalReturnPence: number
  profitPence: number
  winningEntries: number
}) {
  const upcoming = announcedRounds - playedRounds

  return (
    <div className="summary-strip">
      <div>
        <div className="summary-label">Total returns</div>
        <div className="summary-value">{formatPenceWithSeparators(totalReturnPence)}</div>
      </div>
      <div>
        <div className="summary-label">Rounds played</div>
        <div className="summary-value">{playedRounds}</div>
        {upcoming > 0 && (
          <div className="subtle">
            {upcoming} still to come
          </div>
        )}
      </div>
      <div>
        <div className="summary-label">Winning entries</div>
        <div className="summary-value">{winningEntries}</div>
      </div>
      <div>
        <div className="summary-label">Group profit/loss</div>
        <div className={`summary-value ${profitPence >= 0 ? 'money-up' : 'money-down'}`}>
          {formatPenceWithSeparators(profitPence)}
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const { data, error, loading } = useApi(api.getCurrent, [])

  if (loading) return <p className="subtle">Loading…</p>
  if (error) {
    return (
      <div className="card card-error">
        <strong>Could not load the standings.</strong>
        <p className="subtle">{error.message}</p>
      </div>
    )
  }
  if (!data?.season) {
    return (
      <div className="card">
        <h2>No season yet</h2>
        <p className="subtle">
          Nothing has been imported. Run a sync from the{' '}
          <Link to="/admin">admin page</Link> to pull in the current Super 6 round.
        </p>
      </div>
    )
  }

  const latest = data.rounds[0]

  return (
    <>
      <div className="card">
        <div className="round-header">
          <div>
            <h2>{data.season.name} table</h2>
            <div className="subtle">
              Ranked on total returns · £5 staked per player per round
            </div>
          </div>
        </div>
        <SummaryStrip
          playedRounds={data.summary.playedRoundCount}
          announcedRounds={data.summary.roundCount}
          totalReturnPence={data.summary.totalReturnPence}
          profitPence={data.summary.profitPence}
          winningEntries={data.summary.winningEntries}
        />
        <StandingsTable standings={data.standings} />
      </div>

      {latest ? (
        <>
          <div className="section-heading">
            <h2>Latest round</h2>
            {data.rounds.length > 1 && <Link to="/rounds">All {data.season.name} rounds →</Link>}
          </div>
          <RoundCard round={latest} />
        </>
      ) : (
        <div className="card">
          <p className="subtle">No rounds imported for this season yet.</p>
        </div>
      )}
    </>
  )
}
