import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  confirmLink,
  inspectLink,
  loadSession,
  logout,
  renameProfile,
  requestEmail,
  startGoogle,
} from './api'

function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => loadSession(signal),
    retry: false,
  })
}

function ErrorMessage({ error }: { error: Error | null }) {
  return error ? (
    <p className="form-error" role="alert">
      {error.message}
    </p>
  ) : null
}

function EmailForm({ linking = false }: { linking?: boolean }) {
  const [email, setEmail] = useState('')
  const mutation = useMutation({ mutationFn: requestEmail })

  if (mutation.isSuccess) {
    return (
      <div role="status" className="form-notice">
        <p>
          If delivery is available, a confirmation link will arrive shortly.
          Check spam, too.
        </p>
        <button className="text-button" onClick={() => mutation.reset()}>
          Use another email
        </button>
      </div>
    )
  }
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        mutation.mutate(email)
      }}
    >
      <label htmlFor="email">
        {linking ? 'Email to link' : 'Email address'}
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button className="button" disabled={mutation.isPending}>
        {mutation.isPending
          ? 'Sending...'
          : linking
            ? 'Send linking email'
            : 'Email me a sign-in link'}
      </button>
      <ErrorMessage error={mutation.error} />
    </form>
  )
}

export function SignInPage() {
  const session = useSession()
  const location = useLocation()
  const google = useMutation({ mutationFn: () => startGoogle(false) })
  if (session.data?.user) return <Navigate to="/account" replace />
  return (
    <section className="auth-card">
      <span className="eyebrow">Pull up a seat</span>
      <h1>Sign in to your crew.</h1>
      <p>
        Use a nickname for your public display name. Your email address is not
        public.
      </p>
      {location.search.includes('error=google') && (
        <p role="alert" className="form-error">
          Google sign-in could not be completed. Try again or use email.
        </p>
      )}
      {session.isPending && <p role="status">Loading sign-in options...</p>}
      <ErrorMessage error={session.error} />
      {session.data && (
        <>
          {session.data.googleEnabled ? (
            <button
              className="button secondary"
              onClick={() => google.mutate()}
              disabled={google.isPending}
            >
              Continue with Google
            </button>
          ) : (
            <p className="form-note">
              Google sign-in is not configured on this server yet.
            </p>
          )}
          <ErrorMessage error={google.error} />
          {session.data.emailEnabled ? (
            <EmailForm />
          ) : (
            <p className="form-note">
              Email sign-in is not configured on this server yet.
            </p>
          )}
        </>
      )}
    </section>
  )
}

export function ConfirmLinkPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const [token] = useState(
    () => new URLSearchParams(location.search).get('token') ?? '',
  )
  useEffect(() => {
    if (new URLSearchParams(location.search).has('token')) {
      navigate('/sign-in/confirm', { replace: true })
    }
  }, [location.search, navigate])
  const details = useQuery({
    queryKey: ['magic-link', token],
    queryFn: () => inspectLink(token),
    enabled: Boolean(token),
    retry: false,
    gcTime: 0,
  })
  const confirm = useMutation({
    mutationFn: () => confirmLink(token),
    onSuccess: () => {
      cache.clear()
      navigate('/account', { replace: true })
    },
  })
  return (
    <section className="auth-card">
      <span className="eyebrow">One more step</span>
      <h1>Confirm your email.</h1>
      <p>
        Only continue if you requested this link and recognize the email address
        below.
      </p>
      {!token && (
        <p role="alert">Reopen the link from your email to continue.</p>
      )}
      {token && details.isPending && <p role="status">Checking your link...</p>}
      <ErrorMessage error={details.error} />
      {details.data && (
        <>
          <p className="confirmation-address">{details.data.email}</p>
          <p>
            {details.data.purpose === 'link'
              ? 'Link this email to your signed-in account.'
              : 'Sign in using this email address.'}
          </p>
          <button
            className="button"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending
              ? 'Confirming...'
              : details.data.purpose === 'link'
                ? 'Confirm email link'
                : 'Confirm sign-in'}
          </button>
        </>
      )}
      <ErrorMessage error={confirm.error} />
      <Link className="text-link" to="/sign-in">
        Back to sign-in
      </Link>
    </section>
  )
}

function ProfileForm({ displayName }: { displayName: string }) {
  const cache = useQueryClient()
  const [name, setName] = useState(displayName)
  const save = useMutation({
    mutationFn: renameProfile,
    onSuccess: () => cache.invalidateQueries({ queryKey: ['session'] }),
  })
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate(name)
      }}
    >
      <label htmlFor="display-name">Display name</label>
      <input
        id="display-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        maxLength={80}
        autoComplete="nickname"
      />
      <button className="button" disabled={save.isPending}>
        {save.isPending ? 'Saving...' : 'Save display name'}
      </button>
      {save.isSuccess && <p role="status">Display name saved.</p>}
      <ErrorMessage error={save.error} />
    </form>
  )
}

export function AccountPage() {
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const cache = useQueryClient()
  const google = useMutation({ mutationFn: () => startGoogle(true) })
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      cache.clear()
      navigate('/sign-in', { replace: true })
    },
  })
  const user = session.data?.user
  return (
    <section className="auth-card">
      <span className="eyebrow">Your corner of the table</span>
      <h1>Your account</h1>
      {session.isPending && <p role="status">Loading your account...</p>}
      <ErrorMessage error={session.error} />
      {session.data && !user && (
        <p>
          <Link className="text-link" to="/sign-in">
            Sign in
          </Link>{' '}
          to manage your profile.
        </p>
      )}
      {user && (
        <>
          {location.search.includes('error=google') && (
            <p role="alert" className="form-error">
              Google could not be linked. Your existing account is unchanged.
            </p>
          )}
          <ProfileForm key={user.id} displayName={user.displayName} />
          <h2>Sign-in methods</h2>
          <p>
            {user.providers
              .map((provider) => (provider === 'google' ? 'Google' : 'Email'))
              .join(', ')}
          </p>
          {session.data?.googleEnabled &&
            !user.providers.includes('google') && (
              <button
                className="button secondary"
                disabled={google.isPending}
                onClick={() => google.mutate()}
              >
                Link Google
              </button>
            )}
          <ErrorMessage error={google.error} />
          {session.data?.emailEnabled && !user.providers.includes('email') && (
            <EmailForm linking />
          )}
          <p className="form-note">
            Methods are linked only after you confirm them. Accounts are never
            merged automatically.
          </p>
          <p className="account-id">Account ID: {user.id}</p>
          {user.siteOwner && <p className="form-notice">Site owner</p>}
          <button
            className="text-button"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            Sign out
          </button>
          <ErrorMessage error={signOut.error} />
        </>
      )}
    </section>
  )
}
