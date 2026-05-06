import { Suspense, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { Footer } from './Footer'
import { AmbientTokenHandler } from './AmbientTokenHandler'
import { PageLoader } from '../ui/LoadingSpinner'
import { useTheme } from '../../lib/theme/themes'

export function PublicLayout() {
  const { activeTheme } = useTheme()

  // Mirror data-theme onto <html> so the theme palette covers the entire
  // viewport — including the body background, mobile overscroll/rubber-band
  // area, and any space below the layout wrapper. Without this, mobile
  // browsers reveal the body's static `bg-cream` (theme1) when scrolling
  // past content, which read as "the site is stuck in theme 1". Cleaned up
  // on unmount so admin routes (no PublicLayout) revert to defaults.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', activeTheme)
    return () => {
      document.documentElement.removeAttribute('data-theme')
    }
  }, [activeTheme])

  return (
    <div data-theme={activeTheme} className="min-h-dvh page-bg flex flex-col">
      <AmbientTokenHandler />
      <Header />
      <main className="flex-1">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
