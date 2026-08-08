/**
 * Home: the current season's table and the latest round.
 */
import { Link } from 'react-router-dom'
import { formatPenceWithSeparators } from '../../shared/domain/money'
import { currentRoundBadge, currentRoundHeading } from '../../shared/domain/rounds'
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

  // The round the competition is on, which is usually NOT the highest-numbered:
  // Super 6 announces the next few rounds weeks ahead.
  const current = data.rounds.find((r) => r.id === data.currentRoundId) ?? data.rounds[0]
  const kind = data.currentRoundKind
  // Ascending: upcoming rounds read naturally in the order they will be played,
  // unlike the main list which is newest-first.
  const upcoming = data.rounds
    .filter((r) => r.id !== current?.id && r.status === 'future')
    .sort((a, b) => a.roundNumber - b.roundNumber)

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

      {current ? (
        <>
          <div className="section-heading">
            <h2>{kind ? currentRoundHeading(kind) : 'Latest round'}</h2>
            {data.rounds.length > 1 && <Link to="/rounds">All {data.season.name} rounds →</Link>}
          </div>
          <RoundCard round={current} badge={kind ? currentRoundBadge(kind) : null} />

          {upcoming.length > 0 && (
            <div className="card">
              <h3 className="upcoming-heading">Also announced</h3>
              <ul className="upcoming-list">
                {upcoming.map((round) => (
                  <li key={round.id}>
                    <span>{round.name}</span>
                    <span className="subtle">
                      {round.fixtures[0]?.kickOffAt
                        ? new Date(round.fixtures[0].kickOffAt).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'long',
                          })
                        : 'date to be confirmed'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className="card">
          <p className="subtle">No rounds imported for this season yet.</p>
        </div>
      )}
    </>
  )
}
