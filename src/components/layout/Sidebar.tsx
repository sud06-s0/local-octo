// src/components/layout/Sidebar.tsx
import { useState } from 'react'
import { NavLink } from 'react-router'
import { Bell, Check, ChevronRight, ChevronsUpDown, CreditCard, Gift, LogOut, Plus, RefreshCw, Settings } from 'lucide-react'
import { navItems } from './navItems'
import { Dropdown, MenuItem } from './Dropdown'
import { brand } from '../../config/brand'
import { useStore } from '../../store/AppStore'
import { useToast } from '../ui/Toast'
import { cn, initials } from '../../lib/utils'
import { useAuth } from '../../store/AuthProvider'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/primitives'
import { BusinessDetailsForm, businessDetailsValid, type BusinessDetails } from '../BusinessDetailsForm'

export function Sidebar({ onNavigate, onReferral }: { onNavigate?: () => void; onReferral: () => void }) {
  const { state, mode, businesses, activeBusinessId, switchBusiness, createBusiness, resetDemo } = useStore()
  const { user, signOut } = useAuth()
  const toast = useToast()
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<BusinessDetails>({ name: '', address: '', reviewLink: '', mapsUrl: '' })
  const unread = state.notifications.filter((n) => !n.read).length
  const business = state.settings.business

  return (
    <div className="flex h-full flex-col">
      {/* Workspace switcher */}
      <div className="px-3 pb-3 pt-5">
        <Dropdown
          trigger={() => (
            <button className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-black/[0.03]">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-sm font-medium text-white">
                {brand.shortName}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold text-ink">{business.name}</span>
                <span className="block text-sm text-muted">Business</span>
              </span>
              <ChevronsUpDown className="size-4 text-ink" />
            </button>
          )}
        >
          {(close) => (
            <>
              <p className="px-3 pb-1 pt-1.5 text-xs font-medium uppercase tracking-wide text-muted">Businesses</p>
              <div className="max-h-64 overflow-y-auto">
                {businesses.map((b) => (
                  <MenuItem key={b.id} onClick={() => { close(); switchBusiness(b.id) }}>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded bg-brand-700 text-[10px] text-white">{initials(b.name) || brand.shortName}</span>
                    <span className="flex-1 truncate">{b.id === activeBusinessId ? business.name : b.name}</span>
                    {b.id === activeBusinessId && <Check className="size-4 text-brand-700" />}
                  </MenuItem>
                ))}
              </div>
              <MenuItem
                onClick={() => {
                  close()
                  if (mode === 'demo') return toast('Adding businesses works once Supabase is connected')
                  setDraft({ name: '', address: '', reviewLink: '', mapsUrl: '' })
                  setAddOpen(true)
                }}
              >
                <Plus className="size-4 text-muted" /> Add business
              </MenuItem>
            </>
          )}
        </Dropdown>
      </div>

      <div className="border-t border-line px-3 pt-1.5">
        <NavLink
          to="/notifications"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-[15px] transition',
              isActive ? 'border-brand-200 bg-brand-50 text-ink' : 'border-line bg-black/[0.015] text-ink/85 hover:bg-black/[0.03]',
            )
          }
        >
          <span className="flex size-6 items-center justify-center rounded-md bg-black/[0.04]">
            <Bell className="size-4" />
          </span>
          <span className="flex-1">Notifications</span>
          {unread > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-700 px-1.5 text-xs font-medium text-white">
              {unread}
            </span>
          )}
        </NavLink>
      </div>

      <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {navItems.map(({ to, label, icon: Icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition-colors',
                isActive ? 'bg-brand-50 font-medium text-ink ring-1 ring-brand-100' : 'text-ink hover:bg-black/[0.03]',
              )
            }
          >
            <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
            <span className="flex-1">{label}</span>
            {badge && <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-100">{badge}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Referral */}
      <div className="px-3 pb-3">
        <button
          onClick={onReferral}
          className="flex w-full items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/70 p-3 text-left transition hover:bg-brand-50"
        >
          <span className="flex size-10 items-center justify-center rounded-lg bg-brand-100/80">
            <Gift className="size-5 text-brand-700" />
          </span>
          <span className="flex-1">
            <span className="block text-[15px] font-semibold text-ink">Refer a Friend</span>
            <span className="block text-xs text-muted">
              Earn <b className="font-semibold text-brand-700">{brand.referralReward}</b> per referral
            </span>
          </span>
          <ChevronRight className="size-4 text-muted" />
        </button>
      </div>

      {/* User */}
      <div className="border-t border-line px-3 py-3">
        <Dropdown
          placement="top"
          trigger={() => (
            <button className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-black/[0.03]">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-black/[0.05] text-sm text-ink">{initials(user.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold text-ink">{user.name}</span>
                <span className="block truncate text-sm text-muted">{user.email}</span>
              </span>
              <ChevronsUpDown className="size-4 text-ink" />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem onClick={() => { close(); toast('Account settings coming soon') }}>
                <Settings className="size-4 text-muted" /> Account settings
              </MenuItem>
              <MenuItem onClick={() => { close(); toast('Billing is managed through Cashfree') }}>
                <CreditCard className="size-4 text-muted" /> Billing
              </MenuItem>
              {mode === 'demo' && (
                <MenuItem onClick={() => { close(); resetDemo(); toast('Sample data restored') }}>
                  <RefreshCw className="size-4 text-muted" /> Reset sample data
                </MenuItem>
              )}
              <div className="my-1 h-px bg-line" />
              <MenuItem danger onClick={() => { close(); if (mode === 'demo') toast('Signed out (demo)'); else signOut() }}>
                <LogOut className="size-4" /> Sign out
              </MenuItem>
            </>
          )}
        </Dropdown>
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add business"
        footer={
          <>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              disabled={!businessDetailsValid(draft) || busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await createBusiness({ name: draft.name.trim(), address: draft.address.trim(), reviewLink: draft.reviewLink.trim(), mapsUrl: draft.mapsUrl.trim() })
                  setAddOpen(false)
                  toast(`${draft.name.trim()} created`)
                  onNavigate?.()
                } catch {
                  /* error toast shown by the store */
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </>
        }
      >
        <BusinessDetailsForm value={draft} onChange={setDraft} />
      </Modal>
    </div>
  )
}
