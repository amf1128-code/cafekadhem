import { Suspense, lazy, type ReactNode } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { PublicLayout } from './components/layout/PublicLayout'
import { AdminGuard } from './components/layout/AdminGuard'
import { PageLoader } from './components/ui/LoadingSpinner'

// Standalone routes (the /admin/login family) sit outside any layout, so
// they need their own Suspense boundary while the lazy chunk loads.
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

// Each page is its own bundle chunk. Suspense fallbacks live inside
// PublicLayout / AdminLayout (around <Outlet />) so navigation feels
// the same as before — a brief PageLoader while the chunk fetches.
//
// Pages use named exports, so each lazy() call rewrites the resolved
// module to expose its component as `default` (what React.lazy expects).

const Home = lazy(() => import('./pages/Home').then(m => ({ default: m.Home })))
const EventDetail = lazy(() =>
  import('./pages/EventDetail').then(m => ({ default: m.EventDetail }))
)
const Order = lazy(() => import('./pages/Order').then(m => ({ default: m.Order })))
const InviteLanding = lazy(() =>
  import('./pages/InviteLanding').then(m => ({ default: m.InviteLanding }))
)
const Pickup = lazy(() => import('./pages/Pickup').then(m => ({ default: m.Pickup })))
const PickupTicket = lazy(() =>
  import('./pages/PickupTicket').then(m => ({ default: m.PickupTicket }))
)
const Ticket = lazy(() => import('./pages/Ticket').then(m => ({ default: m.Ticket })))
const FindTickets = lazy(() =>
  import('./pages/FindTickets').then(m => ({ default: m.FindTickets }))
)
const MyTickets = lazy(() =>
  import('./pages/MyTickets').then(m => ({ default: m.MyTickets }))
)

const AdminLogin = lazy(() =>
  import('./pages/admin/Login').then(m => ({ default: m.AdminLogin }))
)
const ForgotPassword = lazy(() =>
  import('./pages/admin/ForgotPassword').then(m => ({ default: m.ForgotPassword }))
)
const ResetPassword = lazy(() =>
  import('./pages/admin/ResetPassword').then(m => ({ default: m.ResetPassword }))
)
const AdminDashboard = lazy(() =>
  import('./pages/admin/Dashboard').then(m => ({ default: m.AdminDashboard }))
)
const AdminEventForm = lazy(() =>
  import('./pages/admin/EventForm').then(m => ({ default: m.AdminEventForm }))
)
const AdminEventOrders = lazy(() =>
  import('./pages/admin/EventOrders').then(m => ({ default: m.AdminEventOrders }))
)
const AdminMenuList = lazy(() =>
  import('./pages/admin/MenuList').then(m => ({ default: m.AdminMenuList }))
)
const AdminMenuForm = lazy(() =>
  import('./pages/admin/MenuForm').then(m => ({ default: m.AdminMenuForm }))
)
const AdminGuestDirectory = lazy(() =>
  import('./pages/admin/GuestDirectory').then(m => ({ default: m.AdminGuestDirectory }))
)
const AdminSettings = lazy(() =>
  import('./pages/admin/Settings').then(m => ({ default: m.AdminSettings }))
)
const AdminEventWaitlist = lazy(() =>
  import('./pages/admin/EventWaitlist').then(m => ({ default: m.AdminEventWaitlist }))
)
const AdminPickupConfig = lazy(() =>
  import('./pages/admin/PickupConfig').then(m => ({ default: m.AdminPickupConfig }))
)
const AdminPickupOrders = lazy(() =>
  import('./pages/admin/PickupOrders').then(m => ({ default: m.AdminPickupOrders }))
)
const AdminEventTickets = lazy(() =>
  import('./pages/admin/EventTickets').then(m => ({ default: m.AdminEventTickets }))
)
const AdminEventCheckIn = lazy(() =>
  import('./pages/admin/EventCheckIn').then(m => ({ default: m.AdminEventCheckIn }))
)
const AdminEventBulkInvite = lazy(() =>
  import('./pages/admin/EventBulkInvite').then(m => ({ default: m.AdminEventBulkInvite }))
)
const DesignPreviewIndex = lazy(() =>
  import('./pages/admin/design-preview').then(m => ({ default: m.DesignPreviewIndex }))
)
const Option1BirthdayPoster = lazy(() =>
  import('./pages/admin/design-preview/Option1BirthdayPoster').then(m => ({
    default: m.Option1BirthdayPoster,
  }))
)
const Option2AlAroussa = lazy(() =>
  import('./pages/admin/design-preview/Option2AlAroussa').then(m => ({
    default: m.Option2AlAroussa,
  }))
)
const Option3MagasinGeneral = lazy(() =>
  import('./pages/admin/design-preview/Option3MagasinGeneral').then(m => ({
    default: m.Option3MagasinGeneral,
  }))
)
const Option4GroovyShowroom = lazy(() =>
  import('./pages/admin/design-preview/Option4GroovyShowroom').then(m => ({
    default: m.Option4GroovyShowroom,
  }))
)
const Option5SoukMaximalism = lazy(() =>
  import('./pages/admin/design-preview/Option5SoukMaximalism').then(m => ({
    default: m.Option5SoukMaximalism,
  }))
)

export const router = createBrowserRouter([
  {
    path: '/',
    element: <PublicLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'events/:id', element: <EventDetail /> },
      { path: 'events/:id/order', element: <Order /> },
      { path: 'pickup', element: <Pickup /> },
      { path: 'pickup/:token', element: <PickupTicket /> },
      { path: 'ticket/:token', element: <Ticket /> },
      { path: 'invite/:token', element: <InviteLanding /> },
      { path: 'find-tickets', element: <FindTickets /> },
      { path: 'my-tickets', element: <MyTickets /> },
    ],
  },
  {
    path: '/admin/login',
    element: <Lazy><AdminLogin /></Lazy>,
  },
  {
    path: '/admin/forgot-password',
    element: <Lazy><ForgotPassword /></Lazy>,
  },
  {
    path: '/admin/reset-password',
    element: <Lazy><ResetPassword /></Lazy>,
  },
  {
    path: '/admin',
    element: <AdminGuard />,
    children: [
      { index: true, element: <AdminDashboard /> },
      { path: 'events/new', element: <AdminEventForm /> },
      { path: 'events/:id/edit', element: <AdminEventForm /> },
      { path: 'events/:id/orders', element: <AdminEventOrders /> },
      { path: 'events/:id/tickets', element: <AdminEventTickets /> },
      { path: 'events/:id/checkin', element: <AdminEventCheckIn /> },
      { path: 'events/:id/invite', element: <AdminEventBulkInvite /> },
      { path: 'events/:id/waitlist', element: <AdminEventWaitlist /> },
      { path: 'menus', element: <AdminMenuList /> },
      { path: 'menus/new', element: <AdminMenuForm /> },
      { path: 'menus/:id/edit', element: <AdminMenuForm /> },
      { path: 'guests', element: <AdminGuestDirectory /> },
      { path: 'pickup', element: <AdminPickupConfig /> },
      { path: 'pickup/orders', element: <AdminPickupOrders /> },
      { path: 'settings', element: <AdminSettings /> },
      { path: 'design-preview', element: <DesignPreviewIndex /> },
      { path: 'design-preview/option-1', element: <Option1BirthdayPoster /> },
      { path: 'design-preview/option-2', element: <Option2AlAroussa /> },
      { path: 'design-preview/option-3', element: <Option3MagasinGeneral /> },
      { path: 'design-preview/option-4', element: <Option4GroovyShowroom /> },
      { path: 'design-preview/option-5', element: <Option5SoukMaximalism /> },
    ],
  },
])
