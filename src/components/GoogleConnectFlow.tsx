// src/components/GoogleConnectFlow.tsx
// Mounted once in the app layout. Handles the ?google=… return from Google sign-in on any page,
// and owns the "Choose your Google business" picker (open it with openGooglePicker()).

import { useCallback, useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from './ui/primitives'
import { Modal } from './ui/Modal'
import { useStore } from '../store/AppStore'
import { useToast } from './ui/Toast'
import { cn } from '../lib/utils'
import type { GbpLocation } from '../types'

const PICK_EVENT = 'lo:google-pick'

/** Opens the Google business picker from anywhere in the app. */
export function openGooglePicker() {
  window.dispatchEvent(new Event(PICK_EVENT))
}

export function GoogleConnectFlow() {
  const { googleLocations, selectGoogleLocation, syncGoogleReviews, refreshGoogle } = useStore()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [locations, setLocations] = useState<GbpLocation[] | null>(null)
  const [chosen, setChosen] = useState('')
  const [busy, setBusy] = useState(false)

  const sync = useCallback(async () => {
    try {
      const r = await syncGoogleReviews()
      toast(`${r.synced} Google review${r.synced === 1 ? '' : 's'} synced${r.added ? ` · ${r.added} new` : ''}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Google sync failed', 'error')
    }
  }, [syncGoogleReviews, toast])

  const openPicker = useCallback(async () => {
    setOpen(true)
    setLocations(null)
    try {
      const list = await googleLocations()
      setLocations(list)
      setChosen(list[0]?.locationName ?? '')
    } catch (e) {
      setOpen(false)
      toast(e instanceof Error ? e.message : 'Could not load your Google businesses', 'error')
    }
  }, [googleLocations, toast])

  useEffect(() => {
    const onPick = () => void openPicker()
    window.addEventListener(PICK_EVENT, onPick)
    return () => window.removeEventListener(PICK_EVENT, onPick)
  }, [openPicker])

  // Back from Google: ?google=connected | choose | error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search || window.location.hash.split('?')[1] || '')
    const status = params.get('google')
    if (!status) return
    const message = params.get('google_message') ?? ''
    window.history.replaceState(null, '', window.location.pathname + window.location.hash.split('?')[0])
    void (async () => {
      await refreshGoogle()
      if (status === 'connected') {
        toast('Google Business Profile connected')
        await sync()
      } else if (status === 'choose') {
        void openPicker()
      } else {
        toast(message || 'Google connection failed', 'error')
      }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal
      top
      open={open}
      onClose={() => setOpen(false)}
      title="Choose your Google business"
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!chosen || busy}
            onClick={async () => {
              const loc = locations?.find((l) => l.locationName === chosen)
              if (!loc) return
              setBusy(true)
              try {
                await selectGoogleLocation(loc)
                setOpen(false)
                toast(`Linked to ${loc.title}`)
                await sync()
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Could not link this business', 'error')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Saving…' : 'Use this business'}
          </Button>
        </>
      }
    >
      {!locations ? (
        <p className="text-sm text-muted">Loading your Google businesses…</p>
      ) : !locations.length ? (
        <p className="text-sm text-muted">No Google Business Profile found on this Google account.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted">Only businesses this Google account manages are listed. Name, address, review link and Maps link come from Google.</p>
          {locations.map((l) => (
            <label
              key={l.locationName}
              className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3', chosen === l.locationName ? 'border-brand-700 bg-brand-50' : 'border-line hover:bg-canvas')}
            >
              <input type="radio" name="gbp-location" className="mt-1 accent-brand-700" checked={chosen === l.locationName} onChange={() => setChosen(l.locationName)} />
              <span className="min-w-0">
                <span className="block font-medium">{l.title}</span>
                {l.address && <span className="flex items-center gap-1 text-sm text-muted"><MapPin className="size-3.5" /> {l.address}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  )
}
