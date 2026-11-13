// src/components/layout/AppLayout.tsx
import { Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { Copy, Gift, LifeBuoy, Mail, Menu, MessageCircle, X } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { ErrorBoundary } from '../ErrorBoundary'
import { Modal } from '../ui/Modal'
import { Button, Input } from '../ui/primitives'
import { useToast } from '../ui/Toast'
import { brand } from '../../config/brand'
import { copyText } from '../../lib/utils'

export function AppLayout() {
  const [drawer, setDrawer] = useState(false)
  const [referral, setReferral] = useState(false)
  const [help, setHelp] = useState(false)
  const { pathname } = useLocation()
  const toast = useToast()
  const referralLink = 'https://localocto.com/r/adarsh' // TODO: real referral link

  useEffect(() => {
    setDrawer(false)
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="min-h-screen bg-canvas">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] border-r border-line bg-canvas lg:block">
        <Sidebar onReferral={() => setReferral(true)} />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setDrawer(true)} className="-ml-1 rounded-lg p-2 hover:bg-canvas" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand-700 text-xs font-medium text-white">{brand.shortName}</span>
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
            <Sidebar onNavigate={() => setDrawer(false)} onReferral={() => { setDrawer(false); setReferral(true) }} />
          </aside>
        </div>
      )}

      <main className="lg:pl-[272px]">
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
        className="fixed bottom-5 right-5 z-40 flex size-14 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-lg transition hover:bg-brand-800 sm:bottom-6 sm:right-6"
        aria-label="Help"
      >
        <MessageCircle className="size-6" />
      </button>

      <Modal open={help} onClose={() => setHelp(false)} title="Need help?">
        <div className="space-y-3">
          <p className="text-[15px] text-muted">Our team usually replies within a few hours on business days.</p>
          <a href={`mailto:${brand.supportEmail}`} className="flex items-center gap-3 rounded-xl border border-line p-4 hover:bg-canvas">
            <Mail className="size-5 text-brand-700" />
            <span>
              <span className="block font-medium">Email support</span>
              <span className="text-sm text-muted">{brand.supportEmail}</span>
            </span>
          </a>
          <div className="flex items-center gap-3 rounded-xl border border-line p-4">
            <LifeBuoy className="size-5 text-brand-700" />
            <span>
              <span className="block font-medium">Help centre</span>
              <span className="text-sm text-muted">Guides and how-to articles — coming soon</span>
            </span>
          </div>
        </div>
      </Modal>

      <Modal open={referral} onClose={() => setReferral(false)} title="Refer a Friend">
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-brand-50 p-4">
            <Gift className="size-6 text-brand-700" />
            <p className="text-[15px]">
              Earn <b className="text-brand-700">{brand.referralReward}</b> for every business that signs up with your link.
            </p>
          </div>
          <div className="flex gap-2">
            <Input readOnly value={referralLink} />
            <Button
              icon={Copy}
              onClick={async () => toast((await copyText(referralLink)) ? 'Referral link copied' : 'Could not copy', 'success')}
            >
              Copy
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
