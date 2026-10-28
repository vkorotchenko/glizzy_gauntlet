import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { loadSession } from '../auth/api'
import { getCompetition } from '../competitions/api'
import { formatTime } from '../competitions/time'
import { listEntries } from '../meals/api'
import { formatInches, toHundredths, wholeQuantity } from '../meals/measurement'
import { ResultsTable } from '../progress/ProgressPages'
import * as api from './api'

function ErrorNotice({ error }: { error: Error | null }) {
  return error ? (
    <p role="alert" className="form-error">
      {error.message}
    </p>
  ) : null
}
function Pager({
  page,
  hasMore,
  change,
  label,
}: {
  page: number
  hasMore: boolean
  change: (page: number) => void
  label: string
}) {
  return (
    <div className="page-controls">
      <button
        type="button"
        className="text-button"
        disabled={!page}
        onClick={() => change(page - 1)}
      >
        Previous {label} page
      </button>
      <span>Page {page + 1}</span>
      <button
        type="button"
        className="text-button"
        disabled={!hasMore || page >= 1000}
        onClick={() => change(page + 1)}
      >
        Next {label} page
      </button>
    </div>
  )
}
function CorrectionAudit({ id, zone }: { id: string; zone: string }) {
  const [page, setPage] = useState(0)
  const audit = useQuery({
    queryKey: ['recaps', 'audit', id, page],
    queryFn: ({ signal }) => api.audit(id, page, signal),
    retry: false,
  })
  return (
    <section className="competition-section">
      <h2>Correction audit (all revisions)</h2>
      <ErrorNotice error={audit.error} />
      {audit.isPending && <p role="status">Loading correction audit...</p>}
      {audit.isError && (
        <button
          type="button"
          className="text-button"
          onClick={() => void audit.refetch()}
        >
          Retry audit
        </button>
      )}
      {audit.data && !audit.isError && (
        <>
          {!audit.data.items.length && <p>No organizer score corrections.</p>}
          <ul className="member-list">
            {audit.data.items.map((change, index) => (
              <li key={index}>
                <strong>Recap revision {change.resultVersion}</strong> /{' '}
                {change.actorDisplayName} / {formatTime(change.createdAt, zone)}
                <p>
                  {formatInches(change.beforeTotalHundredths)} inches /{' '}
                  {change.beforeWholeHotDogs} whole /{' '}
                  {change.beforeExcluded ? 'excluded' : 'counted'}
                  {' -> '}
                  {formatInches(change.afterTotalHundredths)} inches /{' '}
                  {change.afterWholeHotDogs} whole /{' '}
                  {change.afterExcluded ? 'excluded' : 'counted'}
                </p>
                <p className="competition-rules">{change.reason}</p>
              </li>
            ))}
          </ul>
          <Pager
            page={page}
            hasMore={audit.data.hasMore}
            change={setPage}
            label="audit"
          />
        </>
      )}
    </section>
  )
}
function MemberHighlights({ id, version }: { id: string; version: number }) {
  const query = useQuery({
    queryKey: ['recaps', 'highlights', id, version],
    queryFn: ({ signal }) => api.highlights(id, version, signal),
    retry: false,
  })
  const view = query.data
  return (
    <section className="competition-section">
      <h2>Member-only recap highlights</h2>
      <ErrorNotice error={query.error} />
      {query.isPending && <p role="status">Loading member highlights...</p>}
      {query.isError && (
        <button
          type="button"
          className="text-button"
          onClick={() => void query.refetch()}
        >
          Retry highlights
        </button>
      )}
      {view && !query.isError && (
        <>
          <p>
            These details belong to recap revision {view.resultVersion}, not
            newer source meals. Scoring-excluded entries do not contribute.
          </p>
          <dl className="competition-facts">
            <dt>Counted meals</dt>
            <dd>{view.mealCount}</dd>
            <dt>Distinct venues</dt>
            <dd>{view.venueCount}</dd>
            <dt>Private labels</dt>
            <dd>{view.privateLocationCount}</dd>
            <dt>Largest submitted score</dt>
            <dd>{formatInches(view.largestMealHundredths)} inches</dd>
            <dt>Highest-total day</dt>
            <dd>
              {view.busiestDay
                ? `${view.busiestDay} / ${formatInches(view.busiestDayHundredths)} inches (${view.timeZone})`
                : 'No counted meals'}
            </dd>
          </dl>
          <h3>Most visited places</h3>
          <ul className="member-list">
            {view.places.map((place, index) => (
              <li key={index}>
                <strong>{place.location}</strong> /{' '}
                {place.directoryVenue ? 'Directory venue' : 'Private label'} /{' '}
                {place.mealCount} meals / {formatInches(place.totalHundredths)}{' '}
                inches
              </li>
            ))}
          </ul>
          <Link to={`/competitions/${id}/progress`}>
            My progress (latest revision)
          </Link>
        </>
      )}
    </section>
  )
}
function ResultHistory({
  id,
  zone,
  choose,
}: {
  id: string
  zone: string
  choose: (version?: number) => void
}) {
  const [page, setPage] = useState(0)
  const history = useQuery({
    queryKey: ['recaps', 'history', id, page],
    queryFn: ({ signal }) => api.history(id, page, signal),
    retry: false,
  })
  return (
    <section className="competition-section">
      <h2>Published recap revisions</h2>
      <ErrorNotice error={history.error} />
      {history.isError && (
        <button
          type="button"
          className="text-button"
          onClick={() => void history.refetch()}
        >
          Retry history
        </button>
      )}
      <button type="button" className="text-button" onClick={() => choose()}>
        View latest revision
      </button>
      {history.data && !history.isError && (
        <>
          <ul className="member-list">
            {history.data.items.map((item) => (
              <li key={item.version}>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => choose(item.version)}
                >
                  View revision {item.version}
                </button>{' '}
                {item.state === 'FINAL' ? 'Final' : 'Revised'} /{' '}
                {formatTime(item.createdAt, zone)} / calculation{' '}
                {item.calculationVersion}
              </li>
            ))}
          </ul>
          <Pager
            page={page}
            hasMore={history.data.hasMore}
            change={setPage}
            label="history"
          />
        </>
      )}
    </section>
  )
}

export function RecapPage() {
  const { id = '' } = useParams()
  const [search, setSearch] = useSearchParams()
  const raw = search.get('version')
  const version = raw === null ? undefined : Number(raw)
  const valid =
    version === undefined || (Number.isSafeInteger(version) && version > 0)
  const [page, setPage] = useState(0)
  const cache = useQueryClient()
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => loadSession(signal),
    retry: false,
  })
  const competition = useQuery({
    queryKey: ['competitions', 'detail', id],
    queryFn: ({ signal }) => getCompetition(id, signal),
    retry: false,
  })
  const recap = useQuery({
    queryKey: ['recaps', 'detail', id, version, page],
    queryFn: ({ signal }) => api.recap(id, version, page, signal),
    enabled: valid && Boolean(competition.data) && !competition.isError,
    retry: false,
  })
  const choose = (next?: number) => {
    setPage(0)
    setSearch(next === undefined ? {} : { version: String(next) })
    void cache.invalidateQueries({ queryKey: ['recaps', 'detail', id] })
  }
  const result = recap.data
  const member = Boolean(
    session.data?.user &&
    competition.data &&
    competition.data.viewerRole !== 'NONE',
  )
  return (
    <section className="competition-page">
      <Link to={`/competitions/${id}`}>Back to competition</Link>
      <h1>Competition recap</h1>
      <p>
        Published rankings and display names are retained as immutable result
        revisions. Equal inches share a rank; whole counts never break ties.
      </p>
      <ErrorNotice error={competition.error} />
      <ErrorNotice error={recap.error} />
      {!valid && <p role="alert">Choose a positive recap revision.</p>}
      {(competition.isPending ||
        (recap.isPending && recap.fetchStatus !== 'idle')) && (
        <p role="status">Loading recap...</p>
      )}
      {recap.isError && (
        <button
          type="button"
          className="text-button"
          onClick={() => void recap.refetch()}
        >
          Retry recap
        </button>
      )}
      {result && !recap.isError && valid && (
        <>
          <h2>{competition.data?.name}</h2>
          <p className="form-notice">
            {result.result.state === 'FINAL' ? 'Final recap' : 'Revised recap'}{' '}
            / Revision {result.result.version}
          </p>
          <p>
            {formatTime(result.result.createdAt, competition.data!.timeZone)} /
            calculation {result.result.calculationVersion}
          </p>
          <dl className="competition-facts" aria-label="Recap totals">
            <dt>Participants</dt>
            <dd>{result.participantCount}</dd>
            <dt>Total inches</dt>
            <dd>{formatInches(result.totalHundredths)}</dd>
            <dt>Whole hot dogs</dt>
            <dd>{result.wholeHotDogs}</dd>
          </dl>
          <ResultsTable
            items={result.standings}
            caption={`Recap standings / Revision ${result.result.version}`}
          />
          <Pager
            page={page}
            hasMore={result.hasMore}
            change={setPage}
            label="recap standings"
          />
          <ResultHistory
            key={id}
            id={id}
            zone={competition.data!.timeZone}
            choose={choose}
          />
          {member && (
            <>
              <MemberHighlights id={id} version={result.result.version} />
              <CorrectionAudit id={id} zone={competition.data!.timeZone} />
            </>
          )}
          {competition.data?.viewerRole === 'ORGANIZER' && (
            <Link
              className="button secondary"
              to={`/competitions/${id}/corrections`}
            >
              Correct competition scores
            </Link>
          )}
        </>
      )}
    </section>
  )
}

type Entry = Awaited<ReturnType<typeof listEntries>>['items'][number]
function CorrectionForm({
  id,
  entry,
  published,
}: {
  id: string
  entry: Entry
  published: (version: number) => void
}) {
  const cache = useQueryClient()
  const [total, setTotal] = useState(formatInches(entry.totalHundredths))
  const [whole, setWhole] = useState(String(entry.wholeHotDogs))
  const [excluded, setExcluded] = useState(entry.scoreExcluded)
  const [reason, setReason] = useState('')
  const pending = useRef<{ payload: string; requestId: string } | null>(null)
  const save = useMutation({
    mutationFn: () => {
      const body = {
        version: entry.version,
        totalHundredths: toHundredths(total, 20199980),
        wholeHotDogs: wholeQuantity(whole, 2000),
        excluded,
        reason,
      }
      if (body.totalHundredths < 1)
        throw new Error(
          'Retained score must be positive; use scoring exclusion to count zero.',
        )
      const payload = JSON.stringify(body)
      if (pending.current?.payload !== payload)
        pending.current = { payload, requestId: crypto.randomUUID() }
      return api.correct(id, entry.id, {
        ...body,
        requestId: pending.current.requestId,
      })
    },
    onSuccess: async (receipt) => {
      published(receipt.resultVersion)
      await Promise.all(
        ['meals', 'competitions', 'recaps'].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      )
    },
  })
  return (
    <form
      className="competition-form"
      aria-label={`Score correction ${entry.id}`}
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <fieldset disabled={save.isPending}>
        <legend>
          {entry.displayName} / {entry.revision.location}
        </legend>
        <p>
          Original measurements: {formatInches(entry.revision.totalHundredths)}{' '}
          inches / {entry.revision.wholeHotDogs} whole hot dogs. Entry version{' '}
          {entry.version}.
        </p>
        <label htmlFor={`score-${entry.id}`}>Corrected total inches</label>
        <input
          id={`score-${entry.id}`}
          inputMode="decimal"
          required
          value={total}
          onChange={(event) => setTotal(event.target.value)}
        />
        <label htmlFor={`whole-${entry.id}`}>Corrected whole hot dogs</label>
        <input
          id={`whole-${entry.id}`}
          inputMode="numeric"
          required
          value={whole}
          onChange={(event) => setWhole(event.target.value)}
        />
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={excluded}
            onChange={(event) => setExcluded(event.target.checked)}
          />
          Exclude this entry from scoring
        </label>
        <label htmlFor={`reason-${entry.id}`}>
          Reason for correction (visible to members)
        </label>
        <textarea
          id={`reason-${entry.id}`}
          required
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <button className="button" disabled={save.isPending}>
          Publish corrected recap
        </button>
        <ErrorNotice error={save.error} />
      </fieldset>
    </form>
  )
}
function CorrectionEntries({ id }: { id: string }) {
  const [page, setPage] = useState(0)
  const [published, setPublished] = useState<number | null>(null)
  const entries = useQuery({
    queryKey: ['meals', 'correction-entries', id, page],
    queryFn: ({ signal }) => listEntries(id, page, signal),
    retry: false,
  })
  return (
    <>
      {published !== null && (
        <p role="status">Published recap revision {published}.</p>
      )}
      <ErrorNotice error={entries.error} />
      {entries.isPending && <p role="status">Loading submitted entries...</p>}
      <button
        type="button"
        className="text-button"
        onClick={() => void entries.refetch()}
      >
        Refresh entries
      </button>
      {entries.data && !entries.isError && (
        <>
          {!entries.data.items.length && (
            <p>No nonwithdrawn entries on this page.</p>
          )}
          {entries.data.items.map((entry) => (
            <CorrectionForm
              key={`${entry.id}:${entry.version}`}
              id={id}
              entry={entry}
              published={setPublished}
            />
          ))}
          <Pager
            page={page}
            hasMore={entries.data.hasMore}
            change={setPage}
            label="entries"
          />
        </>
      )}
    </>
  )
}
export function CorrectionsPage() {
  const { id = '' } = useParams()
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => loadSession(signal),
    retry: false,
  })
  const competition = useQuery({
    queryKey: ['competitions', 'detail', id],
    queryFn: ({ signal }) => getCompetition(id, signal),
    enabled: Boolean(session.data?.user),
    retry: false,
  })
  return (
    <section className="competition-page narrow">
      <Link to={`/competitions/${id}/recap`}>View competition recap</Link>
      <h1>Organizer score corrections</h1>
      <p>
        After the submission cutoff only. A score override or scoring exclusion
        creates a new recap revision with an audited reason. It never changes
        original measurements, source meals, locations, photos, memberships, or
        another competition. Excluded scores count zero but their submitted
        details stay member-visible. Withdrawn entries cannot be reinstated
        here.
      </p>
      <ErrorNotice error={session.error} />
      <ErrorNotice error={competition.error} />
      {session.isPending ? (
        <p role="status">Loading account...</p>
      ) : !session.data?.user ? (
        <p>
          <Link to="/sign-in">Sign in</Link> as the competition organizer.
        </p>
      ) : competition.isPending ? (
        <p role="status">Loading competition...</p>
      ) : (
        competition.data &&
        !competition.isError &&
        (competition.data.viewerRole !== 'ORGANIZER' ? (
          <p>Only this competition organizer can correct scores.</p>
        ) : !['CLOSED', 'FINALIZED', 'REVISED'].includes(
            competition.data.phase,
          ) ? (
          <p>
            Score corrections are available after the submission window closes.
          </p>
        ) : (
          <CorrectionEntries key={id} id={id} />
        ))
      )}
    </section>
  )
}
