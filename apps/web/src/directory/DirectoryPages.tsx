import { lazy, Suspense, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { loadSession } from '../auth/api'
import * as api from './api'

const VenueMap = lazy(() => import('./VenueMap'))
function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => loadSession(signal),
    retry: false,
  })
}
function ErrorNotice({ error }: { error: Error | null }) {
  return error ? (
    <p className="form-error" role="alert">
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
        className="text-button"
        disabled={!page}
        onClick={() => change(page - 1)}
      >
        Previous page
      </button>
      <span>Page {page + 1}</span>
      <button
        className="text-button"
        disabled={!hasMore || page >= 1000}
        onClick={() => change(page + 1)}
      >
        Next page
      </button>
    </div>
  )
}

export function DirectoryPage() {
  const session = useSession()
  const [scope, setScope] = useState<'public' | api.Scope>('public')
  const [page, setPage] = useState(0)
  const [map, setMap] = useState(false)
  const venues = useQuery({
    queryKey: ['directory', 'venues', page],
    queryFn: ({ signal }) => api.listVenues(page, signal),
    enabled: scope === 'public',
  })
  const contributions = useQuery({
    queryKey: ['directory', 'contributions', scope, page],
    queryFn: ({ signal }) =>
      api.listContributions(scope as api.Scope, page, signal),
    enabled: scope !== 'public' && Boolean(session.data?.user),
  })
  const select = (value: typeof scope) => {
    setScope(value)
    setPage(0)
  }
  return (
    <section className="competition-page">
      <span className="eyebrow">Find your next spot</span>
      <h1>Venue directory</h1>
      <p>
        Community-listed sellers and menus, reviewed by the site owner. Listings
        do not guarantee current stock, prices, or opening hours.
      </p>
      <div className="competition-actions">
        <button
          className="text-button"
          aria-pressed={scope === 'public'}
          onClick={() => select('public')}
        >
          Approved venues
        </button>
        <button
          className="text-button"
          aria-pressed={scope === 'mine'}
          onClick={() => select('mine')}
        >
          My contributions
        </button>
        {session.data?.user?.siteOwner && (
          <>
            <button
              className="text-button"
              aria-pressed={scope === 'pending'}
              onClick={() => select('pending')}
            >
              Review queue
            </button>
            <button
              className="text-button"
              aria-pressed={scope === 'all'}
              onClick={() => select('all')}
            >
              All contributions
            </button>
          </>
        )}
        <Link className="button" to="/venues/new">
          Suggest a venue
        </Link>
      </div>
      {scope === 'public' ? (
        <>
          {venues.isPending && <p role="status">Loading venues...</p>}
          <ErrorNotice error={venues.error} />
          {venues.isError && (
            <button
              className="text-button"
              onClick={() => void venues.refetch()}
            >
              Try again
            </button>
          )}
          {venues.data && !venues.isError && (
            <>
              <button
                className="text-button"
                aria-expanded={map}
                onClick={() => setMap(!map)}
              >
                {map ? 'Hide map' : 'Load map (external tiles)'}
              </button>
              {map && (
                <Suspense fallback={<p role="status">Loading map...</p>}>
                  <VenueMap venues={venues.data.items} />
                </Suspense>
              )}
              {!venues.data.items.length && (
                <p>No approved venues yet. Suggest the first spot.</p>
              )}
              <div className="competition-grid">
                {venues.data.items.map((venue) => (
                  <article className="competition-card" key={venue.id}>
                    <h2>
                      <Link to={`/venues/${venue.id}`}>{venue.name}</Link>
                    </h2>
                    <p>{venue.address}</p>
                    {venue.photos[0] && (
                      <img
                        className="venue-thumbnail"
                        loading="lazy"
                        src={api.photoUrl(venue.photos[0].id)}
                        alt={`Community photo of ${venue.name}`}
                      />
                    )}
                  </article>
                ))}
              </div>
              <Pager
                page={page}
                hasMore={venues.data.hasMore}
                change={setPage}
              />
            </>
          )}
        </>
      ) : !session.data?.user ? (
        <p>
          <Link to="/sign-in">Sign in</Link> to view contributions.
        </p>
      ) : (
        <>
          {contributions.isPending && (
            <p role="status">Loading contributions...</p>
          )}
          <ErrorNotice error={contributions.error} />
          {contributions.data && !contributions.isError && (
            <>
              {!contributions.data.items.length && (
                <p>No contributions here yet.</p>
              )}
              <ul className="member-list">
                {contributions.data.items.map((item) => (
                  <li key={item.id}>
                    <Link to={`/directory/contributions/${item.id}`}>
                      {item.venue.name}
                    </Link>{' '}
                    / {item.status.toLowerCase()}
                  </li>
                ))}
              </ul>
              <Pager
                page={page}
                hasMore={contributions.data.hasMore}
                change={setPage}
              />
            </>
          )}
        </>
      )}
    </section>
  )
}

function VenueContent({ venue }: { venue: api.Venue }) {
  return (
    <>
      <p>{venue.address}</p>
      <p className="competition-rules">{venue.description}</p>
      <p className="form-note">
        Pin: {venue.latitude}, {venue.longitude}. Community-supplied location;
        verify before traveling.
      </p>
      <h2>Menu items</h2>
      {!venue.menuItems.length && <p>No menu items listed yet.</p>}
      <ul className="member-list">
        {venue.menuItems.map((item) => (
          <li key={item.id}>
            <strong>{item.name}</strong>
            <p>{item.description}</p>
          </li>
        ))}
      </ul>
      <h2>Menu and venue photos</h2>
      {!venue.photos.length && <p>No photos attached.</p>}
      <div className="photo-gallery">
        {venue.photos.map((photo) => {
          const label =
            venue.menuItems.find((item) => item.id === photo.menuItemId)
              ?.name ?? venue.name
          return (
            <figure key={photo.id}>
              <a href={api.photoUrl(photo.id, false)}>
                <img
                  loading="lazy"
                  src={api.photoUrl(photo.id)}
                  alt={`Community photo: ${label}`}
                />
              </a>
              <figcaption>{label}</figcaption>
            </figure>
          )
        })}
      </div>
    </>
  )
}

function VisibilityControls({ venueId }: { venueId: string }) {
  const [reason, setReason] = useState('')
  const cache = useQueryClient()
  const save = useMutation({
    mutationFn: (hidden: boolean) => api.setVisibility(venueId, hidden, reason),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['directory'] }),
  })
  return (
    <section className="competition-section">
      <h2>Listing visibility</h2>
      <p>
        Hiding removes this listing and its photos from public pages and
        featured lists. Contributors and the site owner retain private access.
      </p>
      <label htmlFor="visibility-reason">Visibility change reason</label>
      <input
        id="visibility-reason"
        maxLength={500}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="competition-actions">
        <button
          className="text-button"
          disabled={save.isPending || !reason.trim()}
          onClick={() => save.mutate(true)}
        >
          Hide listing
        </button>
        <button
          className="text-button"
          disabled={save.isPending || !reason.trim()}
          onClick={() => save.mutate(false)}
        >
          Restore listing
        </button>
      </div>
      <ErrorNotice error={save.error} />
      {save.isSuccess && <p role="status">Visibility updated.</p>}
    </section>
  )
}

export function VenuePage() {
  const { id = '' } = useParams()
  const session = useSession()
  const detail = useQuery({
    queryKey: ['directory', 'venue', id],
    queryFn: ({ signal }) => api.getVenue(id, signal),
    retry: false,
  })
  return (
    <section className="competition-page">
      <Link to="/venues">Venue directory</Link>
      {detail.isPending && <p role="status">Loading venue...</p>}
      <ErrorNotice error={detail.error} />
      {detail.data && !detail.isError && (
        <>
          <h1>{detail.data.name}</h1>
          <VenueContent venue={detail.data} />
          <Link className="button secondary" to={`/venues/${id}/suggest`}>
            Suggest an update
          </Link>
          {session.data?.user?.siteOwner && <VisibilityControls venueId={id} />}
        </>
      )}
    </section>
  )
}

function ContributionForm({ initial }: { initial?: api.Venue }) {
  const navigate = useNavigate()
  const [name, setName] = useState(initial?.name ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [latitude, setLatitude] = useState(initial?.latitude.toString() ?? '')
  const [longitude, setLongitude] = useState(
    initial?.longitude.toString() ?? '',
  )
  const [menu, setMenu] = useState<api.DirectoryInput['menuItems']>(
    initial?.menuItems.map(({ name, description }) => ({
      name,
      description,
    })) ?? [],
  )
  const save = useMutation({
    mutationFn: () =>
      api.createContribution({
        ...(initial
          ? { venueId: initial.id, baseRevision: initial.revision }
          : {}),
        name,
        address,
        description,
        latitude: Number(latitude),
        longitude: Number(longitude),
        menuItems: menu,
      }),
    onSuccess: (result) => navigate(`/directory/contributions/${result.id}`),
  })
  return (
    <form
      className="competition-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <p>
        Only suggest places and photos you intend to make public. Keep home
        addresses and private meal locations out of this directory.
      </p>
      {initial && (
        <p className="form-notice">
          Approval replaces the entire listing, including its photos. Reattach
          any photos you want included. The current public listing stays
          unchanged during review.
        </p>
      )}
      <label htmlFor="venue-name">Venue name</label>
      <input
        id="venue-name"
        required
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor="venue-address">Public address</label>
      <input
        id="venue-address"
        required
        maxLength={300}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
      />
      <label htmlFor="venue-description">Description</label>
      <textarea
        id="venue-description"
        maxLength={2000}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <p className="form-note">
        Enter a known map pin; no address search or geocoding service is used.
      </p>
      <label htmlFor="venue-latitude">Latitude</label>
      <input
        id="venue-latitude"
        type="number"
        step="any"
        min="-90"
        max="90"
        required
        value={latitude}
        onChange={(event) => setLatitude(event.target.value)}
      />
      <label htmlFor="venue-longitude">Longitude</label>
      <input
        id="venue-longitude"
        type="number"
        step="any"
        min="-180"
        max="180"
        required
        value={longitude}
        onChange={(event) => setLongitude(event.target.value)}
      />
      <h2>Menu items</h2>
      {menu.map((item, index) => (
        <fieldset key={index}>
          <legend>Item {index + 1}</legend>
          <label htmlFor={`menu-name-${index}`}>Item {index + 1} name</label>
          <input
            id={`menu-name-${index}`}
            required
            maxLength={120}
            value={item.name}
            onChange={(event) =>
              setMenu(
                menu.map((value, i) =>
                  i === index ? { ...value, name: event.target.value } : value,
                ),
              )
            }
          />
          <label htmlFor={`menu-description-${index}`}>
            Item {index + 1} description
          </label>
          <textarea
            id={`menu-description-${index}`}
            maxLength={1000}
            value={item.description}
            onChange={(event) =>
              setMenu(
                menu.map((value, i) =>
                  i === index
                    ? { ...value, description: event.target.value }
                    : value,
                ),
              )
            }
          />
          <button
            type="button"
            className="text-button"
            onClick={() => setMenu(menu.filter((_, i) => i !== index))}
          >
            Remove item {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="text-button"
        disabled={menu.length >= 20}
        onClick={() => setMenu([...menu, { name: '', description: '' }])}
      >
        Add menu item
      </button>
      <p>
        Next: attach optional photos and explicitly submit for site-owner
        review.
      </p>
      <button className="button" disabled={save.isPending}>
        Save private draft
      </button>
      <ErrorNotice error={save.error} />
    </form>
  )
}

export function ContributionEditorPage() {
  const { id } = useParams()
  const session = useSession()
  const initial = useQuery({
    queryKey: ['directory', 'venue', id],
    queryFn: ({ signal }) => api.getVenue(id!, signal),
    enabled: Boolean(id),
    retry: false,
  })
  return (
    <section className="competition-page">
      <Link to="/venues">Venue directory</Link>
      <h1>{id ? 'Suggest a listing update' : 'Suggest a venue'}</h1>
      {session.isPending ? (
        <p role="status">Loading account...</p>
      ) : !session.data?.user ? (
        <p>
          <Link to="/sign-in">Sign in</Link> to contribute.
        </p>
      ) : id && initial.isPending ? (
        <p role="status">Loading venue...</p>
      ) : (
        <>
          <ErrorNotice error={initial.error} />
          {(!id || initial.data) && !initial.isError && (
            <ContributionForm
              key={initial.data?.revision ?? 'new'}
              initial={initial.data}
            />
          )}
        </>
      )}
    </section>
  )
}

function DraftActions({
  item,
  refresh,
}: {
  item: api.Contribution
  refresh: () => Promise<unknown>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [menuItem, setMenuItem] = useState('')
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a photo first.')
      if (file.size > 5 * 1024 * 1024)
        throw new Error('Choose a photo no larger than 5 MiB.')
      return api.uploadPhoto(item.id, file, menuItem)
    },
    onSuccess: refresh,
  })
  const submit = useMutation({
    mutationFn: () => api.submitContribution(item.id),
    onSuccess: refresh,
  })
  return (
    <section className="competition-section">
      <h2>Optional photos</h2>
      <p>
        JPEG/PNG only, up to 5 MiB and 12 megapixels (6000 pixels per side).
        Location and other metadata are removed. Upload only photos you have
        permission to publish.
      </p>
      <form
        className="competition-form"
        onSubmit={(event) => {
          event.preventDefault()
          upload.mutate()
        }}
      >
        <label htmlFor="photo-file">Photo file</label>
        <input
          id="photo-file"
          type="file"
          accept="image/jpeg,image/png"
          required
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <label htmlFor="photo-menu">Photo subject</label>
        <select
          id="photo-menu"
          value={menuItem}
          onChange={(event) => setMenuItem(event.target.value)}
        >
          <option value="">Venue or whole menu</option>
          {item.venue.menuItems.map((menu) => (
            <option key={menu.id} value={menu.id}>
              {menu.name}
            </option>
          ))}
        </select>
        <button
          className="button secondary"
          disabled={
            upload.isPending ||
            submit.isPending ||
            item.venue.photos.length >= 10
          }
        >
          Upload photo
        </button>
        <ErrorNotice error={upload.error} />
        {upload.isSuccess && (
          <p role="status">Photo attached to this private draft.</p>
        )}
      </form>
      <p>
        Submitting locks this draft and its photos. Nothing becomes public until
        the site owner approves it.
      </p>
      <button
        className="button"
        disabled={upload.isPending || submit.isPending}
        onClick={() => submit.mutate()}
      >
        Submit for review
      </button>
      <ErrorNotice error={submit.error} />
    </section>
  )
}

function ReviewActions({
  id,
  refresh,
}: {
  id: string
  refresh: () => Promise<unknown>
}) {
  const [reason, setReason] = useState('')
  const review = useMutation({
    mutationFn: (approve: boolean) =>
      api.reviewContribution(id, approve, reason),
    onSuccess: refresh,
  })
  return (
    <section className="competition-section">
      <h2>Site-owner review</h2>
      <label htmlFor="review-reason">Review reason</label>
      <input
        id="review-reason"
        maxLength={500}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="competition-actions">
        <button
          className="button"
          disabled={review.isPending || !reason.trim()}
          onClick={() => review.mutate(true)}
        >
          Approve listing
        </button>
        <button
          className="text-button"
          disabled={review.isPending || !reason.trim()}
          onClick={() => review.mutate(false)}
        >
          Reject suggestion
        </button>
      </div>
      <ErrorNotice error={review.error} />
    </section>
  )
}

export function ContributionPage() {
  const { id = '' } = useParams()
  const session = useSession()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const refresh = () => cache.invalidateQueries({ queryKey: ['directory'] })
  const detail = useQuery({
    queryKey: ['directory', 'contribution', id],
    queryFn: ({ signal }) => api.getContribution(id, signal),
    enabled: Boolean(session.data?.user),
    retry: false,
  })
  const discard = useMutation({
    mutationFn: () => api.discardContribution(id),
    onSuccess: async () => {
      await refresh()
      navigate('/venues')
    },
  })
  const item = detail.data
  return (
    <section className="competition-page">
      <Link to="/venues">Venue directory</Link>
      {!session.data?.user ? (
        <p>
          <Link to="/sign-in">Sign in</Link> to view this private contribution.
        </p>
      ) : (
        <>
          {detail.isPending && <p role="status">Loading contribution...</p>}
          <ErrorNotice error={detail.error} />
          {item && !detail.isError && (
            <>
              <span className="eyebrow competition-label">
                {item.status.toLowerCase()}
              </span>
              <h1>{item.venue.name}</h1>
              <p>Contribution preview. This is not a public directory page.</p>
              {item.reviewReason && (
                <p className="form-notice">Review: {item.reviewReason}</p>
              )}
              <VenueContent venue={item.venue} />
              {item.status === 'DRAFT' && item.own && (
                <DraftActions item={item} refresh={refresh} />
              )}
              {item.status === 'PENDING' && (
                <p role="status">
                  Awaiting site-owner review. The listing and its photos are not
                  published by this submission.
                </p>
              )}
              {item.status === 'PENDING' && session.data.user.siteOwner && (
                <ReviewActions id={id} refresh={refresh} />
              )}
              {item.status === 'APPROVED' && (
                <>
                  <Link to={`/venues/${item.venue.id}`}>
                    View current public listing
                  </Link>
                  {session.data.user.siteOwner && (
                    <VisibilityControls venueId={item.venue.id} />
                  )}
                </>
              )}
              {item.status !== 'APPROVED' && item.own && (
                <>
                  <p>
                    Discarding removes this contribution and its photos, not the
                    current approved listing.
                  </p>
                  <button
                    className="text-button"
                    disabled={discard.isPending}
                    onClick={() => discard.mutate()}
                  >
                    Discard contribution
                  </button>
                  <ErrorNotice error={discard.error} />
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

export function FeaturedVenues({
  competitionId,
  organizer,
}: {
  competitionId: string
  organizer: boolean
}) {
  const cache = useQueryClient()
  const [venue, setVenue] = useState('')
  const [page, setPage] = useState(0)
  const featured = useQuery({
    queryKey: ['directory', 'featured', competitionId],
    queryFn: ({ signal }) => api.listFeatured(competitionId, signal),
  })
  const available = useQuery({
    queryKey: ['directory', 'venues', page],
    queryFn: ({ signal }) => api.listVenues(page, signal),
    enabled: organizer,
  })
  const change = useMutation({
    mutationFn: ({ id, add }: { id: string; add: boolean }) =>
      api.featureVenue(competitionId, id, add),
    onSuccess: () =>
      cache.invalidateQueries({
        queryKey: ['directory', 'featured', competitionId],
      }),
  })
  return (
    <section className="competition-section">
      <h2>Featured venues</h2>
      <ErrorNotice error={featured.error} />
      {featured.isPending && <p role="status">Loading featured venues...</p>}
      {featured.data && Array.isArray(featured.data) && (
        <>
          {!featured.data.length && <p>No featured venues yet.</p>}
          <ul className="member-list">
            {featured.data.map((item) => (
              <li key={item.id}>
                <Link to={`/venues/${item.id}`}>{item.name}</Link> /{' '}
                {item.address}
                {organizer && (
                  <button
                    className="text-button"
                    disabled={change.isPending}
                    onClick={() => change.mutate({ id: item.id, add: false })}
                  >
                    Remove {item.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {organizer && (
        <>
          <p>
            Choose up to 20 approved listings. Hidden venues automatically
            disappear.
          </p>
          <ErrorNotice error={available.error} />
          {available.data && Array.isArray(available.data.items) && (
            <>
              <label htmlFor="featured-venue">Approved venue to feature</label>
              <select
                id="featured-venue"
                value={venue}
                onChange={(event) => setVenue(event.target.value)}
              >
                <option value="">Choose a venue</option>
                {available.data.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} / {item.address}
                  </option>
                ))}
              </select>
              <button
                className="text-button"
                disabled={!venue || change.isPending}
                onClick={() => change.mutate({ id: venue, add: true })}
              >
                Feature venue
              </button>
              <Pager
                page={page}
                hasMore={available.data.hasMore}
                change={(value) => {
                  setPage(value)
                  setVenue('')
                }}
              />
            </>
          )}
          <ErrorNotice error={change.error} />
        </>
      )}
    </section>
  )
}
