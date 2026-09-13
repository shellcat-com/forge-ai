import type { ReactNode } from 'react'
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <section aria-label={title}><h1>{title}</h1>{children}</section>
}
