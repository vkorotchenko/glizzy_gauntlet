import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Temporal } from '@js-temporal/polyfill'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { loadSession } from '../auth/api'
import { PageHeading } from '../PageHeading'
import { loggingCompetitions, type Competition } from '../competitions/api'
import {
  formatTime,
  fromInstant,
  toInstant,
  type Occurrence,
} from '../competitions/time'
import { listVenues } from '../directory/api'
import * as api from './api'
import { formatInches, toHundredths, wholeQuantity } from './measurement'

function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => loadSession(signal),
    retry: false,
  })
}
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
}: {
  page: number
  hasMore: boolean
  change: (page: number) => void
}) {
  return (
    <div className="page-controls">
      <button
        type="button"
        className="text-button"
        disabled={!page}
        onClick={() => change(page - 1)}
      >
        Previous page
      </button>
      <span>Page {page + 1}</span>
      <button
        type="button"
        className="text-button"
        disabled={!hasMore || page >= 1000}
        onClick={() => change(page + 1)}
      >
        Next page
      </button>
    </div>
  )
}

export function MealSummary({
  revision,
  showTotals = true,
}: {
  revision: api.Revision
  showTotals?: boolean
}) {
  return (
    <div className="meal-summary">
      {showTotals && (
        <p className="meal-totals">
          {revision.totalHundredths > 0 && (
            <strong>{formatInches(revision.totalHundredths)} inches</strong>
          )}
          {revision.totalHundredths > 0 && revision.wholeHotDogs > 0 && ' / '}
          {revision.wholeHotDogs > 0 &&
            `${revision.wholeHotDogs} whole hot dogs`}
        </p>
      )}
      <p>
        {new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
          hourCycle: 'h23',
        }).format(new Date(revision.eatenAt))}{' '}
        {revision.location && ` / ${revision.location}`}
      </p>
      <ul className="member-list">
        {revision.items.map((item, index) => (
          <li key={index}>
            {item.name}: {item.wholeQuantity} whole at{' '}
            {formatInches(item.unitHundredths)} inches each
            {item.partialHundredths > 0 &&
              ` + ${formatInches(item.partialHundredths)} partial inches`}
          </li>
        ))}
      </ul>
      {revision.notes && <p className="competition-rules">{revision.notes}</p>}
      <div className="photo-gallery">
        {revision.photoIds.map((id, index) => (
          <a key={id} href={api.photoUrl(id, false)}>
            <img
              loading="lazy"
              src={api.photoUrl(id)}
              alt={`Meal photo ${index + 1}`}
            />
          </a>
        ))}
      </div>
    </div>
  )
}

export function MealsPage() {
  const session = useSession()
  const [archived, setArchived] = useState(false)
  const [page, setPage] = useState(0)
  const meals = useQuery({
    queryKey: ['meals', 'list', archived, page],
    queryFn: ({ signal }) => api.listMeals(archived, page, signal),
    enabled: Boolean(session.data?.user),
  })
  return (
    <section className="competition-page">
      <span className="eyebrow">Your own record</span>
      <PageHeading title="My meals">
        <button
          className="text-button"
          aria-pressed={archived}
          onClick={() => {
            setArchived(!archived)
            setPage(0)
          }}
        >
          {archived ? 'Show current meals' : 'Show archived sources'}
        </button>
        <Link className="button" to="/meals/new">
          Log a meal
        </Link>
      </PageHeading>
      <p>
        Source records stay private. Only explicitly selected competition
        snapshots are shared with members. A meal shared with several
        competitions appears here only once.
      </p>
      <ErrorNotice error={session.error} />
      {session.isPending ? (
        <p role="status">Loading account...</p>
      ) : !session.data?.user ? (
        <p>
          <Link to="/sign-in">Sign in</Link> to view your meals.
        </p>
      ) : (
        <>
          {meals.isPending && <p role="status">Loading meals...</p>}
          <ErrorNotice error={meals.error} />
          {meals.isError && (
            <button
              className="text-button"
              onClick={() => void meals.refetch()}
            >
              Try again
            </button>
          )}
          {meals.data && !meals.isError && (
            <>
              {!meals.data.items.length && (
                <p>No {archived ? 'archived' : 'saved'} meals here yet.</p>
              )}
              <div className="competition-grid">
                {meals.data.items.map((meal) => (
                  <article className="competition-card" key={meal.id}>
                    <h2>
                      <Link to={`/meals/${meal.id}`}>
                        {meal.revision.items[0]?.name ?? 'Hot dogs'}
                      </Link>
                    </h2>
                    <p>
                      {formatInches(meal.revision.totalHundredths)} inches /{' '}
                      {meal.revision.wholeHotDogs} whole hot dogs
                    </p>
                    <p>{meal.revision.location}</p>
                    <p>
                      {
                        meal.submissions.filter((entry) => !entry.withdrawn)
                          .length
                      }{' '}
                      competition submissions
                    </p>
                  </article>
                ))}
              </div>
              <Pager
                page={page}
                hasMore={meals.data.hasMore}
                change={setPage}
              />
            </>
          )}
        </>
      )}
    </section>
  )
}

function Targets({
  selected,
  change,
  competitions,
}: {
  selected: string[]
  change: (ids: string[]) => void
  competitions: Competition[]
}) {
  const [page, setPage] = useState(0)
  const eligible = competitions.slice(page * 20, (page + 1) * 20)
  return (
    <section className="competition-section">
      <h2>Submit to competitions</h2>
      <p>
        Optional. Choose the joined competitions to receive this exact revision,
        including its location, notes, and photos. Every member can see it.
        Unselected existing submissions stay unchanged, even if you remove a
        checkmark here.
      </p>
      <p>
        All affected limited-time competitions must permit meal sharing. The
        all-time leaderboard can also receive the meal. Written eligibility
        rules still apply. The server checks dates and submission deadlines when
        saving.
      </p>
      <p role="status">{selected.length} selected</p>
      {!eligible.length && <p>No open joined competitions on this page.</p>}
      {eligible.map((item) => (
        <div key={item.id}>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              disabled={!selected.includes(item.id) && selected.length >= 20}
              onChange={(event) =>
                change(
                  event.target.checked
                    ? [...selected, item.id]
                    : selected.filter((id) => id !== item.id),
                )
              }
            />
            Submit to {item.name}
          </label>
          <details>
            <summary>Rules and dates for {item.name}</summary>
            <p>{item.rules || 'No additional written rules.'}</p>
            <p>
              {formatTime(item.startsAt, item.timeZone)} to{' '}
              {formatTime(item.endsAt, item.timeZone)}
            </p>
            <p>
              Submission cutoff:{' '}
              {formatTime(item.submissionClosesAt, item.timeZone)}. Sharing:{' '}
              {item.allowSharedMeals ? 'allowed' : 'not allowed'}.
            </p>
          </details>
        </div>
      ))}
      <Pager
        page={page}
        hasMore={(page + 1) * 20 < competitions.length}
        change={setPage}
      />
    </section>
  )
}

function PhotoPicker({
  selected,
  change,
  busy,
}: {
  selected: string[]
  change: (ids: string[]) => void
  busy: (value: boolean) => void
}) {
  const cache = useQueryClient()
  const staged = useQuery({
    queryKey: ['meals', 'staged-photos'],
    queryFn: ({ signal }) => api.stagedPhotos(signal),
  })
  const [file, setFile] = useState<File | null>(null)
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a photo first.')
      if (file.size > 5 * 1024 * 1024)
        throw new Error('Choose a JPEG or PNG no larger than 5 MiB.')
      busy(true)
      try {
        return await api.uploadPhoto(file)
      } finally {
        busy(false)
      }
    },
    onSuccess: async (photo) => {
      if (selected.length < 5) change([...selected, photo.id])
      await cache.invalidateQueries({ queryKey: ['meals', 'staged-photos'] })
    },
  })
  const discard = useMutation({
    mutationFn: (id: string) => api.discardPhoto(id),
    onSuccess: async (_, id) => {
      change(selected.filter((photo) => photo !== id))
      await cache.invalidateQueries({ queryKey: ['meals', 'staged-photos'] })
    },
  })
  const photos = [...new Set([...selected, ...(staged.data ?? [])])]
  return (
    <section className="competition-section">
      <h2>Optional meal photos</h2>
      <p>
        Attach up to five. Photos remain private unless included in a selected
        competition snapshot; they never become public directory photos.
        JPEG/PNG only, up to 5 MiB and 12 megapixels (6000 pixels per side).
        Metadata is removed.
      </p>
      <label htmlFor="meal-photo-file">Meal photo file</label>
      <input
        id="meal-photo-file"
        type="file"
        accept="image/jpeg,image/png"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        className="text-button"
        disabled={!file || upload.isPending || selected.length >= 5}
        onClick={() => upload.mutate()}
      >
        Upload private photo
      </button>
      <ErrorNotice error={upload.error} />
      <ErrorNotice error={staged.error} />
      <ErrorNotice error={discard.error} />
      <div className="photo-gallery">
        {photos.map((id, index) => (
          <div key={id}>
            <img
              src={api.photoUrl(id)}
              alt={`Available meal photo ${index + 1}`}
            />
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={selected.includes(id)}
                disabled={!selected.includes(id) && selected.length >= 5}
                onChange={(event) =>
                  change(
                    event.target.checked
                      ? [...selected, id]
                      : selected.filter((photo) => photo !== id),
                  )
                }
              />
              Attach photo {index + 1}
            </label>
            {staged.data?.includes(id) && (
              <button
                type="button"
                className="text-button"
                disabled={discard.isPending}
                onClick={() => discard.mutate(id)}
              >
                Discard unattached photo {index + 1}
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="form-note">
        Unattached uploads can be discarded here. Attached photos remain in
        revision history; removing a checkmark does not change older
        submissions.
      </p>
    </section>
  )
}

function roundMealTime(local: string, zone: string, occurrence: Occurrence) {
  try {
    const entered = Temporal.Instant.from(
      toInstant(local, zone, occurrence),
    ).toZonedDateTimeISO(zone)
    const nearest = entered.round({
      smallestUnit: 'minute',
      roundingIncrement: 15,
      roundingMode: 'halfExpand',
    })
    const rounded =
      nearest.epochMilliseconds > Date.now() &&
      entered.epochMilliseconds <= Date.now()
        ? entered.round({
            smallestUnit: 'minute',
            roundingIncrement: 15,
            roundingMode: 'floor',
          })
        : nearest
    return fromInstant(rounded.toInstant().toString(), zone)
  } catch {
    throw new Error(
      'Choose a valid local date and time. Times skipped when clocks change are unavailable.',
    )
  }
}

function MealForm({ initial }: { initial?: api.Meal }) {
  const navigate = useNavigate()
  const cache = useQueryClient()
  const revision = initial?.revision
  const [zone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  )
  const [initialTime] = useState(() => {
    return revision
      ? fromInstant(revision.eatenAt, zone)
      : { local: '', occurrence: 'reject' as const }
  })
  const [time, setTime] = useState(initialTime.local.slice(0, 16))
  const [timeChanged, setTimeChanged] = useState(false)
  const [occurrence, setOccurrence] = useState<Occurrence>(
    initialTime.occurrence,
  )
  const [venueId, setVenue] = useState(revision?.venueId ?? '')
  const [location, setLocation] = useState(
    revision?.venueId ? '' : (revision?.location ?? ''),
  )
  const [notes, setNotes] = useState(revision?.notes ?? '')
  const [count, setCount] = useState(
    revision ? String(revision.wholeHotDogs) : '',
  )
  const [length, setLength] = useState(
    revision ? formatInches(revision.totalHundredths) : '',
  )
  const [photoIds, setPhotos] = useState(revision?.photoIds ?? [])
  const [uploading, setUploading] = useState(false)
  const [targets, setTargets] = useState<string[]>([])
  const competitions = useQuery({
    queryKey: ['competitions', 'logging'],
    queryFn: ({ signal }) => loggingCompetitions(signal),
  })
  const modes = competitions.data?.map((item) => item.trackingMode) ?? []
  const tracksCount =
    modes.length === 0 || modes.some((mode) => mode !== 'LENGTH')
  const tracksLength =
    modes.length === 0 || modes.some((mode) => mode !== 'COUNT')
  const [venuePage, setVenuePage] = useState(0)
  const venues = useQuery({
    queryKey: ['directory', 'venues', venuePage],
    queryFn: ({ signal }) => listVenues(venuePage, signal),
  })
  const pendingRequest = useRef<{ payload: string; requestId: string } | null>(
    null,
  )
  const roundTime = () => {
    if (!time || (revision && !timeChanged)) return
    try {
      const rounded = roundMealTime(time, zone, occurrence)
      setTime(rounded.local.slice(0, 16))
      setOccurrence(rounded.occurrence)
    } catch {
      // Saving reports invalid local times without interrupting partial edits.
    }
  }
  const save = useMutation({
    mutationFn: async () => {
      let eatenAt = revision?.eatenAt
      if (time && (!revision || timeChanged)) {
        const rounded = roundMealTime(time, zone, occurrence)
        setTime(rounded.local.slice(0, 16))
        setOccurrence(rounded.occurrence)
        eatenAt = toInstant(rounded.local, zone, rounded.occurrence)
      }
      if (timeChanged && !time) eatenAt = undefined
      const totalHundredths = toHundredths(length || '0', 20199980)
      const wholeHotDogs = wholeQuantity(count || '0', 2000)
      if (totalHundredths === 0 && wholeHotDogs === 0)
        throw new Error('Add a hot dog count or total inches before saving.')
      const keepItems = Boolean(
        revision?.items.length &&
        totalHundredths === revision.totalHundredths &&
        wholeHotDogs === revision.wholeHotDogs,
      )
      const body = {
        version: initial?.version ?? 0,
        content: {
          eatenAt,
          venueId: venueId || null,
          location: venueId ? '' : location,
          notes,
          photoIds,
          items: keepItems ? revision!.items : [],
          ...(keepItems ? {} : { totalHundredths, wholeHotDogs }),
        },
        competitionIds: targets,
      }
      const payload = JSON.stringify(body)
      if (pendingRequest.current?.payload !== payload)
        pendingRequest.current = { payload, requestId: crypto.randomUUID() }
      return api.saveMeal(initial?.id, {
        ...body,
        requestId: pendingRequest.current.requestId,
      })
    },
    onSuccess: async (meal) => {
      cache.setQueryData(['meals', 'detail', meal.id], meal)
      await cache.invalidateQueries({ queryKey: ['meals'] })
      await cache.invalidateQueries({ queryKey: ['feed'] })
      navigate(`/meals/${meal.id}`)
    },
  })
  return (
    <form
      className="competition-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <fieldset disabled={save.isPending}>
        <legend>What you ate</legend>
        <p>
          Add your totals and save. Only the measurements used by your open
          joined competitions are shown. Eat at your own pace.
        </p>
        {competitions.isPending && (
          <p role="status">Loading joined competitions...</p>
        )}
        <ErrorNotice error={competitions.error} />
        {competitions.isError && (
          <button
            type="button"
            className="text-button"
            onClick={() => void competitions.refetch()}
          >
            Retry joined competitions
          </button>
        )}
        {tracksCount && (
          <>
            <label htmlFor="meal-count">How many hot dogs?</label>
            <input
              id="meal-count"
              inputMode="numeric"
              pattern="[0-9]+"
              required
              value={count}
              onChange={(event) => setCount(event.target.value)}
            />
          </>
        )}
        {tracksLength && (
          <>
            <label htmlFor="meal-length">Total inches</label>
            <input
              id="meal-length"
              inputMode="decimal"
              required
              value={length}
              onChange={(event) => setLength(event.target.value)}
            />
            <p className="form-note">
              Combined length eaten, not length per hot dog. Use your actual
              measurement, with up to two decimal places.
            </p>
          </>
        )}
        <details className="competition-section">
          <summary>Add photos, location, time, or notes (optional)</summary>
          <label htmlFor="meal-time">When you ate</label>
          <input
            id="meal-time"
            type="datetime-local"
            step="60"
            aria-describedby="meal-time-hint"
            value={time}
            onChange={(event) => {
              setTime(event.target.value)
              setTimeChanged(true)
            }}
            onBlur={roundTime}
          />
          <p id="meal-time-hint" className="form-note">
            Leave blank to use the time you save. Entered times use your
            device's local time, rounded to the nearest 15 minutes without
            moving a past meal into the future.
          </p>
          <h2>Where</h2>
          <label htmlFor="meal-venue">Approved venue (optional)</label>
          <select
            id="meal-venue"
            value={venueId}
            onChange={(event) => setVenue(event.target.value)}
          >
            <option value="">No venue / optional private label</option>
            {venueId &&
              !venues.data?.items.some((item) => item.id === venueId) && (
                <option value={venueId}>
                  {revision?.location ?? 'Selected venue'}
                </option>
              )}
            {venues.data?.items.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name} / {venue.address}
              </option>
            ))}
          </select>
          <ErrorNotice error={venues.error} />
          {venues.data && (
            <Pager
              page={venuePage}
              hasMore={venues.data.hasMore}
              change={setVenuePage}
            />
          )}
          {!venueId && (
            <>
              <label htmlFor="meal-location">Private location label</label>
              <input
                id="meal-location"
                maxLength={300}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </>
          )}
          <p className="form-note">
            Private labels stay out of the public directory, but are visible to
            members of competitions you select.
          </p>
          <label htmlFor="meal-notes">Notes</label>
          <textarea
            id="meal-notes"
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <PhotoPicker
            selected={photoIds}
            change={setPhotos}
            busy={setUploading}
          />
        </details>
        {competitions.data && (
          <Targets
            selected={targets}
            change={setTargets}
            competitions={competitions.data}
          />
        )}
        {initial && (
          <p className="form-notice">
            This creates a new source revision. Closed and unselected
            submissions keep their original contents and totals. Withdrawals are
            separate actions on the meal detail page.
          </p>
        )}
        <button
          className="button"
          disabled={save.isPending || uploading || !competitions.isSuccess}
        >
          Save meal and selected submissions
        </button>
        <ErrorNotice error={save.error} />
      </fieldset>
    </form>
  )
}

export function MealEditorPage() {
  const { id } = useParams()
  const session = useSession()
  const detail = useQuery({
    queryKey: ['meals', 'detail', id],
    queryFn: ({ signal }) => api.getMeal(id!, signal),
    enabled: Boolean(id && session.data?.user),
    retry: false,
  })
  return (
    <section className="competition-page">
      <Link to="/account/meals">My meals</Link>
      <PageHeading title={id ? 'Edit meal and submissions' : 'Log a meal'} />
      <ErrorNotice error={session.error} />
      {session.isPending ? (
        <p role="status">Loading account...</p>
      ) : !session.data?.user ? (
        <p>
          <Link to="/sign-in">Sign in</Link> to log meals.
        </p>
      ) : id && detail.isPending ? (
        <p role="status">Loading meal...</p>
      ) : (
        <>
          <ErrorNotice error={detail.error} />
          {detail.data?.archived ? (
            <p>Archived sources cannot be edited.</p>
          ) : (
            (!id || detail.data) &&
            !detail.isError && (
              <MealForm
                key={detail.data?.version ?? 'new'}
                initial={detail.data}
              />
            )
          )}
        </>
      )}
    </section>
  )
}

function SubmissionRow({
  mealId,
  item,
  refresh,
}: {
  mealId: string
  item: api.Submission
  refresh: () => Promise<unknown>
}) {
  const [key] = useState(() => crypto.randomUUID())
  const withdraw = useMutation({
    mutationFn: () =>
      api.withdraw(mealId, item.competitionId, item.version, key),
    onSuccess: refresh,
  })
  return (
    <li>
      <strong>{item.competitionName}</strong> /{' '}
      {item.withdrawn
        ? 'Withdrawn'
        : item.scoreExcluded
          ? 'Excluded from scoring (retained values)'
          : 'Submitted'}{' '}
      / {formatInches(item.totalHundredths)} inches / {item.wholeHotDogs} whole
      hot dogs
      <p>
        {item.acceptsChanges
          ? 'Changes still accepted; eligibility is rechecked when saving.'
          : 'Changes closed or membership unavailable.'}
      </p>
      {!item.withdrawn && item.acceptsChanges && (
        <button
          className="text-button"
          disabled={withdraw.isPending}
          onClick={() => withdraw.mutate()}
        >
          Withdraw from {item.competitionName}
        </button>
      )}
      <ErrorNotice error={withdraw.error} />
    </li>
  )
}
export function MealPage() {
  const { id = '' } = useParams()
  const session = useSession()
  const cache = useQueryClient()
  const [page, setPage] = useState(0)
  const detail = useQuery({
    queryKey: ['meals', 'detail', id],
    queryFn: ({ signal }) => api.getMeal(id, signal),
    enabled: Boolean(session.data?.user),
    retry: false,
  })
  const revisions = useQuery({
    queryKey: ['meals', 'history', id, page],
    queryFn: ({ signal }) => api.history(id, page, signal),
    enabled: Boolean(detail.data),
  })
  const [archiveKey] = useState(() => crypto.randomUUID())
  const refresh = () => cache.invalidateQueries({ queryKey: ['meals'] })
  const archive = useMutation({
    mutationFn: () => api.archiveMeal(id, detail.data!.version, archiveKey),
    onSuccess: refresh,
  })
  const meal = detail.data
  return (
    <section className="competition-page">
      <Link to="/account/meals">My meals</Link>
      <PageHeading title="Meal record">
        {session.data?.user && meal && !detail.isError && !meal.archived && (
          <Link className="button secondary" to={`/meals/${id}/edit`}>
            Edit meal or select submissions
          </Link>
        )}
      </PageHeading>
      <ErrorNotice error={session.error} />
      {!session.data?.user ? (
        <p>
          <Link to="/sign-in">Sign in</Link> to see your private meal.
        </p>
      ) : (
        <>
          {detail.isPending && <p role="status">Loading meal...</p>}
          <ErrorNotice error={detail.error} />
          {meal && !detail.isError && (
            <>
              <p className="eyebrow">
                Private source / Revision {meal.revision.version}
                {meal.archived ? ' / Archived' : ''}
              </p>
              <MealSummary revision={meal.revision} />
              <section className="competition-section">
                <h2>Competition snapshots</h2>
                <p>
                  Each submission retains exactly the revision you selected.
                  Later private edits do not change it automatically. Closed
                  windows are frozen, not yet finalized recaps.
                </p>
                {!meal.submissions.length && (
                  <p>Not submitted to any competition.</p>
                )}
                <ul className="member-list">
                  {meal.submissions.map((item) => (
                    <SubmissionRow
                      key={`${item.competitionId}-${item.version}`}
                      mealId={id}
                      item={item}
                      refresh={refresh}
                    />
                  ))}
                </ul>
              </section>
              <section className="competition-section">
                <h2>Private revision history</h2>
                <ErrorNotice error={revisions.error} />
                {revisions.data && (
                  <>
                    <ul className="member-list">
                      {revisions.data.items.map((revision) => (
                        <li key={revision.id}>
                          <details>
                            <summary>
                              Revision {revision.version}:{' '}
                              {formatInches(revision.totalHundredths)} inches /{' '}
                              {revision.wholeHotDogs} whole hot dogs
                            </summary>
                            <MealSummary revision={revision} />
                          </details>
                        </li>
                      ))}
                    </ul>
                    <Pager
                      page={page}
                      hasMore={revisions.data.hasMore}
                      change={setPage}
                    />
                  </>
                )}
              </section>
              {!meal.archived && (
                <section className="competition-section">
                  <h2>Archive source</h2>
                  <p>
                    Remove this source from your current meal list and stop
                    editing it. This does not withdraw any competition
                    submission or erase retained revisions/photos. Withdraw open
                    submissions above first if needed.
                  </p>
                  <button
                    className="text-button"
                    disabled={archive.isPending}
                    onClick={() => archive.mutate()}
                  >
                    Archive source (keep submissions)
                  </button>
                  <ErrorNotice error={archive.error} />
                </section>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

export function CompetitionMeals({ id }: { id: string }) {
  const [page, setPage] = useState(0)
  const list = useQuery({
    queryKey: ['meals', 'activity', id, page],
    queryFn: ({ signal }) => api.listEntries(id, page, signal),
  })
  return (
    <section className="competition-section" aria-label="Member meal activity">
      <PageHeading title="Member meal activity" level={2}>
        <Link className="button secondary" to="/meals/new">
          Log a meal
        </Link>
      </PageHeading>
      <p>
        Submitted snapshots only. Source edits and other competitions remain
        private.
      </p>
      {list.isPending && <p role="status">Loading submitted meals...</p>}
      <ErrorNotice error={list.error} />
      {list.data && (
        <>
          {!list.data.items.length && <p>No submitted meals yet.</p>}
          {list.data.items.map((entry) => (
            <article className="competition-card" key={entry.id}>
              <h3>{entry.displayName}</h3>
              {entry.scoreExcluded ? (
                <p className="form-notice">
                  Excluded from scoring. Submitted details remain
                  member-visible.
                </p>
              ) : (
                (entry.totalHundredths !== entry.revision.totalHundredths ||
                  entry.wholeHotDogs !== entry.revision.wholeHotDogs) && (
                  <p className="form-notice">
                    Organizer-corrected score:{' '}
                    {formatInches(entry.totalHundredths)} inches /{' '}
                    {entry.wholeHotDogs} whole hot dogs. Measurements below are
                    the original submission.
                  </p>
                )
              )}
              <MealSummary revision={entry.revision} />
            </article>
          ))}
          <Pager page={page} hasMore={list.data.hasMore} change={setPage} />
        </>
      )}
    </section>
  )
}
