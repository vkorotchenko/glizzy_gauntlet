import { lazy, Suspense, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { mapVenues, type Venue } from '../directory/api'
import { InfoPopup } from './MealInputs'

const VenueMap = lazy(() => import('../directory/VenueMap'))

type Position = { latitude: number; longitude: number }

function distanceKm(from: Position, to: Position) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const value =
    Math.sin(radians(to.latitude - from.latitude) / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(radians(to.longitude - from.longitude) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, value))))
}

export function MealVenuePicker({
  selected,
  selectedLabel,
  change,
}: {
  selected: string
  selectedLabel: string
  change: (id: string, label: string) => void
}) {
  const venues = useQuery({
    queryKey: ['directory', 'meal-venues'],
    queryFn: ({ signal }) => mapVenues(signal),
  })
  const [position, setPosition] = useState<Position | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(10)
  const [view, setView] = useState<'list' | 'map'>('list')
  const locate = () => {
    setLocationError('')
    if (!navigator.geolocation) {
      setLocationError(
        'Location is unavailable in this browser; choose a venue manually.',
      )
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setPosition({ latitude: coords.latitude, longitude: coords.longitude })
        setShown(10)
        setLocating(false)
      },
      (error) => {
        setLocationError(
          error.code === 1
            ? 'Location permission was denied; you can still choose a venue manually.'
            : 'Your location could not be found; choose a venue manually or try again.',
        )
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  }
  const query = search.trim().toLocaleLowerCase()
  const matchingVenues = useMemo(
    () =>
      (venues.data ?? []).filter((venue) =>
        `${venue.name} ${venue.address}`.toLocaleLowerCase().includes(query),
      ),
    [venues.data, query],
  )
  const matches = matchingVenues
    .map((venue) => ({
      venue,
      distance: position ? distanceKm(position, venue) : null,
    }))
    .sort(
      (a, b) =>
        (a.distance ?? 0) - (b.distance ?? 0) ||
        a.venue.name.localeCompare(b.venue.name) ||
        a.venue.id.localeCompare(b.venue.id),
    )
  const visible = matches.slice(0, shown)
  const saved = venues.data?.find((venue) => venue.id === selected)
  const choice = (venue: Venue, distance: number | null) => (
    <li key={venue.id}>
      <label className="venue-choice">
        <input
          type="radio"
          name="meal-venue"
          checked={selected === venue.id}
          onChange={() => change(venue.id, `${venue.name} / ${venue.address}`)}
        />
        <span>
          <strong>{venue.name}</strong>
          <span className="venue-choice-address">{venue.address}</span>
        </span>
        {distance !== null && (
          <small>
            {distance < 1
              ? `${Math.round(distance * 1000)} m`
              : `${distance.toFixed(1)} km`}
          </small>
        )}
      </label>
    </li>
  )
  return (
    <fieldset className="meal-venue-picker">
      <legend>Approved venue (optional)</legend>
      <div className="meal-section-heading">
        <div role="group" aria-label="Venue view" className="venue-view-switch">
          <button
            type="button"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            type="button"
            aria-pressed={view === 'map'}
            onClick={() => setView('map')}
          >
            Map
          </button>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={locating}
          onClick={locate}
        >
          {locating
            ? 'Finding your location...'
            : position
              ? 'Update my location'
              : 'Use my location'}
        </button>
        <InfoPopup title="About nearby venues">
          <p>
            Location permission is only requested when you choose this button.
            Distance is straight-line distance, not a travel route.
          </p>
          <p>
            Your coordinates stay in this page's memory and are not sent to the
            server or saved with your meal.
          </p>
          <p>
            You can choose a venue manually without granting location
            permission.
          </p>
          <p>
            Map view loads OpenFreeMap tiles with OpenStreetMap data only when
            you select Map. Home does not use a map or request your location.
          </p>
        </InfoPopup>
      </div>
      <p className="form-note">
        {position
          ? view === 'list'
            ? 'Closest venues first.'
            : 'Choose a venue pin; switch to List for closest venues first.'
          : 'Venues are alphabetical until you choose to use your location.'}
      </p>
      {locationError && <p role="status">{locationError}</p>}
      <label htmlFor="meal-venue-search">Find a venue</label>
      <input
        id="meal-venue-search"
        type="search"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value)
          setShown(10)
        }}
      />
      {venues.isPending && <p role="status">Loading venues...</p>}
      {venues.error && (
        <>
          <p role="alert" className="form-error">
            {venues.error.message}
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => void venues.refetch()}
          >
            Retry venues
          </button>
        </>
      )}
      {view === 'map' && matchingVenues.length > 0 && (
        <Suspense fallback={<p role="status">Loading map...</p>}>
          <VenueMap
            venues={matchingVenues}
            selectedId={selected}
            onSelect={(venue) =>
              change(venue.id, `${venue.name} / ${venue.address}`)
            }
          />
        </Suspense>
      )}
      <ul className="venue-choices">
        <li>
          <label className="venue-choice">
            <input
              type="radio"
              name="meal-venue"
              checked={!selected}
              onChange={() => change('', '')}
            />
            No venue / private location label
          </label>
        </li>
        {selected &&
          (view === 'map' ||
            !visible.some(({ venue }) => venue.id === selected)) &&
          (saved ? (
            choice(saved, position ? distanceKm(position, saved) : null)
          ) : (
            <li>
              <label className="venue-choice">
                <input type="radio" name="meal-venue" checked readOnly />
                Saved venue: {selectedLabel || 'Previously selected venue'}
              </label>
            </li>
          ))}
        {view === 'list' &&
          visible.map(({ venue, distance }) => choice(venue, distance))}
      </ul>
      {venues.isSuccess && !matches.length && <p>No matching venues.</p>}
      {view === 'list' && matches.length > shown && (
        <button
          type="button"
          className="text-button"
          onClick={() => setShown(shown + 10)}
        >
          Show more venues
        </button>
      )}
    </fieldset>
  )
}
