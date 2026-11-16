// src/components/GoogleConnectCard.tsx
// Google Business Profile card on Integrations: Connect with Google (OAuth), pick the location,
// sync all reviews, disconnect. Also handles the ?google=… return from Google.

import { useCallback, useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import { Badge, Button, Card } from './ui/primitives'
import { GoogleG } from './ui/BrandIcons'
import { Modal } from './ui/Modal'
import { useStore } from '../store/AppStore'
import { useToast } from './ui/Toast'
import { cn, timeAgo } from '../lib/utils'
import type { GbpLocation } from '../types'

export function GoogleConnectCard() {
  const { google, connectGoogle, googleLocations, selectGoogleLocation, syncGoogleReviews, disconnectGoogle, refreshGoogle } = useStore()
  const toast = useToast()
  const [busy, setBusy] = useState<'' | 'connect' | 'sync' | 'disconnect' | 'pick'>('')
  const [picker, setPicker] = useState(false)
  const [locations, setLocations] = useState<GbpLocation[] | null>(null)
  const [chosen, setChosen] = useState('')

  const run = async (what: typeof busy, fn: () => Promise<void>) => {
    setBusy(what)
    try {
      await fn()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Google request failed', 'error')
    } finally {
      setBusy('')
    }
  }

  const sync = useCallback(async () => {
    const r = await syncGoogleReviews()
    toast(`${r.synced} Google review${r.synced === 1 ? '' : 's'} synced${r.added ? ` · ${r.added} new` : ''}`)
  }, [syncGoogleReviews, toast])

  const openPicker = useCallback(async () => {
    setPicker(true)
    setLocations(null)
    try {
      const list = await googleLocations()
      setLocations(list)
      setChosen(list[0]?.locationName ?? '')
    } catch (e) {
      setPicker(false)
      toast(e instanceof Error ? e.message : 'Could not load your Google businesses', 'error')
    }
  }, [googleLocations, toast])

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
        setBusy('sync')
        try {
          await sync()
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Google sync failed', 'error')
        } finally {
          setBusy('')
        }
      } else if (status === 'choose') {
        void openPicker()
      } else {
        toast(message || 'Google connection failed', 'error')
      }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const connected = !!google?.connected
  const ready = connected && !google?.needsLocation

  return (
    <>
      <Card className="flex flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-canvas"><GoogleG className="size-5" /></span>
          {ready ? <Badge tone="green">Connected</Badge> : connected ? <Badge tone="gray">Choose business</Badge> : <Badge tone="gray">Not connected</Badge>}
        </div>
        <p className="mt-4 text-[16px] font-semibold">Google Business Profile</p>
        <p className="mt-1 flex-1 text-sm text-muted">
          {ready ? (
            <>
              {google?.locationTitle} · {google?.email}
              <span className="block text-xs">{google?.lastSyncAt ? `Synced ${timeAgo(google.lastSyncAt)}` : 'Not synced yet'}</span>
            </>
          ) : connected ? (
            `Signed in as ${google?.email}. Pick which business to use.`
          ) : (
            'All your reviews, and replies posted straight to Google'
          )}
        </p>
        {!connected && (
          <Button className="mt-4 w-full" size="sm" disabled={!!busy} onClick={() => run('connect', connectGoogle)}>
            {busy === 'connect' ? 'Opening Google…' : 'Connect with Google'}
          </Button>
        )}
        {connected && !ready && (
          <div className="mt-4 flex gap-2">
            <Button className="flex-1" size="sm" disabled={!!busy} onClick={openPicker}>Choose business</Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('disconnect', disconnectGoogle)}>Disconnect</Button>
          </div>
        )}
        {ready && (
          <div className="mt-4 flex gap-2">
            <Button className="flex-1" size="sm" disabled={!!busy} onClick={() => run('sync', sync)}>
              {busy === 'sync' ? 'Syncing…' : 'Sync reviews'}
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={openPicker}>Change</Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('disconnect', disconnectGoogle)}>
              {busy === 'disconnect' ? '…' : 'Disconnect'}
            </Button>
          </div>
        )}
      </Card>

      <Modal
        open={picker}
        onClose={() => setPicker(false)}
        title="Choose your Google business"
        footer={
          <>
            <Button variant="outline" onClick={() => setPicker(false)}>Cancel</Button>
            <Button
              disabled={!chosen || busy === 'pick'}
              onClick={() =>
                run('pick', async () => {
                  const loc = locations?.find((l) => l.locationName === chosen)
                  if (!loc) return
                  await selectGoogleLocation(loc)
                  setPicker(false)
                  toast(`Using ${loc.title}`)
                  await sync()
                })
              }
            >
              {busy === 'pick' ? 'Saving…' : 'Use this business'}
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
    </>
  )
}
