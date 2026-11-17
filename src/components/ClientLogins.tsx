// src/components/ClientLogins.tsx
// Agency only: which logins can open the active business. Add a client by the email they signed up with.

import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Modal } from './ui/Modal'
import { Badge, Button, Input, Label } from './ui/primitives'
import { useStore } from '../store/AppStore'
import { useAuth } from '../store/AuthProvider'
import { useToast } from './ui/Toast'
import { db } from '../lib/supabase'

interface Login {
  user_id: string
  email: string
  full_name: string
  account_type: 'agency' | 'client'
}

export function ClientLogins({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeBusinessId, state } = useStore()
  const { user } = useAuth()
  const toast = useToast()
  const [logins, setLogins] = useState<Login[] | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!activeBusinessId) return
    const { data, error } = await db().rpc('business_logins', { p_business: activeBusinessId })
    if (error) toast(error.message, 'error')
    setLogins((data ?? []) as Login[])
  }, [activeBusinessId, toast])

  useEffect(() => {
    if (open) {
      setLogins(null)
      void load()
    }
  }, [open, load])

  const add = async () => {
    setBusy(true)
    const { error } = await db().rpc('add_business_login', { p_business: activeBusinessId, p_email: email.trim() })
    setBusy(false)
    if (error) return toast(error.message, 'error')
    toast(`${email.trim()} can now open ${state.settings.business.name}`)
    setEmail('')
    void load()
  }

  const remove = async (l: Login) => {
    const { error } = await db().rpc('remove_business_login', { p_business: activeBusinessId, p_user: l.user_id })
    if (error) return toast(error.message, 'error')
    toast(`${l.email} removed`)
    void load()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Logins for ${state.settings.business.name}`}>
      <Label htmlFor="client-email">Add a client login</Label>
      <div className="flex gap-2">
        <Input id="client-email" type="email" placeholder="client@business.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button disabled={!/\S+@\S+\.\S+/.test(email) || busy} onClick={add}>{busy ? 'Adding…' : 'Add'}</Button>
      </div>
      <p className="mt-1 text-xs text-muted">They sign up first on the login page with this email, then you add them here.</p>

      <div className="mt-5 divide-y divide-line rounded-lg border border-line">
        {!logins ? (
          <p className="p-3 text-sm text-muted">Loading…</p>
        ) : (
          logins.map((l) => (
            <div key={l.user_id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.full_name || l.email}</p>
                <p className="truncate text-xs text-muted">{l.email}</p>
              </div>
              <Badge tone={l.account_type === 'agency' ? 'green' : 'gray'}>{l.account_type === 'agency' ? 'Agency' : 'Client'}</Badge>
              {l.user_id !== user.id && (
                <button type="button" onClick={() => remove(l)} className="rounded p-1.5 text-muted hover:bg-canvas hover:text-red-600" aria-label={`Remove ${l.email}`}>
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}
