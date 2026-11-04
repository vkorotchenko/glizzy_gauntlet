import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeading } from '../PageHeading'
import {
  changeGlobalRole,
  isAdmin,
  listRoleAccounts,
  loadSession,
  type GlobalRole,
} from './api'

const labels: Record<GlobalRole, string> = {
  ADMIN: 'Admin',
  VENUE_APPROVER: 'Venue approver',
}

export function RoleManagementPage() {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => loadSession(signal),
    retry: false,
  })
  const cache = useQueryClient()
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const allowed = isAdmin(session.data?.user)
  const accounts = useQuery({
    queryKey: ['admin', 'accounts', query, page],
    queryFn: ({ signal }) => listRoleAccounts(query, page, signal),
    enabled: allowed,
  })
  const change = useMutation({
    mutationFn: ({
      id,
      role,
      grant,
    }: {
      id: string
      role: GlobalRole
      grant: boolean
    }) => changeGlobalRole(id, role, grant),
    onSuccess: () => cache.invalidateQueries(),
  })
  if (!allowed) return <p>Only admins can manage global roles.</p>
  return (
    <section className="competition-page">
      <PageHeading title="Role management" />
      <p>
        Admins administer all-time, manage roles, and moderate venues. Venue
        approvers can review submissions only. Regular competition organizers
        stay scoped to their own events.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setQuery(input.trim())
          setPage(0)
        }}
      >
        <label htmlFor="role-account-search">
          Find account by display name or account ID
        </label>
        <div className="inline-form-row">
          <input
            id="role-account-search"
            maxLength={80}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button className="button">Find accounts</button>
        </div>
      </form>
      {accounts.isPending && <p role="status">Loading accounts...</p>}
      {accounts.error && (
        <p role="alert" className="form-error">
          {accounts.error.message}
        </p>
      )}
      {accounts.isError && (
        <button className="text-button" onClick={() => void accounts.refetch()}>
          Try again
        </button>
      )}
      {change.error && (
        <p role="alert" className="form-error">
          {change.error.message}
        </p>
      )}
      {change.isSuccess && <p role="status">Roles updated.</p>}
      {!accounts.isError && accounts.data && (
        <>
          {!accounts.data.items.length && <p>No matching accounts.</p>}
          <ul className="member-list">
            {accounts.data.items.map((account) => (
              <li key={account.id}>
                <strong>{account.displayName}</strong>
                <p className="account-id">Account ID: {account.id}</p>
                <p>
                  {account.roles.length
                    ? account.roles.map((role) => labels[role]).join(', ')
                    : 'No global roles'}
                </p>
                <div className="competition-actions">
                  {(['ADMIN', 'VENUE_APPROVER'] as const).map((role) => {
                    const grant = !account.roles.includes(role)
                    const action = `${grant ? 'Grant' : 'Revoke'} ${labels[role]}`
                    return (
                      <button
                        className="text-button"
                        key={role}
                        disabled={change.isPending}
                        aria-label={`${action} ${grant ? 'to' : 'from'} ${account.displayName}`}
                        onClick={() =>
                          change.mutate({ id: account.id, role, grant })
                        }
                      >
                        {action}
                      </button>
                    )
                  })}
                </div>
              </li>
            ))}
          </ul>
          <div className="page-controls">
            <button
              className="text-button"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous page
            </button>
            <span>Page {page + 1}</span>
            <button
              className="text-button"
              disabled={!accounts.data.hasMore}
              onClick={() => setPage(page + 1)}
            >
              Next page
            </button>
          </div>
        </>
      )}
    </section>
  )
}
