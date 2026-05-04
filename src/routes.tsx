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
import { Ticket } from './pages/Ticket'
import { FindTickets } from './pages/FindTickets'
import { MyTickets } from './pages/MyTickets'
import { AdminEventTickets } from './pages/admin/EventTickets'
import { AdminEventCheckIn } from './pages/admin/EventCheckIn'
import { AdminEventBulkInvite } from './pages/admin/EventBulkInvite'
import { DesignPreviewIndex } from './pages/admin/design-preview'
import { Option1BirthdayPoster } from './pages/admin/design-preview/Option1BirthdayPoster'
import { Option2AlAroussa } from './pages/admin/design-preview/Option2AlAroussa'
import { Option3MagasinGeneral } from './pages/admin/design-preview/Option3MagasinGeneral'
import { Option4GroovyShowroom } from './pages/admin/design-preview/Option4GroovyShowroom'
import { Option5SoukMaximalism } from './pages/admin/design-preview/Option5SoukMaximalism'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <PublicLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'events/:id', element: <EventDetail /> },
      { path: 'events/:id/order', element: <Order /> },
      { path: 'pickup', element: <Pickup /> },
      { path: 'ticket/:token', element: <Ticket /> },
      { path: 'invite/:token', element: <InviteLanding /> },
      { path: 'find-tickets', element: <FindTickets /> },
      { path: 'my-tickets', element: <MyTickets /> },
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
