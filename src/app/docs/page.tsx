import type { Metadata } from 'next'
import { PublicPage } from '../../components/public-page'
import './documentation.css'
export const metadata: Metadata = {
  title: 'Documentation — Forge AI',
  description:
    'Learn to describe your product, choose a mode, build and test a first version, refine your app, and recover your work. Includes a complete demo prompt.',
}
export default function Page() {
  return <PublicPage kind="docs" />
}
