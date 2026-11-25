// src/components/AccountSettings.tsx
// Account settings (user menu). Everyone sees their name and email.
// Agency accounts also create client logins here: name, email, password and which business they can open.
// Logins made here are always client accounts (no agency rights). No email is sent; share the details yourself.

import { useCallback, useEffect, useState } from 'react'
import { Copy, Eye, EyeOff, RefreshCw, Trash2 } from 'lucide-react'
import { Modal } from './ui/Modal'
import { Badge, Button, Input, Label } from './ui/primitives'
import { useStore } from '../store/AppStore'
import { useAuth } from '../store/AuthProvider'
import { useToast } from './ui/Toast'
import { db, invokeFn } from '../lib/supabase'
import { copyText } from '../lib/utils'

interface Login {
  user_id: string
  email: string
  full_name: string
  account_type: 'agency' | 'client'
}

/** 12 characters, no look-alikes (0/O, 1/l/I) so it is easy to read out. */
function makePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return [...bytes].map((b) => chars[b % chars.length]).join('')
}

const selectClass =
  'h-10 w-full cursor-pointer rounded-lg border border-line bg-white px-3 text-[15px] text-ink outline-none transition focus:border-brand-500 focus:ring-3 focus:ring-brand-100'

export function AccountSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, isAgency } = useAuth()
  const { businesses, activeBusinessId, mode, refreshBusinesses } = useStore()
  const toast = useToast()

  const NEW = '__new__' // "+ New business for this client"
  const [businessId, setBusinessId] = useState(activeBusinessId ?? '')
  const [newBusiness, setNewBusiness] = useState('')
  const isNew = businessId === NEW
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState(makePassword)
  const [show, setShow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ email: string; password: string; business: string } | null>(null)
  const [logins, setLogins] = useState<Login[] | null>(null)
  // Saved client passwords (shown to agency logins), which ones are visible, and the one being reset
  const [passwords, setPasswords] = useState<Record<string, string | null>>({})
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [resetting, setResetting] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState<Login | null>(null)

  const businessName = isNew ? newBusiness.trim() : (businesses.find((b) => b.id === businessId)?.name ?? '')

  const load = useCallback(async () => {
    if (!businessId || isNew || mode !== 'live') return setLogins([])
    const { data, error } = await db().rpc('business_logins', { p_business: businessId })
    if (error) toast(error.message, 'error')
    setLogins((data ?? []) as Login[])
    const res = await invokeFn<{ passwords: Record<string, string | null> }>('client-login', { action: 'passwords', businessId }).catch(() => null)
    setPasswords(res?.passwords ?? {})
  }, [businessId, isNew, mode, toast])

  useEffect(() => {
    if (open) {
      setBusinessId((b) => b || activeBusinessId || businesses[0]?.id || '')
      setCreated(null)
    }
  }, [open, activeBusinessId, businesses])

  useEffect(() => {
    if (open && isAgency) {
      setLogins(null)
      void load()
    }
  }, [open, isAgency, load])

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const valid = businessId && (!isNew || newBusiness.trim()) && name.trim() && emailOk && password.length >= 8

  const create = async () => {
    if (!valid || busy) return
    if (mode !== 'live') return toast('Client logins work once Supabase is connected')
    setBusy(true)
    try {
      const res = await invokeFn<{ ok: boolean; created: boolean; businessId: string }>('client-login', {
        ...(isNew ? { newBusinessName: newBusiness.trim() } : { businessId }),
        name: name.trim(),
        email: email.trim(),
        password,
      })
      if (res.created) {
        setCreated({ email: email.trim().toLowerCase(), password, business: businessName })
        toast(`Client login created for ${businessName}`)
      } else {
        toast(`${email.trim()} already had a client account — it can now open ${businessName}`)
      }
      setName('')
      setEmail('')
      setPassword(makePassword())
      if (isNew) {
        // show the new business in the switcher and in this list
        setNewBusiness('')
        await refreshBusinesses()
        setBusinessId(res.businessId)
      } else void load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create the login', 'error')
    } finally {
      setBusy(false)
    }
  }

  const resetPassword = async (l: Login) => {
    setConfirmReset(null)
    setResetting(l.user_id)
    try {
      const res = await invokeFn<{ password: string }>('client-login', { action: 'reset', businessId, userId: l.user_id })
      setPasswords((p) => ({ ...p, [l.user_id]: res.password }))
      setVisible((v) => ({ ...v, [l.user_id]: true }))
      toast(`New password set for ${l.email}. The old one no longer works.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not reset the password', 'error')
    } finally {
      setResetting(null)
    }
  }

  const remove = async (l: Login) => {
    const { error } = await db().rpc('remove_business_login', { p_business: businessId, p_user: l.user_id })
    if (error) return toast(error.message, 'error')
    toast(`${l.email} can no longer open ${businessName}`)
    void load()
  }

  const copyDetails = async () => {
    if (!created) return
    const text = `Local Octo login for ${created.business}\n${window.location.origin}\nEmail: ${created.email}\nPassword: ${created.password}`
    toast((await copyText(text)) ? 'Login details copied' : 'Could not copy', 'success')
  }

  return (
    <Modal open={open} onClose={onClose} title="Account settings" size={isAgency ? 'lg' : 'md'}>
      {/* Own account */}
      <div className="rounded-lg border border-line p-4">
        <div className="flex items-center gap-2">
          <p className="text-[15px] font-semibold">{user.name}</p>
          <Badge tone={isAgency ? 'green' : 'gray'}>{isAgency ? 'Agency' : 'Client'}</Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted">{user.email}</p>
      </div>

      {isAgency && (
        <>
          <h3 className="mt-6 text-[17px] font-semibold">Create a client login</h3>
          <p className="mt-0.5 text-sm text-muted">
            The client can sign in straight away with this email and password. It is a client account: it only sees approved
            templates and can't add businesses. No email is sent, so share the details with them yourself.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="cl-business" required>Business they can open</Label>
              <select id="cl-business" className={selectClass} value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
                <option value={NEW}>+ New business for this client</option>
              </select>
            </div>
            {isNew && (
              <div className="sm:col-span-2">
                <Label htmlFor="cl-newbiz" required>Client's business name</Label>
                <Input id="cl-newbiz" placeholder="e.g. Sharma Dental Clinic" value={newBusiness} onChange={(e) => setNewBusiness(e.target.value)} />
                <p className="mt-1 text-xs text-muted">
                  When the client signs in, they connect it with their Google login and the address, review link and reviews fill in
                  from their Google Business Profile.
                </p>
              </div>
            )}
            <div>
              <Label htmlFor="cl-name" required>Name</Label>
              <Input id="cl-name" placeholder="Client's name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cl-email" required>Email</Label>
              <Input id="cl-email" type="email" placeholder="client@business.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              {email && !emailOk && <p className="mt-1 text-xs text-red-600">Enter a valid email</p>}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="cl-pass" required>Password</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="cl-pass"
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
                    aria-label={show ? 'Hide password' : 'Show password'}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <Button variant="outline" icon={RefreshCw} onClick={() => setPassword(makePassword())}>New</Button>
              </div>
              {password.length < 8 && <p className="mt-1 text-xs text-red-600">At least 8 characters</p>}
            </div>
          </div>

          <Button className="mt-4 w-full" disabled={!valid || busy} onClick={create}>
            {busy ? 'Creating…' : 'Create client login'}
          </Button>

          {created && (
            <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-4">
              <p className="text-sm font-semibold">Login created — share these with the client</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">Business</dt><dd>{created.business}</dd>
                <dt className="text-muted">Email</dt><dd className="break-all">{created.email}</dd>
                <dt className="text-muted">Password</dt><dd className="font-mono">{created.password}</dd>
              </dl>
              <Button className="mt-3" variant="outline" icon={Copy} onClick={copyDetails}>Copy login details</Button>
            </div>
          )}

          <h3 className="mt-6 text-[15px] font-semibold">Who can open {businessName || 'this business'}</h3>
          <div className="mt-2 divide-y divide-line rounded-lg border border-line">
            {isNew ? (
              <p className="p-3 text-sm text-muted">The new business is created together with this login</p>
            ) : !logins ? (
              <p className="p-3 text-sm text-muted">Loading…</p>
            ) : !logins.length ? (
              <p className="p-3 text-sm text-muted">No logins yet</p>
            ) : (
              logins.map((l) => (
                <div key={l.user_id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.full_name || l.email}</p>
                    <p className="truncate text-xs text-muted">{l.email}</p>
                  </div>
                  {l.account_type === 'client' && (
                    <div className="flex items-center gap-1">
                      {passwords[l.user_id] ? (
                        <>
                          <span className="font-mono text-sm">{visible[l.user_id] ? passwords[l.user_id] : '••••••••'}</span>
                          <button
                            type="button"
                            onClick={() => setVisible((v) => ({ ...v, [l.user_id]: !v[l.user_id] }))}
                            className="rounded p-1.5 text-muted hover:bg-canvas"
                            aria-label={visible[l.user_id] ? 'Hide password' : 'Show password'}
                          >
                            {visible[l.user_id] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={async () => toast((await copyText(`Email: ${l.email}\nPassword: ${passwords[l.user_id]}`)) ? 'Login details copied' : 'Could not copy', 'success')}
                            className="rounded p-1.5 text-muted hover:bg-canvas"
                            aria-label="Copy login details"
                          >
                            <Copy className="size-4" />
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-muted">Password not saved</span>
                      )}
                      <Button variant="outline" icon={RefreshCw} disabled={resetting === l.user_id} onClick={() => setConfirmReset(l)}>
                        {resetting === l.user_id ? 'Resetting…' : 'Reset'}
                      </Button>
                    </div>
                  )}
                  <Badge tone={l.account_type === 'agency' ? 'green' : 'gray'}>{l.account_type === 'agency' ? 'Agency' : 'Client'}</Badge>
                  {l.user_id !== user.id && l.account_type === 'client' && (
                    <button
                      type="button"
                      onClick={() => remove(l)}
                      className="rounded p-1.5 text-muted hover:bg-canvas hover:text-red-600"
                      aria-label={`Remove ${l.email}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
      <Modal
        open={!!confirmReset}
        onClose={() => setConfirmReset(null)}
        title="Reset password?"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmReset(null)}>Cancel</Button>
            <Button onClick={() => confirmReset && resetPassword(confirmReset)}>Reset password</Button>
          </>
        }
      >
        <p className="text-[15px]">
          A new password is made for <span className="font-medium">{confirmReset?.email}</span>. The old password stops working, so share the new one with the client.
        </p>
      </Modal>
    </Modal>
  )
}
