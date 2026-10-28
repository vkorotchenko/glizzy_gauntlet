import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { loadSession } from '../auth/api'
import { listCompetitions } from '../competitions/api'
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

export function MealSummary({ revision }: { revision: api.Revision }) {
  return (
    <div className="meal-summary">
      <p className="meal-totals">
        <strong>{formatInches(revision.totalHundredths)} inches</strong> /{' '}
        {revision.wholeHotDogs} whole hot dogs
      </p>
      <p>
        {formatTime(
          revision.eatenAt,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        )}{' '}
        / {revision.location}
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
      <h1>My meals</h1>
      <p>
        Source records stay private. Only explicitly selected competition
        snapshots are shared with members. A meal shared with several
        competitions appears here only once.
      </p>
      <div className="competition-actions">
        <Link className="button" to="/meals/new">
          Log a meal
        </Link>
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
      </div>
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
                        {meal.revision.items[0].name}
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
}: {
  selected: string[]
  change: (ids: string[]) => void
}) {
  const [page, setPage] = useState(0)
  const list = useQuery({
    queryKey: ['competitions', 'list', 'mine', page],
    queryFn: ({ signal }) => listCompetitions('mine', page, signal),
  })
  const eligible =
    list.data?.items.filter(
      (item) => item.published && ['ACTIVE', 'GRACE'].includes(item.phase),
    ) ?? []
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
        All affected competitions must permit meal sharing. Written eligibility
        rules still apply. The server checks dates and submission deadlines when
        saving.
      </p>
      <p role="status">{selected.length} selected</p>
      {list.isPending && <p role="status">Loading joined competitions...</p>}
      <ErrorNotice error={list.error} />
      {!list.isPending && !eligible.length && (
        <p>No open joined competitions on this page.</p>
      )}
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
      {list.data && (
        <Pager page={page} hasMore={list.data.hasMore} change={setPage} />
      )}
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

type ItemFields = {
  key: string
  name: string
  quantity: string
  length: string
  partial: string
}
function MealForm({ initial }: { initial?: api.Meal }) {
  const navigate = useNavigate()
  const cache = useQueryClient()
  const revision = initial?.revision
  const [zone, setZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  )
  const [initialTime] = useState(() =>
    fromInstant(
      revision?.eatenAt ?? new Date(Date.now() - 60000).toISOString(),
      zone,
    ),
  )
  const [time, setTime] = useState(initialTime.local)
  const [occurrence, setOccurrence] = useState<Occurrence>(
    initialTime.occurrence,
  )
  const [venueId, setVenue] = useState(revision?.venueId ?? '')
  const [location, setLocation] = useState(
    revision?.venueId ? '' : (revision?.location ?? ''),
  )
  const [notes, setNotes] = useState(revision?.notes ?? '')
  const [items, setItems] = useState<ItemFields[]>(
    revision?.items.map((item) => ({
      key: crypto.randomUUID(),
      name: item.name,
      quantity: String(item.wholeQuantity),
      length: formatInches(item.unitHundredths),
      partial: formatInches(item.partialHundredths),
    })) ?? [
      {
        key: crypto.randomUUID(),
        name: '',
        quantity: '0',
        length: '',
        partial: '',
      },
    ],
  )
  const [photoIds, setPhotos] = useState(revision?.photoIds ?? [])
  const [uploading, setUploading] = useState(false)
  const [targets, setTargets] = useState<string[]>([])
  const [venuePage, setVenuePage] = useState(0)
  const venues = useQuery({
    queryKey: ['directory', 'venues', venuePage],
    queryFn: ({ signal }) => listVenues(venuePage, signal),
  })
  const pendingRequest = useRef<{ payload: string; requestId: string } | null>(
    null,
  )
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        version: initial?.version ?? 0,
        content: {
          eatenAt: toInstant(time, zone, occurrence),
          venueId: venueId || null,
          location: venueId ? '' : location,
          notes,
          photoIds,
          items: items.map((item) => ({
            name: item.name,
            wholeQuantity: wholeQuantity(item.quantity),
            unitHundredths: toHundredths(item.length),
            partialHundredths: toHundredths(item.partial || '0'),
          })),
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
      navigate(`/meals/${meal.id}`)
    },
  })
  const changeItem = (key: string, field: keyof ItemFields, value: string) =>
    setItems(
      items.map((item) =>
        item.key === key ? { ...item, [field]: value } : item,
      ),
    )
  return (
    <form
      className="competition-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <fieldset disabled={save.isPending}>
        <legend>Meal details</legend>
        <p>
          Use your actual measurements, not a standard size. The server
          calculates totals after saving. Eat at your own pace.
        </p>
        <label htmlFor="meal-time">When you ate</label>
        <input
          id="meal-time"
          type="datetime-local"
          step="0.001"
          required
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />
        <label htmlFor="meal-zone">Eating time zone</label>
        <input
          id="meal-zone"
          required
          value={zone}
          onChange={(event) => setZone(event.target.value)}
        />
        <label htmlFor="meal-occurrence">Repeated hour</label>
        <select
          id="meal-occurrence"
          value={occurrence}
          onChange={(event) => setOccurrence(event.target.value as Occurrence)}
        >
          <option value="reject">Require an unambiguous time</option>
          <option value="earlier">First occurrence</option>
          <option value="later">Second occurrence</option>
        </select>
        <h2>What you ate</h2>
        <p>
          Use separate lines for different sizes. Each line allows 0-100 whole
          hot dogs, a full length up to 100 inches, and an additional partial
          portion smaller than that length. At most two decimal places; no
          rounding.
        </p>
        {items.map((item, index) => (
          <fieldset key={item.key}>
            <legend>Item {index + 1}</legend>
            <label htmlFor={`item-name-${item.key}`}>
              Item {index + 1} name
            </label>
            <input
              id={`item-name-${item.key}`}
              required
              maxLength={120}
              value={item.name}
              onChange={(event) =>
                changeItem(item.key, 'name', event.target.value)
              }
            />
            <label htmlFor={`item-quantity-${item.key}`}>
              Item {index + 1} whole quantity
            </label>
            <input
              id={`item-quantity-${item.key}`}
              inputMode="numeric"
              pattern="[0-9]+"
              required
              value={item.quantity}
              onChange={(event) =>
                changeItem(item.key, 'quantity', event.target.value)
              }
            />
            <label htmlFor={`item-length-${item.key}`}>
              Item {index + 1} full length (inches)
            </label>
            <input
              id={`item-length-${item.key}`}
              inputMode="decimal"
              required
              value={item.length}
              onChange={(event) =>
                changeItem(item.key, 'length', event.target.value)
              }
            />
            <label htmlFor={`item-partial-${item.key}`}>
              Item {index + 1} additional partial inches
            </label>
            <input
              id={`item-partial-${item.key}`}
              inputMode="decimal"
              value={item.partial}
              onChange={(event) =>
                changeItem(item.key, 'partial', event.target.value)
              }
            />
            <button
              type="button"
              className="text-button"
              disabled={items.length === 1}
              onClick={() =>
                setItems(items.filter((value) => value.key !== item.key))
              }
            >
              Remove item {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="text-button"
          disabled={items.length >= 20}
          onClick={() =>
            setItems([
              ...items,
              {
                key: crypto.randomUUID(),
                name: '',
                quantity: '0',
                length: '',
                partial: '',
              },
            ])
          }
        >
          Add another size
        </button>
        <h2>Where</h2>
        <label htmlFor="meal-venue">Approved venue (optional)</label>
        <select
          id="meal-venue"
          value={venueId}
          onChange={(event) => setVenue(event.target.value)}
        >
          <option value="">Use a private location label</option>
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
              required
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
        <Targets selected={targets} change={setTargets} />
        {initial && (
          <p className="form-notice">
            This creates a new source revision. Closed and unselected
            submissions keep their original contents and totals. Withdrawals are
            separate actions on the meal detail page.
          </p>
        )}
        <button className="button" disabled={save.isPending || uploading}>
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
      <Link to="/meals">My meals</Link>
      <h1>{id ? 'Edit meal and submissions' : 'Log a meal'}</h1>
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
      {item.withdrawn ? 'Withdrawn' : 'Submitted'} /{' '}
      {formatInches(item.totalHundredths)} inches / {item.wholeHotDogs} whole
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
      <Link to="/meals">My meals</Link>
      <h1>Meal record</h1>
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
              {!meal.archived && (
                <Link className="button secondary" to={`/meals/${id}/edit`}>
                  Edit meal or select submissions
                </Link>
              )}
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
    <section className="competition-section">
      <h2>Member meal activity</h2>
      <p>
        Submitted snapshots only. Source edits and other competitions remain
        private.
      </p>
      <Link className="button secondary" to="/meals/new">
        Log a meal
      </Link>
      {list.isPending && <p role="status">Loading submitted meals...</p>}
      <ErrorNotice error={list.error} />
      {list.data && (
        <>
          {!list.data.items.length && <p>No submitted meals yet.</p>}
          {list.data.items.map((entry) => (
            <article className="competition-card" key={entry.id}>
              <h3>{entry.displayName}</h3>
              <MealSummary revision={entry.revision} />
            </article>
          ))}
          <Pager page={page} hasMore={list.data.hasMore} change={setPage} />
        </>
      )}
    </section>
  )
}
