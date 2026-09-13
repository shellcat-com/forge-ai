import type { ReactNode } from 'react'
import './globals.css'

export const metadata = { title: 'Forge template candidate', description: 'Platform-authored Next.js and PostgreSQL template candidate.' }
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><div className="project-root">{children}</div></body></html>
}
