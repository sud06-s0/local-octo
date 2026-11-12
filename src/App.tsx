// src/App.tsx
import { lazy, Suspense } from 'react'
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router'
import { AppStoreProvider, useStore } from './store/AppStore'
import { AuthProvider, useAuth } from './store/AuthProvider'
import { isLive } from './lib/supabase'
import { ToastProvider } from './components/ui/Toast'
import { AppLayout } from './components/layout/AppLayout'
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Contacts = lazy(() => import('./pages/Contacts'))
const AddContacts = lazy(() => import('./pages/AddContacts'))
const Messaging = lazy(() => import('./pages/Messaging'))
const RequestScheduling = lazy(() => import('./pages/RequestScheduling'))
const Reviews = lazy(() => import('./pages/Reviews'))
const Widgets = lazy(() => import('./pages/Widgets'))
const SocialPosting = lazy(() => import('./pages/SocialPosting'))
const Websites = lazy(() => import('./pages/Websites'))
const Integrations = lazy(() => import('./pages/Integrations'))
const Notifications = lazy(() => import('./pages/Notifications'))
const NotFound = lazy(() => import('./pages/NotFound'))
const Login = lazy(() => import('./pages/Login'))
const Onboarding = lazy(() => import('./pages/Onboarding'))

// Preview builds use hash URLs so they work from any static host without rewrites.
const Router = import.meta.env.MODE === 'preview' ? HashRouter : BrowserRouter

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <span className="size-9 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-700" />
    </div>
  )
}

/** Live mode: sign-in -> create first business -> dashboard. Demo mode goes straight in. */
function Gate() {
  const { ready, signedIn, recovering } = useAuth()
  const { businesses, loading } = useStore()

  if (!ready) return <FullPageSpinner />
  if (isLive && (!signedIn || recovering)) return <Suspense fallback={<FullPageSpinner />}><Login /></Suspense>
  if (isLive && businesses.length === 0) return loading ? <FullPageSpinner /> : <Suspense fallback={<FullPageSpinner />}><Onboarding /></Suspense>

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="add-contacts" element={<AddContacts />} />
        <Route path="messaging" element={<Messaging />} />
        <Route path="request-scheduling" element={<RequestScheduling />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="widgets" element={<Widgets />} />
        <Route path="social-posting" element={<SocialPosting />} />
        <Route path="websites" element={<Websites />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppStoreProvider>
          <Router>
            <Gate />
          </Router>
        </AppStoreProvider>
      </AuthProvider>
    </ToastProvider>
  )
}
