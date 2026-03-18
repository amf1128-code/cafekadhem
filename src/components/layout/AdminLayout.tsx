import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const navItems = [
  { path: '/admin', label: 'Dashboard' },
  { path: '/admin/events/new', label: 'New Event' },
  { path: '/admin/menus', label: 'Menus' },
  { path: '/admin/guests', label: 'Guests' },
  { path: '/admin/settings', label: 'Settings' },
]

export function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/admin/login')
  }

  return (
    <div className="min-h-screen bg-cream">
      <header className="bg-forest-dark text-cream">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/admin" className="font-serif text-xl">Cafe Kadhem Admin</Link>
          <button
            onClick={handleLogout}
            className="text-cream/70 hover:text-cream text-sm transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <nav className="bg-forest text-cream overflow-x-auto">
        <div className="max-w-6xl mx-auto px-4 flex gap-1">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`px-4 py-2.5 text-sm whitespace-nowrap transition-colors ${
                location.pathname === item.path
                  ? 'bg-cream/20 text-cream'
                  : 'text-cream/70 hover:text-cream hover:bg-cream/10'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
