import { Navigate } from 'react-router-dom'
import { useAdmin } from '../../hooks/useAdmin'
import { PageLoader } from '../ui/LoadingSpinner'
import { AdminLayout } from './AdminLayout'

export function AdminGuard() {
  const { isAuthenticated, loading } = useAdmin()

  if (loading) {
    return <PageLoader />
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />
  }

  return <AdminLayout />
}
