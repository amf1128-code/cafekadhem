import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { Footer } from './Footer'
import { useTheme } from '../../lib/theme/themes'

export function PublicLayout() {
  const { activeTheme } = useTheme()
  return (
    <div data-theme={activeTheme} className="min-h-screen page-bg flex flex-col">
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
