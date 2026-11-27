// src/components/layout/AppLayout.tsx
import { Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { Mail, Menu, MessageCircle, X } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { ErrorBoundary } from '../ErrorBoundary'
import { GoogleConnectFlow } from '../GoogleConnectFlow'
import { Modal } from '../ui/Modal'
import { brand } from '../../config/brand'

export function AppLayout() {
  const [drawer, setDrawer] = useState(false)
  const [help, setHelp] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    setDrawer(false)
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="min-h-screen bg-canvas print:bg-white">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] border-r border-line bg-canvas lg:block print:hidden">
        <Sidebar />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:hidden print:hidden">
        <button onClick={() => setDrawer(true)} className="-ml-1 rounded-lg p-2 hover:bg-canvas" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <img src={brand.logoUrl} alt="" className="size-8 object-contain" />
        <span className="font-semibold">{brand.appName}</span>
      </header>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[86%] max-w-[300px] bg-canvas shadow-xl">
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-6 z-10 rounded-lg p-1.5 hover:bg-black/5" aria-label="Close menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <GoogleConnectFlow />
      <main className="lg:pl-[272px] print:pl-0">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <ErrorBoundary resetKey={pathname}>
            <Suspense
              fallback={
                <div className="flex h-64 items-center justify-center">
                  <span className="size-8 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-700" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      {/* Help button */}
      <button
        onClick={() => setHelp(true)}
        className="fixed bottom-5 right-5 z-40 flex print:hidden size-14 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-lg transition hover:bg-brand-800 sm:bottom-6 sm:right-6"
        aria-label="Help"
      >
        <MessageCircle className="size-6" />
      </button>

      <Modal open={help} onClose={() => setHelp(false)} title="Need help?">
        <div className="space-y-3">
          <p className="text-[15px] text-muted">Our team usually replies within a few hours on business days.</p>
          <a href={`mailto:${brand.supportEmail}`} className="flex items-center gap-3 rounded-xl border border-line p-4 hover:bg-canvas">
            <Mail className="size-5 text-brand-800" />
            <span>
              <span className="block font-medium">Email support</span>
              <span className="text-sm text-muted">{brand.supportEmail}</span>
            </span>
          </a>
        </div>
      </Modal>

    </div>
  )
}
