import type { ReactNode } from 'react'

export function PageHeading({
  title,
  children,
  level = 1,
}: {
  title: ReactNode
  children?: ReactNode
  level?: 1 | 2
}) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <header className="page-heading">
      <Heading>{title}</Heading>
      {children && <div className="page-heading-actions">{children}</div>}
    </header>
  )
}
