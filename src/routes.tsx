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
const VerifyMerge = lazy(() =>
  import('./pages/VerifyMerge').then(m => ({ default: m.VerifyMerge }))
)
// Cinema preview — staged behind /cinema/* until promoted. CinemaShell
// is the chrome (top strip, nav, marquee, footer) that wraps every
// preview page; CinemaLanding is the index page (hero/menu/calendar/
// story sections).
import { CinemaShell } from './components/cinema/CinemaShell'
const CinemaLanding = lazy(() =>
  import('./components/cinema/CinemaLanding').then(m => ({ default: m.CinemaLanding }))
)
const CinemaCalendar = lazy(() =>
  import('./components/cinema/pages/CinemaCalendar').then(m => ({ default: m.CinemaCalendar }))
)
const CinemaEventDetail = lazy(() =>
  import('./components/cinema/pages/CinemaEventDetail').then(m => ({ default: m.CinemaEventDetail }))
)
const CinemaOrder = lazy(() =>
  import('./components/cinema/pages/CinemaOrder').then(m => ({ default: m.CinemaOrder }))
)
const CinemaTicket = lazy(() =>
  import('./components/cinema/pages/CinemaTicket').then(m => ({ default: m.CinemaTicket }))
)
const CinemaFindTickets = lazy(() =>
  import('./components/cinema/pages/CinemaFindTickets').then(m => ({ default: m.CinemaFindTickets }))
)
const CinemaMyTickets = lazy(() =>
  import('./components/cinema/pages/CinemaMyTickets').then(m => ({ default: m.CinemaMyTickets }))
)
const CinemaInviteLanding = lazy(() =>
  import('./components/cinema/pages/CinemaInviteLanding').then(m => ({ default: m.CinemaInviteLanding }))
)
const CinemaPickup = lazy(() =>
  import('./components/cinema/pages/CinemaPickup').then(m => ({ default: m.CinemaPickup }))
)
const CinemaPickupTicket = lazy(() =>
  import('./components/cinema/pages/CinemaPickupTicket').then(m => ({ default: m.CinemaPickupTicket }))
)
const CinemaVerifyMerge = lazy(() =>
  import('./components/cinema/pages/CinemaVerifyMerge').then(m => ({ default: m.CinemaVerifyMerge }))
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
const AdminEventBlast = lazy(() =>
  import('./pages/admin/EventBlast').then(m => ({ default: m.AdminEventBlast }))
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
  // Production routes — left exactly as they were. The cinema redesign
  // is staged behind /cinema/* (see below) so the live site is unchanged
  // until the operator promotes it.
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
      { path: 'verify-merge', element: <VerifyMerge /> },
    ],
  },
  // Cinema preview — a parallel cinema-styled site living at /cinema/*.
  // Visually a complete rebuild of the public site. Lives behind /cinema
  // until the operator chooses to promote it. CinemaShell provides the
  // top strip, nav, marquee, and footer; each child route is its own
  // page body.
  {
    path: '/cinema',
    element: <CinemaShell />,
    children: [
      { index: true, element: <Lazy><CinemaLanding /></Lazy> },
      { path: 'calendar', element: <Lazy><CinemaCalendar /></Lazy> },
      { path: 'events/:id', element: <Lazy><CinemaEventDetail /></Lazy> },
      { path: 'events/:id/order', element: <Lazy><CinemaOrder /></Lazy> },
      { path: 'ticket/:token', element: <Lazy><CinemaTicket /></Lazy> },
      { path: 'find-tickets', element: <Lazy><CinemaFindTickets /></Lazy> },
      { path: 'my-tickets', element: <Lazy><CinemaMyTickets /></Lazy> },
      { path: 'invite/:token', element: <Lazy><CinemaInviteLanding /></Lazy> },
      { path: 'pickup', element: <Lazy><CinemaPickup /></Lazy> },
      { path: 'pickup/:token', element: <Lazy><CinemaPickupTicket /></Lazy> },
      { path: 'verify-merge', element: <Lazy><CinemaVerifyMerge /></Lazy> },
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
      { path: 'events/:id/blast', element: <AdminEventBlast /> },
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
