import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { loadSession } from '../auth/api'
import { PageHeading } from '../PageHeading'
import * as api from './api'
import {
  CompetitionCover,
  CompetitionCoverEditor,
  CompetitionCoverInput,
} from './CompetitionCover'
import { FeaturedVenues } from '../directory/DirectoryPages'
import { CompetitionMeals } from '../meals/MealPages'
import { Standings } from '../progress/ProgressPages'
import {
  formatTime,
  fromInstant,
  supportsTimeZone,
  toInstant,
  type Occurrence,
} from './time'

const phases: Record<api.Competition['phase'], string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Eating window open',
  GRACE: 'Logging grace period',
  CLOSED: 'Submissions closed',
  FINALIZED: 'Final results',
  REVISED: 'Revised results',
}

function ErrorNotice({ error }: { error: Error | null }) {
  return error ? (
    <p role="alert" className="form-error">
      {error.message}
    </p>
  ) : null
}

function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => loadSession(signal),
    retry: false,
  })
}

function useRefresh() {
  const cache = useQueryClient()
  return () => cache.invalidateQueries({ queryKey: ['competitions'] })
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
        disabled={page === 0}
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

function CompetitionList({
  scope,
}: {
  scope: Parameters<typeof api.listCompetitions>[0]
}) {
  const [page, setPage] = useState(0)
  const list = useQuery({
    queryKey: ['competitions', 'list', scope, page],
    queryFn: ({ signal }) => api.listCompetitions(scope, page, signal),
  })
  return (
    <>
      {list.isPending && <p role="status">Loading competitions...</p>}
      <ErrorNotice error={list.error} />
      {list.isError && (
        <button className="text-button" onClick={() => void list.refetch()}>
          Try again
        </button>
      )}
      {!list.isError && list.data && (
        <>
          {list.data.items.length === 0 && (
            <p>
              {scope === 'administered'
                ? 'No competitions to administer yet.'
                : 'No competitions here yet.'}
            </p>
          )}
          <div className="competition-grid">
            {list.data.items.map((item) => (
              <article className="competition-card" key={item.id}>
                <CompetitionCover competition={item} thumbnail />
                <span className="eyebrow">
                  {phases[item.phase]} /{' '}
                  {item.visibility === 'PUBLIC' ? 'Public' : 'Private'}
                </span>
                <h2>
                  <Link to={`/competitions/${item.id}`}>{item.name}</Link>
                </h2>
                <p>
                  {item.allTime ? (
                    'All time / No end date'
                  ) : (
                    <>
                      {formatTime(item.startsAt, item.timeZone)} to{' '}
                      {formatTime(item.endsAt, item.timeZone)}
                    </>
                  )}
                </p>
                <p>
                  {item.memberCount} joined / {item.timeZone}
                </p>
              </article>
            ))}
          </div>
          <Pager page={page} hasMore={list.data.hasMore} change={setPage} />
        </>
      )}
    </>
  )
}

export function CompetitionsPage() {
  const session = useSession()
  return (
    <section className="competition-page">
      <span className="eyebrow">Find your crew</span>
      <PageHeading title="Competitions">
        <Link
          className="button"
          to={session.data?.user ? '/competitions/new' : '/learn/competitions'}
        >
          Create a competition
        </Link>
      </PageHeading>
      <p>
        Track hot dog count, measured inches, or both. Eat at your own pace.
      </p>
      {session.data?.user && (
        <section
          className="competition-section"
          aria-labelledby="joined-competitions"
        >
          <h2 id="joined-competitions">My competitions</h2>
          <p>
            Your joined competitions. Manage drafts and your full history from
            your profile.
          </p>
          <CompetitionList scope="joined" />
        </section>
      )}
      <section
        className="competition-section"
        aria-labelledby="public-competitions"
      >
        <h2 id="public-competitions">Public competitions</h2>
        <CompetitionList scope="public" />
      </section>
    </section>
  )
}

export function MyCompetitionsPage() {
  return (
    <section className="competition-page">
      <Link to="/account">Your profile</Link>
      <PageHeading title="My competitions">
        <Link className="button" to="/competitions/new">
          Create a competition
        </Link>
      </PageHeading>
      <p>
        Your organized competitions, other memberships, and competition history.
      </p>
      <section
        className="competition-section"
        aria-labelledby="administered-competitions"
      >
        <h2 id="administered-competitions">Competitions I administer</h2>
        <CompetitionList scope="administered" />
      </section>
      <section
        className="competition-section"
        aria-labelledby="participating-competitions"
      >
        <h2 id="participating-competitions">Other competitions</h2>
        <CompetitionList scope="participating" />
      </section>
    </section>
  )
}

function CompetitionForm({
  initial,
  emailEnabled,
}: {
  initial?: api.Competition
  emailEnabled: boolean
}) {
  const navigate = useNavigate()
  const refresh = useRefresh()
  const [name, setName] = useState(initial?.name ?? '')
  const [rules, setRules] = useState(initial?.rules ?? '')
  const [visibility, setVisibility] = useState<api.Settings['visibility']>(
    initial?.visibility ?? 'PRIVATE',
  )
  const [zone, setZone] = useState(
    initial?.timeZone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      'UTC',
  )
  const first = initial ? fromInstant(initial.startsAt, initial.timeZone) : null
  const last = initial?.endsAt
    ? fromInstant(initial.endsAt, initial.timeZone)
    : null
  const [start, setStart] = useState(first?.local ?? '')
  const [end, setEnd] = useState(last?.local ?? '')
  const [startOccurrence, setStartOccurrence] = useState<Occurrence>(
    first?.occurrence ?? 'reject',
  )
  const [endOccurrence, setEndOccurrence] = useState<Occurrence>(
    last?.occurrence ?? 'reject',
  )
  const [sharing, setSharing] = useState(initial?.allowSharedMeals ?? false)
  const [trackingMode, setTrackingMode] = useState<api.TrackingMode>(
    initial?.trackingMode ?? 'BOTH',
  )
  const [emails, setEmails] = useState('')
  const [cover, setCover] = useState<File | null>(null)
  const save = useMutation({
    mutationFn: async () => {
      const settings: api.Settings = {
        name,
        rules,
        visibility,
        timeZone: zone,
        startsAt: toInstant(start, zone, startOccurrence),
        endsAt: toInstant(end, zone, endOccurrence),
        allowSharedMeals: sharing,
        trackingMode,
      }
      if (initial)
        return api.updateCompetition(initial.id, initial.version, settings)
      const recipients = [
        ...new Set(
          emails
            .split(/[\s,;]+/)
            .filter(Boolean)
            .map((email) => email.toLowerCase()),
        ),
      ]
      if (
        recipients.length > 20 ||
        recipients.some(
          (email) =>
            email.length > 254 ||
            !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(email),
        )
      )
        throw new Error(
          'Enter up to 20 valid email addresses, separated by commas, spaces, or new lines.',
        )
      return api.createCompetition(settings, recipients, cover)
    },
    onSuccess: async (result) => {
      await refresh()
      navigate(`/competitions/${result.id}`, {
        state: { showEmailInvitations: !initial && Boolean(emails.trim()) },
      })
    },
  })
  const timeField = (
    label: string,
    value: string,
    change: (value: string) => void,
    occurrence: Occurrence,
    choose: (value: Occurrence) => void,
  ) => (
    <div className="time-field">
      <label htmlFor={`time-${label.replaceAll(' ', '-')}`}>{label}</label>
      <input
        id={`time-${label.replaceAll(' ', '-')}`}
        type="datetime-local"
        step="0.001"
        required
        value={value}
        onChange={(event) => change(event.target.value)}
      />
      <label htmlFor={`occurrence-${label.replaceAll(' ', '-')}`}>
        {label}: repeated hour
      </label>
      <select
        id={`occurrence-${label.replaceAll(' ', '-')}`}
        value={occurrence}
        onChange={(event) => choose(event.target.value as Occurrence)}
      >
        <option value="reject">Require an unambiguous time</option>
        <option value="earlier">First occurrence</option>
        <option value="later">Second occurrence</option>
      </select>
    </div>
  )
  return (
    <form
      className="competition-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <label htmlFor="competition-name">Competition name</label>
      <input
        id="competition-name"
        required
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      {!initial && (
        <CompetitionCoverInput
          file={cover}
          change={setCover}
          disabled={save.isPending}
        />
      )}
      <label htmlFor="competition-rules">Written rules</label>
      <textarea
        id="competition-rules"
        rows={5}
        maxLength={5000}
        value={rules}
        onChange={(event) => setRules(event.target.value)}
      />
      <label htmlFor="visibility">Visibility</label>
      <select
        id="visibility"
        value={visibility}
        onChange={(event) =>
          setVisibility(event.target.value as api.Settings['visibility'])
        }
      >
        <option value="PRIVATE">Private: invitation required</option>
        <option value="PUBLIC">Public: anyone can discover and join</option>
      </select>
      <label htmlFor="tracking-mode">What are you tracking?</label>
      <select
        id="tracking-mode"
        value={trackingMode}
        onChange={(event) =>
          setTrackingMode(event.target.value as api.TrackingMode)
        }
      >
        <option value="COUNT">Hot dog count</option>
        <option value="LENGTH">Length in inches</option>
        <option value="BOTH">Count and length</option>
      </select>
      <p className="form-note">
        Count competitions rank by hot dogs. Length and combined competitions
        rank by inches; counts never break ties.
      </p>
      <label htmlFor="time-zone">Competition time zone</label>
      <input
        id="time-zone"
        required
        maxLength={80}
        value={zone}
        onChange={(event) => setZone(event.target.value)}
        placeholder="America/New_York"
      />
      <p className="form-note">
        All dates below use this IANA time zone, not your device zone. Skipped
        daylight-saving times are rejected; choose an occurrence for a repeated
        hour.
      </p>
      {timeField(
        'Eating starts',
        start,
        setStart,
        startOccurrence,
        setStartOccurrence,
      )}
      {timeField('Eating ends', end, setEnd, endOccurrence, setEndOccurrence)}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={sharing}
          onChange={(event) => setSharing(event.target.checked)}
        />
        Allow the same meal in other competitions that also permit sharing
      </label>
      <p className="form-note">
        Joining closes when eating ends. Eligible submissions have another 24
        elapsed hours. All settings lock when the published eating window
        starts.
      </p>
      {!initial && (
        <>
          <label htmlFor="invitation-emails">Invite by email (optional)</label>
          <textarea
            id="invitation-emails"
            rows={4}
            maxLength={6000}
            disabled={!emailEnabled}
            value={emails}
            onChange={(event) => setEmails(event.target.value)}
            aria-describedby="invitation-emails-hint"
          />
          <p id="invitation-emails-hint" className="form-note">
            {emailEnabled
              ? 'Add up to 20 email addresses, separated by commas, spaces, or new lines. Duplicates are removed. Invitations are sent only when you publish, and recipients must sign in and accept to join. Recipients cannot see each other.'
              : 'Email invitations require configured email delivery. You can still create a draft and share invitation links after publishing.'}
          </p>
        </>
      )}
      <button className="button" disabled={save.isPending}>
        {save.isPending
          ? 'Saving...'
          : initial
            ? 'Save settings'
            : 'Save draft'}
      </button>
      <ErrorNotice error={save.error} />
    </form>
  )
}

export function CompetitionEditorPage() {
  const { id } = useParams()
  const session = useSession()
  const detail = useQuery({
    queryKey: ['competitions', 'detail', id],
    queryFn: ({ signal }) => api.getCompetition(id!, signal),
    enabled: Boolean(id),
  })
  return (
    <section className="competition-page narrow">
      <Link to={id ? `/competitions/${id}` : '/competitions'}>
        Back to competitions
      </Link>
      <PageHeading
        title={id ? 'Competition settings' : 'Create a competition'}
      />
      {session.isPending && <p role="status">Loading your account...</p>}
      <ErrorNotice error={session.error} />
      {session.data && !session.data.user && (
        <p>
          <Link to="/sign-in">Sign in</Link> to create or manage a competition.
        </p>
      )}
      {session.data?.user && (
        <>
          <ErrorNotice error={detail.error} />
          {id && detail.isPending && <p role="status">Loading settings...</p>}
          {!id ? (
            <CompetitionForm emailEnabled={session.data.emailEnabled} />
          ) : (
            detail.data &&
            !detail.isError &&
            (detail.data.viewerRole !== 'ORGANIZER' ? (
              <p role="alert">Only the organizer can edit settings.</p>
            ) : !['DRAFT', 'SCHEDULED'].includes(detail.data.phase) ? (
              <p>Settings locked when eating started.</p>
            ) : !supportsTimeZone(detail.data.timeZone) ? (
              <p role="alert">
                This browser does not support the competition time zone. Use an
                updated browser to edit its dates safely.
              </p>
            ) : (
              <CompetitionForm
                key={`${id}-${detail.data.version}`}
                initial={detail.data}
                emailEnabled={session.data.emailEnabled}
              />
            ))
          )}
        </>
      )}
    </section>
  )
}

function MemberEntry({
  member,
  competition,
}: {
  member: api.Member
  competition: api.Competition
}) {
  const refresh = useRefresh()
  const [reason, setReason] = useState('')
  const exclude = useMutation({
    mutationFn: () => api.excludeMember(competition.id, member.id, reason),
    onSuccess: refresh,
  })
  return (
    <li className="member-row">
      <strong>{member.displayName}</strong> /{' '}
      {member.role === 'ORGANIZER'
        ? competition.allTime
          ? 'Admin'
          : 'Organizer'
        : 'Participant'}{' '}
      / {member.status === 'ACTIVE' ? 'Joined' : 'Excluded'}
      {competition.canAdminister &&
        member.role !== 'ORGANIZER' &&
        member.status === 'ACTIVE' && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              exclude.mutate()
            }}
          >
            <label htmlFor={`reason-${member.id}`}>
              Exclusion reason for {member.displayName}
            </label>
            <input
              id={`reason-${member.id}`}
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <button
              className="text-button"
              disabled={exclude.isPending || !reason.trim()}
            >
              Exclude participant
            </button>
            <ErrorNotice error={exclude.error} />
          </form>
        )}
    </li>
  )
}

function Members({ competition }: { competition: api.Competition }) {
  const [page, setPage] = useState(0)
  const members = useQuery({
    queryKey: ['competitions', 'members', competition.id, page],
    queryFn: ({ signal }) => api.listMembers(competition.id, page, signal),
  })
  return (
    <section className="competition-section">
      <h2>Members</h2>
      {members.isPending && <p role="status">Loading members...</p>}
      <ErrorNotice error={members.error} />
      {!members.isError && members.data && (
        <>
          <ul className="member-list">
            {members.data.items.map((member) => (
              <MemberEntry
                key={member.id}
                member={member}
                competition={competition}
              />
            ))}
          </ul>
          <Pager page={page} hasMore={members.data.hasMore} change={setPage} />
        </>
      )}
    </section>
  )
}

function EmailInvitations({
  competition,
  initiallyOpen,
}: {
  competition: api.Competition
  initiallyOpen: boolean
}) {
  const refresh = useRefresh()
  const cache = useQueryClient()
  const [open, setOpen] = useState(initiallyOpen)
  const emails = useQuery({
    queryKey: ['competitions', 'invitation-emails', competition.id],
    queryFn: ({ signal }) => api.listInvitationEmails(competition.id, signal),
    enabled: open,
    retry: false,
    refetchInterval: (query) =>
      open &&
      ['SCHEDULED', 'ACTIVE'].includes(competition.phase) &&
      query.state.data?.some((email) => email.status === 'PENDING')
        ? 2000
        : false,
  })
  const sentCount =
    emails.data?.filter((email) => email.status === 'SENT').length ?? 0
  useEffect(() => {
    if (sentCount)
      void cache.invalidateQueries({
        queryKey: ['competitions', 'invitations', competition.id],
      })
  }, [cache, competition.id, sentCount])
  const send = useMutation({
    mutationFn: () => api.sendInvitationEmails(competition.id),
    onSuccess: refresh,
  })
  const errors: Record<string, string> = {
    EMAIL_DISABLED:
      'Email delivery is disabled. Configure email before retrying.',
    EMAIL_RATE_LIMIT:
      'Email limit reached. Wait at least a minute before retrying; hourly limits also apply.',
    INVITATION_LIMIT:
      'The 20 active-link limit is full. Revoke an unused link before retrying.',
    DELIVERY_FAILED:
      'SMTP delivery failed. Check email configuration before retrying.',
  }
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Email invitations</summary>
      <p>
        Recipients are visible only to you. Draft invitations wait until
        publication. Sent means the mail server accepted the message, not that
        it reached the inbox. Delivery runs in the background. If invitations
        remain waiting after an interruption, retry them below.
      </p>
      {emails.isLoading && <p role="status">Loading email invitations...</p>}
      <ErrorNotice error={emails.error} />
      {emails.isError && (
        <button className="text-button" onClick={() => void emails.refetch()}>
          Retry email status
        </button>
      )}
      {emails.data && (
        <>
          {!emails.data.length && (
            <p>
              No email invitations were added when this competition was created.
            </p>
          )}
          <ul className="member-list">
            {emails.data.map((email) => (
              <li key={email.id}>
                <strong>{email.email}</strong> /{' '}
                {email.status === 'PENDING'
                  ? 'Waiting to send'
                  : email.status === 'SENT'
                    ? 'Sent'
                    : 'Not sent'}
                {email.lastError && (
                  <p className="form-error">{errors[email.lastError]}</p>
                )}
              </li>
            ))}
          </ul>
          {emails.data.some((email) => email.status !== 'SENT') && (
            <button
              type="button"
              className="text-button"
              disabled={
                send.isPending ||
                !['SCHEDULED', 'ACTIVE'].includes(competition.phase)
              }
              onClick={() => send.mutate()}
            >
              Send pending or failed invitations
            </button>
          )}
        </>
      )}
      <ErrorNotice error={send.error} />
    </details>
  )
}

function Invitations({
  competition,
  showEmails,
}: {
  competition: api.Competition
  showEmails: boolean
}) {
  const refresh = useRefresh()
  const invitations = useQuery({
    queryKey: ['competitions', 'invitations', competition.id],
    queryFn: ({ signal }) => api.listInvitations(competition.id, signal),
  })
  const create = useMutation({
    mutationFn: () => api.createInvitation(competition.id),
    onSuccess: refresh,
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvitation(competition.id, id),
    onSuccess: async (_, id) => {
      if (create.data?.id === id) create.reset()
      await refresh()
    },
  })
  return (
    <section className="competition-section">
      <h2>Invitations</h2>
      <EmailInvitations competition={competition} initiallyOpen={showEmails} />
      <p>
        Anyone holding a link may join until it expires or you revoke it. Links
        expire after seven days or when eating ends, whichever comes first. Copy
        a new link now; it is not shown again.
      </p>
      <button
        className="button secondary"
        disabled={
          create.isPending ||
          !['SCHEDULED', 'ACTIVE'].includes(competition.phase)
        }
        onClick={() => create.mutate()}
      >
        Create invitation
      </button>
      <ErrorNotice error={create.error} />
      {create.data && (
        <div className="form-notice">
          <label htmlFor="new-invite">New invitation link</label>
          <input
            id="new-invite"
            readOnly
            value={create.data.inviteUrl}
            onFocus={(event) => event.target.select()}
          />
        </div>
      )}
      <ErrorNotice error={invitations.error} />
      {invitations.isPending && <p role="status">Loading invitations...</p>}
      {!invitations.isError && invitations.data && (
        <ul className="member-list">
          {invitations.data.map((invite) => (
            <li key={invite.id}>
              Expires {formatTime(invite.expiresAt, competition.timeZone)} /{' '}
              {invite.revokedAt
                ? 'Revoked'
                : invite.active
                  ? 'Active'
                  : 'Expired'}
              {!invite.revokedAt && (
                <button
                  className="text-button"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(invite.id)}
                >
                  Revoke invitation
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorNotice error={revoke.error} />
    </section>
  )
}

export function CompetitionPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const session = useSession()
  const refresh = useRefresh()
  const detail = useQuery({
    queryKey: ['competitions', 'detail', id],
    queryFn: ({ signal }) => api.getCompetition(id, signal),
    retry: false,
  })
  const publish = useMutation({
    mutationFn: () => api.publishCompetition(id, detail.data!.version),
    onSuccess: refresh,
  })
  const cache = useQueryClient()
  const refreshMembership = () =>
    Promise.all([
      refresh(),
      cache.invalidateQueries({ queryKey: ['meals'] }),
      cache.invalidateQueries({ queryKey: ['feed'] }),
    ])
  const join = useMutation({
    mutationFn: () => api.joinCompetition(id),
    onSuccess: refreshMembership,
  })
  const leave = useMutation({
    mutationFn: () => api.leaveCompetition(id),
    onSuccess: refreshMembership,
  })
  const item = detail.data
  return (
    <section className="competition-page">
      <Link to="/competitions">All competitions</Link>
      {detail.isPending && <p role="status">Loading competition...</p>}
      <ErrorNotice error={detail.error} />
      {detail.isError && (
        <button className="text-button" onClick={() => void detail.refetch()}>
          Try again
        </button>
      )}
      {item && !detail.isError && (
        <>
          <CompetitionCover competition={item} />
          <span className="eyebrow competition-label">
            {phases[item.phase]} /{' '}
            {item.visibility === 'PRIVATE' ? 'Private' : 'Public'}
          </span>
          <PageHeading title={item.name}>
            {item.published && !item.allTime && (
              <Link
                className="button secondary"
                to={`/competitions/${id}/recap`}
              >
                Competition recap
              </Link>
            )}
            {item.canAdminister &&
              ['CLOSED', 'FINALIZED', 'REVISED'].includes(item.phase) && (
                <Link
                  className="button secondary"
                  to={`/competitions/${id}/corrections`}
                >
                  Correct competition scores
                </Link>
              )}
            {item.viewerRole !== 'NONE' && (
              <Link
                className="button secondary"
                to={`/competitions/${id}/progress`}
              >
                My competition progress
              </Link>
            )}
            {item.canAdminister &&
              ['DRAFT', 'SCHEDULED'].includes(item.phase) && (
                <Link
                  className="button secondary"
                  to={`/competitions/${id}/settings`}
                >
                  Edit settings
                </Link>
              )}
          </PageHeading>
          {item.canAdminister && <CompetitionCoverEditor competition={item} />}
          {session.data?.user && !item.allTime && (
            <FeaturedVenues competitionId={id} organizer={item.canAdminister} />
          )}
          <p className="competition-rules">
            {item.rules || 'No additional written rules.'}
          </p>
          <dl className="competition-facts">
            {item.allTime ? (
              <>
                <dt>Duration</dt>
                <dd>All time / No end date</dd>
              </>
            ) : (
              <>
                <dt>Eating starts</dt>
                <dd>{formatTime(item.startsAt, item.timeZone)}</dd>
                <dt>Eating ends</dt>
                <dd>{formatTime(item.endsAt, item.timeZone)}</dd>
                <dt>Submission cutoff</dt>
                <dd>
                  {formatTime(item.submissionClosesAt, item.timeZone)} (24
                  elapsed hours later)
                </dd>
              </>
            )}
            <dt>Time zone</dt>
            <dd>{item.timeZone}</dd>
            <dt>Meal sharing</dt>
            <dd>
              {item.allowSharedMeals
                ? 'Allowed only when all selected competitions permit it'
                : 'Not allowed'}
            </dd>
            <dt>Members</dt>
            <dd>{item.memberCount} joined</dd>
          </dl>
          <p>
            Scoring uses{' '}
            {item.trackingMode === 'COUNT' ? 'hot dog count' : 'total inches'}.
            {item.allTime ? (
              ' This shared leaderboard never closes. You choose which meals to submit; joining never publishes private meals automatically.'
            ) : (
              <>
                {' '}
                Eating timestamps must be before the eating end. Late joining is
                allowed until then, and eligible meals may date back to the
                start.
              </>
            )}
          </p>
          <p className="form-note">
            {item.visibility === 'PUBLIC' &&
              'Public standings show display names and totals. '}
            Details and photos you explicitly submit will be visible to
            competition members.
          </p>
          {item.phase === 'GRACE' && (
            <p className="form-notice">
              Eating has ended. Standings remain provisional during the 24-hour
              submission grace period.
            </p>
          )}
          {!item.allTime && (
            <p className="form-note">
              Recaps finalize after the submission cutoff. Organizer score
              corrections publish visibly revised recaps without changing source
              meals.
            </p>
          )}
          {item.published && (
            <Standings
              key={`standings-${id}`}
              id={id}
              trackingMode={item.trackingMode}
              allTime={item.allTime}
            />
          )}
          {item.canAdminister &&
            (!item.published ||
              !['DRAFT', 'SCHEDULED'].includes(item.phase)) && (
              <div className="competition-actions">
                {!['DRAFT', 'SCHEDULED'].includes(item.phase) && (
                  <p>Settings locked when eating started.</p>
                )}
                {!item.published && (
                  <button
                    className="button"
                    disabled={publish.isPending}
                    onClick={() => publish.mutate()}
                  >
                    Publish competition
                  </button>
                )}
              </div>
            )}
          <ErrorNotice error={publish.error} />
          {item.viewerRole !== 'NONE' && <CompetitionMeals id={id} />}
          {item.viewerRole === 'NONE' &&
            item.visibility === 'PUBLIC' &&
            ['SCHEDULED', 'ACTIVE'].includes(item.phase) &&
            (session.data?.user ? (
              <button
                className="button"
                disabled={join.isPending}
                onClick={() => join.mutate()}
              >
                Join competition
              </button>
            ) : (
              <p>
                <Link to="/sign-in">Sign in</Link> to join this competition.
              </p>
            ))}
          <ErrorNotice error={join.error} />
          {item.allTime && item.viewerRole !== 'NONE' && (
            <div className="competition-section">
              <p>
                Leaving withdraws your all-time submissions. Your private meals
                and other competitions stay unchanged. You can rejoin later.
              </p>
              <button
                className="text-button"
                disabled={leave.isPending}
                onClick={() => leave.mutate()}
              >
                Leave all-time competition
              </button>
              <ErrorNotice error={leave.error} />
            </div>
          )}
          {(item.viewerRole !== 'NONE' || item.canAdminister) && (
            <Members competition={item} />
          )}
          {item.canAdminister && (
            <Invitations
              key={`invitations-${id}`}
              competition={item}
              showEmails={Boolean(location.state?.showEmailInvitations)}
            />
          )}
        </>
      )}
    </section>
  )
}

export function InvitationPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const refresh = useRefresh()
  const session = useSession()
  const [token] = useState(
    () => new URLSearchParams(location.search).get('token') ?? '',
  )
  useEffect(() => {
    if (new URLSearchParams(location.search).has('token'))
      navigate('/join', { replace: true })
  }, [location.search, navigate])
  const preview = useQuery({
    queryKey: ['competitions', 'invitation', token],
    queryFn: () => api.inspectInvitation(token),
    enabled: Boolean(token),
    retry: false,
    gcTime: 0,
  })
  const join = useMutation({
    mutationFn: () => api.acceptInvitation(token),
    onSuccess: async (competition) => {
      await refresh()
      navigate(`/competitions/${competition.id}`, { replace: true })
    },
  })
  return (
    <section className="competition-page narrow">
      <span className="eyebrow">A seat at the table</span>
      <PageHeading title="Competition invitation" />
      {!token && <p>Reopen your invitation link to continue.</p>}
      {token && preview.isPending && (
        <p role="status">Checking invitation...</p>
      )}
      <ErrorNotice error={preview.error} />
      {preview.data && !preview.isError && (
        <>
          <h2>{preview.data.name}</h2>
          <p className="competition-rules">{preview.data.rules}</p>
          <p>
            {preview.data.endsAt === null ? (
              'All time / No end date'
            ) : (
              <>
                {formatTime(preview.data.startsAt, preview.data.timeZone)} to{' '}
                {formatTime(preview.data.endsAt, preview.data.timeZone)}
              </>
            )}
          </p>
          <p>
            Joining shares your display name with the competition. Future
            submissions and photos will be visible to its members, not
            automatically to the public directory. Public competitions also
            publish display names and totals in their standings, but not meal
            details or photos.
          </p>
          {session.data?.user ? (
            <button
              className="button"
              disabled={join.isPending}
              onClick={() => join.mutate()}
            >
              Accept invitation
            </button>
          ) : (
            <p>
              <Link to="/sign-in">Sign in</Link>, then reopen this invitation
              link to join. The link is not saved in this browser.
            </p>
          )}
        </>
      )}
      <ErrorNotice error={session.error} />
      <ErrorNotice error={join.error} />
    </section>
  )
}
