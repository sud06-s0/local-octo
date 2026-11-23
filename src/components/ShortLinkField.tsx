// src/components/ShortLinkField.tsx
// Short review link code (5–6 letters/digits). Review links become review.localocto.com/r?t=<code>-<contact code>.
// Client logins can set it once; agency logins can change it any time (the database enforces this too).
import { useState } from 'react'
import { useStore } from '../store/AppStore'
import { useAuth } from '../store/AuthProvider'
import { useToast } from './ui/Toast'
import { Button, Input, Label } from './ui/primitives'

export function ShortLinkField() {
  const { state, setShortCode } = useStore()
  const { isAgency } = useAuth()
  const toast = useToast()
  const current = state.settings.business.shortCode ?? ''
  const [code, setCode] = useState(current)
  const [busy, setBusy] = useState(false)
  const locked = !!current && !isAgency
  const clean = code.trim().toLowerCase()
  const valid = /^[a-z0-9]{5,6}$/.test(clean)

  return (
    <div className="mt-5 border-t border-line pt-5">
      <Label htmlFor="bd-short">Short review link</Label>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-sm text-muted">review.localocto.com/r?t=</span>
        <Input
          id="bd-short"
          value={code}
          maxLength={6}
          disabled={locked || busy}
          placeholder="sirmv"
          onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
        />
        {!locked && (
          <Button
            variant="outline"
            disabled={!valid || clean === current || busy}
            onClick={async () => {
              setBusy(true)
              const err = await setShortCode(clean)
              setBusy(false)
              if (err) toast(err, 'error')
              else toast('Short link saved')
            }}
          >
            {busy ? 'Saving…' : 'Set'}
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted">
        5 or 6 letters or numbers. Messages then carry short links like <span className="font-mono">r?t={clean || 'sirmv'}-ab12</span> (the last
        part is each customer's code, so clicks are still tracked).{' '}
        {locked ? 'Already set. Ask your agency to change it.' : isAgency ? 'Agency logins can change it any time.' : 'You can set it only once.'}
      </p>
    </div>
  )
}
