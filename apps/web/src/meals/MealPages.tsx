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
import { MealVenuePicker } from './MealVenuePicker'
import * as api from './api'
import { formatInches, toHundredths, wholeQuantity } from './measurement'
import { MealFeedCard, MealSummary } from './MealCard'
import { HotDogInputs, InfoPopup } from './MealInputs'
import { newHotDog, rowItems, type HotDogRow } from './mealRows'
import { MealPhotoDropzone, MealPhotoPicker } from './MealPhotos'
import { MAX_MEAL_PHOTOS, useMealPhotos } from './useMealPhotos'

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

export function MealsPage() {
  const session = useSession()
  const user = session.data?.user
  const [archived, setArchived] = useState(false)
  const [page, setPage] = useState(0)
  const meals = useQuery({
    queryKey: ['meals', 'list', archived, page],
    queryFn: ({ signal }) => api.listMeals(archived, page, signal),
    enabled: Boolean(user),
  })
  return (
    <section className="competition-page feed-page">
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
      ) : !user ? (
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
              <div className="meal-feed">
                {meals.data.items.map((meal) => (
                  <MealFeedCard
                    key={meal.id}
                    label={`${user.displayName}'s meal`}
                    displayName={user.displayName}
                    profilePhotoId={user.profilePhotoId}
                    subtitle={
                      <Link to={`/meals/${meal.id}`}>
                        {meal.revision.items[0]?.name ?? 'Hot dogs'}
                      </Link>
                    }
                    revision={meal.revision}
                  >
                    <p className="form-note">
                      {
                        meal.submissions.filter((entry) => !entry.withdrawn)
                          .length
                      }{' '}
                      competition submissions
                    </p>
                  </MealFeedCard>
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
  all,
  changeAll,
  selected,
  change,
  competitions,
}: {
  all: boolean
  changeAll: (all: boolean) => void
  selected: string[]
  change: (ids: string[]) => void
  competitions: Competition[]
}) {
  const [page, setPage] = useState(0)
  const eligible = competitions.slice(page * 20, (page + 1) * 20)
  return (
    <section className="competition-section">
      <div className="meal-section-heading">
        <h2>Share with competitions</h2>
        <InfoPopup title="About competition sharing">
          <p>
            Selected competitions receive this revision, including its location,
            notes, and photos, visible to their members.
          </p>
          <p>
            Unselected existing submissions stay unchanged; removing a checkmark
            does not withdraw a previous submission.
          </p>
          <p>
            All affected limited-time competitions must permit sharing. The
            all-time leaderboard can also receive the meal. Competition rules,
            eating windows, and submission deadlines still apply.
          </p>
        </InfoPopup>
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={all}
          onChange={(event) => changeAll(event.target.checked)}
        />
        Share with all eligible competitions
      </label>
      <p role="status">{selected.length} selected</p>
      {!competitions.length && (
        <p>No open joined competitions; this meal stays private.</p>
      )}
      {selected.length > 20 && (
        <p role="alert">
          Choose specific competitions to share with at most 20 at a time.
        </p>
      )}
      {!all && (
        <div role="group" aria-label="Choose competitions">
          {eligible.map((item) => (
            <div key={item.id}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  disabled={
                    !selected.includes(item.id) && selected.length >= 20
                  }
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
          {competitions.length > 20 && (
            <Pager
              page={page}
              hasMore={(page + 1) * 20 < competitions.length}
              change={setPage}
            />
          )}
        </div>
      )}
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

function MealForm({
  initial,
  displayName,
  profilePhotoId,
}: {
  initial?: api.Meal
  displayName: string
  profilePhotoId?: string | null
}) {
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
  const [mealDate, setMealDate] = useState(initialTime.local.slice(0, 10))
  const [mealTime, setMealTime] = useState(initialTime.local.slice(11, 16))
  const time = mealDate && mealTime ? `${mealDate}T${mealTime}` : ''
  const setTime = (local: string) => {
    setMealDate(local.slice(0, 10))
    setMealTime(local.slice(11, 16))
  }
  const [timeChanged, setTimeChanged] = useState(false)
  const [occurrence, setOccurrence] = useState<Occurrence>(
    initialTime.occurrence,
  )
  const [venueId, setVenue] = useState(revision?.venueId ?? '')
  const [venueLabel, setVenueLabel] = useState(
    revision?.venueId ? revision.location : '',
  )
  const initiallyAtHome =
    !revision ||
    (!revision.venueId && revision.location.trim().toLowerCase() === 'home')
  const [atHome, setAtHome] = useState(initiallyAtHome)
  const homeLocation = initiallyAtHome && revision ? revision.location : 'Home'
  const [location, setLocation] = useState(
    initiallyAtHome || revision?.venueId ? '' : (revision?.location ?? ''),
  )
  const selectedVenue = atHome ? '' : venueId
  const selectedLocation = atHome
    ? homeLocation
    : venueId
      ? venueLabel
      : location
  const [notes, setNotes] = useState(revision?.notes ?? '')
  const [count, setCount] = useState(
    revision ? String(revision.wholeHotDogs) : '',
  )
  const [length, setLength] = useState(
    revision ? formatInches(revision.totalHundredths) : '',
  )
  const [rows, setRows] = useState<HotDogRow[] | null>(() =>
    revision
      ? revision.items.length
        ? revision.items.map((item) => ({
            key: crypto.randomUUID(),
            name: item.name,
            inches: item.unitHundredths
              ? formatInches(item.unitHundredths)
              : '',
            wholeQuantity: item.wholeQuantity,
            partialHundredths: item.partialHundredths,
            condiments: item.condiments ?? [],
          }))
        : null
      : [newHotDog()],
  )
  const [includeLength, setIncludeLength] = useState(
    Boolean(revision?.totalHundredths),
  )
  const [previewTime] = useState(() => new Date().toISOString())
  const [photoIds, setPhotos] = useState(revision?.photoIds ?? [])
  const { connectInput, ...photos } = useMealPhotos(photoIds, setPhotos)
  const [allTargets, setAllTargets] = useState(true)
  const [customTargets, setTargets] = useState<string[]>([])
  const competitions = useQuery({
    queryKey: ['competitions', 'logging'],
    queryFn: ({ signal }) => loggingCompetitions(signal),
  })
  const modes = competitions.data?.map((item) => item.trackingMode) ?? []
  const eligibleIds = competitions.data?.map((item) => item.id) ?? []
  const targets = allTargets
    ? eligibleIds
    : customTargets.filter((id) => eligibleIds.includes(id))
  const tracksCount =
    modes.length === 0 || modes.some((mode) => mode !== 'LENGTH')
  const tracksLength = includeLength || modes.some((mode) => mode !== 'COUNT')
  const pendingRequest = useRef<{ payload: string; requestId: string } | null>(
    null,
  )
  const measurements = () => {
    const items = rows ? rowItems(rows) : []
    return {
      items,
      totalHundredths: rows
        ? items.reduce(
            (total, item) =>
              total +
              item.wholeQuantity * item.unitHundredths +
              item.partialHundredths,
            0,
          )
        : toHundredths(length || '0', 20199980),
      wholeHotDogs: rows
        ? items.reduce((total, item) => total + item.wholeQuantity, 0)
        : wholeQuantity(count || '0', 2000),
    }
  }
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
      if (Boolean(mealDate) !== Boolean(mealTime))
        throw new Error(
          'Choose both a meal date and time, or leave both blank.',
        )
      let eatenAt = revision?.eatenAt
      if (time && (!revision || timeChanged)) {
        const rounded = roundMealTime(time, zone, occurrence)
        setTime(rounded.local.slice(0, 16))
        setOccurrence(rounded.occurrence)
        eatenAt = toInstant(rounded.local, zone, rounded.occurrence)
      }
      if (timeChanged && !time) eatenAt = undefined
      const { items, totalHundredths, wholeHotDogs } = measurements()
      if (totalHundredths === 0 && wholeHotDogs === 0)
        throw new Error('Add a hot dog count or total inches before saving.')
      const body = {
        version: initial?.version ?? 0,
        content: {
          eatenAt,
          venueId: selectedVenue || null,
          location: selectedVenue ? '' : selectedLocation,
          notes,
          photoIds,
          items,
          ...(rows ? {} : { totalHundredths, wholeHotDogs }),
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
  let previewMeasurements: Pick<
    api.Revision,
    'items' | 'totalHundredths' | 'wholeHotDogs'
  > = {
    items:
      rows?.map((row) => ({
        name: row.name.trim() || 'Hotdog',
        unitHundredths: 0,
        wholeQuantity: row.wholeQuantity,
        partialHundredths: row.partialHundredths,
        condiments: row.condiments,
      })) ?? [],
    totalHundredths: 0,
    wholeHotDogs:
      rows?.reduce((total, row) => total + row.wholeQuantity, 0) ?? 0,
  }
  try {
    previewMeasurements = measurements()
  } catch {
    // Partial measurements are validated on save, not while typing.
  }
  let eatenAt =
    timeChanged && !time ? previewTime : (revision?.eatenAt ?? previewTime)
  if (time && (!revision || timeChanged)) {
    try {
      const rounded = roundMealTime(time, zone, occurrence)
      eatenAt = toInstant(rounded.local, zone, rounded.occurrence)
    } catch {
      // Keep the last stored time visible until a valid override is entered.
    }
  }
  const preview: api.Revision = {
    id: 'preview',
    version: 0,
    eatenAt,
    venueId: selectedVenue || null,
    location: selectedLocation,
    notes,
    photoIds,
    ...previewMeasurements,
  }
  return (
    <form
      className="competition-form meal-editor"
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        if (
          save.isPending ||
          photos.upload.isPending ||
          photos.discard.isPending ||
          photoIds.length > MAX_MEAL_PHOTOS ||
          targets.length > 20 ||
          !competitions.isSuccess
        )
          return
        save.mutate()
      }}
    >
      <fieldset disabled={save.isPending}>
        <legend className="sr-only">Log your meal</legend>
        <MealFeedCard
          label="Meal preview"
          displayName={displayName}
          profilePhotoId={profilePhotoId}
          subtitle={
            <span className="form-note">
              {targets.length
                ? `Sharing with ${targets.length} ${targets.length === 1 ? 'competition' : 'competitions'}`
                : 'Private meal'}
            </span>
          }
          revision={preview}
          photos={<MealPhotoDropzone selected={photoIds} photos={photos} />}
          actions={<span className="eyebrow">Preview</span>}
        />
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
        {rows ? (
          <HotDogInputs
            rows={rows}
            change={setRows}
            tracksLength={tracksLength}
          />
        ) : (
          <section className="competition-section">
            <div className="meal-section-heading">
              <h2>Recorded meal totals</h2>
              <InfoPopup title="About older meal totals">
                <p>
                  This meal was saved as aggregate totals, without individual
                  hot dog rows. Editing these fields keeps those measurements
                  intact.
                </p>
                <p>
                  Choose individual rows only if you want to replace those
                  totals with newly entered hot dogs.
                </p>
              </InfoPopup>
            </div>
            {(tracksCount || Boolean(revision?.wholeHotDogs)) && (
              <>
                <label htmlFor="meal-count">How many hot dogs?</label>
                <input
                  id="meal-count"
                  inputMode="numeric"
                  pattern="[0-9]+"
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
                  value={length}
                  onChange={(event) => setLength(event.target.value)}
                />
              </>
            )}
            <button
              type="button"
              className="text-button"
              onClick={() => setRows([newHotDog()])}
            >
              Replace totals with individual hot dogs
            </button>
          </section>
        )}
        {!modes.some((mode) => mode !== 'COUNT') && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeLength}
              onChange={(event) => setIncludeLength(event.target.checked)}
            />
            Include inches
          </label>
        )}
        <MealPhotoPicker
          selected={photoIds}
          change={setPhotos}
          photos={photos}
          connectInput={connectInput}
        />
        <section className="competition-section">
          <div className="meal-section-heading">
            <h2>Location</h2>
            <InfoPopup title="About meal locations">
              <p>Home is a label, not a stored address or GPS position.</p>
              <p>
                Location labels and selected venues are visible to members of
                competitions you choose, but private labels never enter the
                public venue directory.
              </p>
            </InfoPopup>
          </div>
          <fieldset className="meal-location-options">
            <legend className="sr-only">Meal location</legend>
            <label className="meal-location-choice">
              <input
                type="radio"
                name="meal-location-mode"
                checked={atHome}
                onChange={() => setAtHome(true)}
              />
              Home
            </label>
            <label className="meal-location-choice">
              <input
                type="radio"
                name="meal-location-mode"
                checked={!atHome}
                onChange={() => setAtHome(false)}
              />
              Somewhere else
            </label>
          </fieldset>
          {!atHome && (
            <>
              <MealVenuePicker
                selected={venueId}
                selectedLabel={venueLabel}
                change={(id, label) => {
                  setVenue(id)
                  setVenueLabel(label)
                }}
              />
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
            </>
          )}
          <details>
            <summary>Notes (optional)</summary>
            <label htmlFor="meal-notes">Notes</label>
            <textarea
              id="meal-notes"
              maxLength={2000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </details>
        </section>
        {competitions.data && (
          <Targets
            all={allTargets}
            changeAll={setAllTargets}
            selected={targets}
            change={setTargets}
            competitions={competitions.data}
          />
        )}
        <section className="competition-section">
          <div className="meal-section-heading">
            <h2>Meal date override</h2>
            <InfoPopup title="About the meal date">
              <p>
                Leave both fields blank to use the time you save. Entered times
                use your device's local time, rounded to the nearest 15 minutes
                without moving a past meal into the future.
              </p>
              <p>
                Existing precise timestamps stay unchanged unless you edit this
                field. Competition eating windows and submission deadlines still
                apply.
              </p>
            </InfoPopup>
          </div>
          <div className="meal-date-time">
            <div>
              <label htmlFor="meal-date">Meal date</label>
              <input
                id="meal-date"
                type="date"
                value={mealDate}
                onChange={(event) => {
                  setMealDate(event.target.value)
                  setTimeChanged(true)
                }}
                onBlur={roundTime}
              />
            </div>
            <div>
              <label htmlFor="meal-time">Meal time</label>
              <input
                id="meal-time"
                type="time"
                step="60"
                value={mealTime}
                onChange={(event) => {
                  setMealTime(event.target.value)
                  setTimeChanged(true)
                }}
                onBlur={roundTime}
              />
            </div>
          </div>
          <p className="form-note">
            Optional; leave both blank to use the save time.
          </p>
        </section>
        {initial && (
          <p className="form-notice">
            Closed and unselected submissions stay unchanged.
          </p>
        )}
        <button
          className="button"
          disabled={
            save.isPending ||
            photos.upload.isPending ||
            photos.discard.isPending ||
            photoIds.length > MAX_MEAL_PHOTOS ||
            targets.length > 20 ||
            !competitions.isSuccess
          }
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
    <section className="competition-page meal-editor-page">
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
                displayName={session.data.user.displayName}
                profilePhotoId={session.data.user.profilePhotoId}
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
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ['meals'] }),
      cache.invalidateQueries({ queryKey: ['feed'] }),
    ])
  }
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
