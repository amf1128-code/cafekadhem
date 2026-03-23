import { createBrowserRouter } from 'react-router-dom'
import { PublicLayout } from './components/layout/PublicLayout'
import { AdminGuard } from './components/layout/AdminGuard'

// Lazy-load pages
import { Home } from './pages/Home'
import { EventDetail } from './pages/EventDetail'
import { Order } from './pages/Order'
import { InviteLanding } from './pages/InviteLanding'
import { AdminLogin } from './pages/admin/Login'
import { ForgotPassword } from './pages/admin/ForgotPassword'
import { ResetPassword } from './pages/admin/ResetPassword'
import { AdminDashboard } from './pages/admin/Dashboard'
import { AdminEventForm } from './pages/admin/EventForm'
import { AdminEventOrders } from './pages/admin/EventOrders'
import { AdminMenuList } from './pages/admin/MenuList'
import { AdminMenuForm } from './pages/admin/MenuForm'
import { AdminGuestDirectory } from './pages/admin/GuestDirectory'
import { AdminSettings } from './pages/admin/Settings'
import { AdminEventWaitlist } from './pages/admin/EventWaitlist'
import { AdminPickupConfig } from './pages/admin/PickupConfig'
import { AdminPickupOrders } from './pages/admin/PickupOrders'
import { Pickup } from './pages/Pickup'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <PublicLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'events/:id', element: <EventDetail /> },
      { path: 'events/:id/order', element: <Order /> },
      { path: 'pickup', element: <Pickup /> },
      { path: 'invite/:token', element: <InviteLanding /> },
    ],
  },
  {
    path: '/admin/login',
    element: <AdminLogin />,
  },
  {
    path: '/admin/forgot-password',
    element: <ForgotPassword />,
  },
  {
    path: '/admin/reset-password',
    element: <ResetPassword />,
  },
  {
    path: '/admin',
    element: <AdminGuard />,
    children: [
      { index: true, element: <AdminDashboard /> },
      { path: 'events/new', element: <AdminEventForm /> },
      { path: 'events/:id/edit', element: <AdminEventForm /> },
      { path: 'events/:id/orders', element: <AdminEventOrders /> },
      { path: 'events/:id/waitlist', element: <AdminEventWaitlist /> },
      { path: 'menus', element: <AdminMenuList /> },
      { path: 'menus/new', element: <AdminMenuForm /> },
      { path: 'menus/:id/edit', element: <AdminMenuForm /> },
      { path: 'guests', element: <AdminGuestDirectory /> },
      { path: 'pickup', element: <AdminPickupConfig /> },
      { path: 'pickup/orders', element: <AdminPickupOrders /> },
      { path: 'settings', element: <AdminSettings /> },
    ],
  },
])
