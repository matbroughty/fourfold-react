/**
 * Admin.
 *
 * The important workflow is: open the page, the latest round is already
 * selected, pick a player, type the return, save. Everything else on this page
 * is secondary to keeping that four-key operation fast.
 */
import { useEffect, useMemo, useState } from 'react'
import { formatPenceWithSeparators } from '../../shared/domain/money'
import { playerName } from '../../shared/domain/players'
import type { SyncState } from '../../shared/domain/types'
import { ApiError, adminToken, api, type CurrentView } from '../api'

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const { token } = await api.login(password)
      adminToken.set(token)
      setPassword('')
      onSignedIn()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card card-narrow">
      <h2>Admin</h2>
      <form onSubmit={submit}>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="button button-primary" type="submit" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

function SyncPanel({ initial }: { initial: SyncState | null }) {
  const [sync, setSync] = useState<SyncState | null>(initial)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  const run = async () => {
    setBusy(true)
    setMessage(undefined)
    setError(undefined)
    try {
      const { result, sync: state } = await api.runSync()
      setSync(state)
      if (result.ok) {
        setMessage(
          `Synced. ${result.roundsCreated} new round(s), ${result.roundsUpdated} updated.` +
            (result.warnings.length > 0 ? ` ${result.warnings.length} warning(s).` : ''),
        )
      } else {
        setError(result.error ?? 'Sync failed')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sync failed')
    } finally {
      setBusy(false)
    }
  }

  const when = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString('en-GB') : 'never'

  return (
    <div className="card">
      <div className="round-header">
        <div>
          <h2>Super 6</h2>
          <div className="subtle">Rounds import automatically every 3 hours.</div>
        </div>
        <button className="button" onClick={run} disabled={busy}>
          {busy ? 'Syncing…' : 'Sync Super 6'}
        </button>
      </div>

      <div className="sync-facts">
        <div>
          <span className="summary-label">Latest known round</span>
          <span>{sync?.latestRoundId ?? 'none'}</span>
        </div>
        <div>
          <span className="summary-label">Last successful sync</span>
          <span>{when(sync?.lastSuccessAt)}</span>
        </div>
        <div>
          <span className="summary-label">Last attempt</span>
          <span>{when(sync?.lastRunAt)}</span>
        </div>
      </div>

      {message && <p className="form-success">{message}</p>}
      {(error || sync?.lastError) && (
        <p className="form-error">{error ?? sync?.lastError}</p>
      )}
    </div>
  )
}

function EnterWinnings({
  view,
  onChanged,
}: {
  view: CurrentView
  onChanged: () => void
}) {
  const [roundId, setRoundId] = useState(view.rounds[0]?.id ?? '')
  const [playerId, setPlayerId] = useState(view.season.playerIds[0] ?? '')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  // Keep the default pointing at the latest round as data reloads.
  useEffect(() => {
    if (!view.rounds.some((r) => r.id === roundId)) {
      setRoundId(view.rounds[0]?.id ?? '')
    }
  }, [view.rounds, roundId])

  const round = useMemo(
    () => view.rounds.find((r) => r.id === roundId),
    [view.rounds, roundId],
  )

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage(undefined)
    setError(undefined)
    try {
      const created = await api.createReturn({
        seasonId: view.season.id,
        roundId,
        playerId,
        amount,
      })
      setMessage(
        `Recorded ${formatPenceWithSeparators(created.return.amountPence)} for ` +
          `${playerName(playerId)}.`,
      )
      setAmount('')
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (returnId: string) => {
    setError(undefined)
    try {
      await api.deleteReturn(returnId, view.season.id)
      setMessage('Deleted.')
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete')
    }
  }

  const correct = async (returnId: string, current: number) => {
    const entered = window.prompt(
      'Corrected return in pounds (this is the amount the bookmaker paid back, not the profit):',
      (current / 100).toFixed(2),
    )
    if (entered === null) return

    setError(undefined)
    try {
      await api.updateReturn(returnId, { seasonId: view.season.id, amount: entered })
      setMessage('Corrected.')
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update')
    }
  }

  return (
    <div className="card">
      <h2>Enter a return</h2>
      <p className="subtle">
        Enter the <strong>return</strong> — the total the bookmaker paid back. If the
        stake was £5 and the payout was £18.40, enter 18.40. FourFold works out the
        £13.40 profit itself.
      </p>

      <form onSubmit={save} className="entry-form">
        <label className="field">
          <span>Round</span>
          <select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
            {view.rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.fixtures[0] ? ` — ${r.fixtures[0].homeTeam} v ${r.fixtures[0].awayTeam}…` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Player</span>
          <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            {view.season.playerIds.map((id) => (
              <option key={id} value={id}>
                {playerName(id)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Return (£)</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="18.40"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <button
          className="button button-primary"
          type="submit"
          disabled={busy || !amount || !roundId || !playerId}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>

      {message && <p className="form-success">{message}</p>}
      {error && <p className="form-error">{error}</p>}

      <h3>{round ? `Returns recorded for ${round.name}` : 'Returns'}</h3>
      {!round || round.returnRecords.length === 0 ? (
        <p className="subtle">Nothing recorded for this round.</p>
      ) : (
        <ul className="admin-returns">
          {round.returnRecords.map((record) => (
            <li key={record.id}>
              <span>{playerName(record.playerId)}</span>
              <span className="strong">{formatPenceWithSeparators(record.amountPence)}</span>
              <span className="admin-actions">
                <button
                  className="button button-small"
                  onClick={() => correct(record.id, record.amountPence)}
                >
                  Correct
                </button>
                <button
                  className="button button-small button-danger"
                  onClick={() => remove(record.id)}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Admin() {
  const [signedIn, setSignedIn] = useState(Boolean(adminToken.get()))
  const [view, setView] = useState<CurrentView>()
  const [sync, setSync] = useState<SyncState | null>(null)
  const [error, setError] = useState<string>()

  const load = async () => {
    try {
      const current = await api.getCurrent()
      setView(current)
      const state = await api.getSyncState()
      setSync(state.sync)
      setError(undefined)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setSignedIn(false)
        return
      }
      setError(caught instanceof Error ? caught.message : 'Could not load')
    }
  }

  useEffect(() => {
    if (signedIn) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  if (!signedIn) {
    return <SignIn onSignedIn={() => setSignedIn(true)} />
  }

  return (
    <>
      <div className="section-heading">
        <h2>Admin</h2>
        <button
          className="button"
          onClick={() => {
            adminToken.clear()
            setSignedIn(false)
          }}
        >
          Sign out
        </button>
      </div>

      {error && <div className="card card-error">{error}</div>}

      <SyncPanel initial={sync} />

      {view?.season ? (
        <EnterWinnings view={view} onChanged={load} />
      ) : (
        <div className="card">
          <p className="subtle">
            No season imported yet. Press “Sync Super 6” to pull in the current round.
          </p>
        </div>
      )}
    </>
  )
}
