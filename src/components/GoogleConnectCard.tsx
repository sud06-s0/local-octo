// src/components/GoogleConnectCard.tsx
// Google Business Profile: Connect with Google (OAuth), pick the business, sync all reviews, disconnect.
// Used on Integrations (card) and inside Business details (compact). The return from Google and the
// business picker live in GoogleConnectFlow, mounted once in the layout.

import { useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { Badge, Button, Card } from './ui/primitives'
import { GoogleG } from './ui/BrandIcons'
import { useStore } from '../store/AppStore'
import { useToast } from './ui/Toast'
import { timeAgo } from '../lib/utils'
import { openGooglePicker } from './GoogleConnectFlow'

function useGoogleActions() {
  const { google, connectGoogle, syncGoogleReviews, disconnectGoogle } = useStore()
  const toast = useToast()
  const [busy, setBusy] = useState<'' | 'connect' | 'sync' | 'disconnect'>('')
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
  const connected = !!google?.connected
  return {
    google,
    busy,
    connected,
    ready: connected && !google?.needsLocation,
    connect: () => run('connect', connectGoogle),
    disconnect: () => run('disconnect', disconnectGoogle),
    sync: () =>
      run('sync', async () => {
        const r = await syncGoogleReviews()
        toast(`${r.synced} Google review${r.synced === 1 ? '' : 's'} synced${r.added ? ` · ${r.added} new` : ''}`)
      }),
  }
}

/** Integrations page card */
export function GoogleConnectCard() {
  const { google, busy, connected, ready, connect, disconnect, sync } = useGoogleActions()
  return (
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
        <Button className="mt-4 w-full" size="sm" disabled={!!busy} onClick={connect}>
          {busy === 'connect' ? 'Opening Google…' : 'Connect with Google'}
        </Button>
      )}
      {connected && !ready && (
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" size="sm" disabled={!!busy} onClick={openGooglePicker}>Choose business</Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={disconnect}>Disconnect</Button>
        </div>
      )}
      {ready && (
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" size="sm" disabled={!!busy} onClick={sync}>
            {busy === 'sync' ? 'Syncing…' : 'Sync reviews'}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={openGooglePicker}>Change</Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={disconnect}>
            {busy === 'disconnect' ? '…' : 'Disconnect'}
          </Button>
        </div>
      )}
    </Card>
  )
}

/** Compact version at the top of Business details: linking happens only through Google sign-in */
export function GoogleLinkBox() {
  const { google, busy, connected, ready, connect } = useGoogleActions()
  return (
    <div className="rounded-xl border border-line bg-canvas/60 p-4">
      <p className="flex items-center gap-2 text-[15px] font-semibold"><GoogleG className="size-4" /> Google Business Profile</p>
      {ready ? (
        <>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-brand-700">
            <CircleCheck className="size-4" /> Linked to {google?.locationTitle}
          </p>
          <p className="mt-0.5 text-xs text-muted">Signed in as {google?.email}. Review link, Maps link and address come from Google.</p>
          <Button className="mt-3" size="sm" variant="outline" disabled={!!busy} onClick={openGooglePicker}>Change business</Button>
        </>
      ) : connected ? (
        <>
          <p className="mt-1 text-xs text-muted">Signed in as {google?.email}. Pick which of its businesses this is.</p>
          <Button className="mt-3" size="sm" disabled={!!busy} onClick={openGooglePicker}>Choose business</Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted">
            Sign in with the Google account that manages this business. Only businesses that account manages can be linked.
          </p>
          <Button className="mt-3" size="sm" disabled={!!busy} onClick={connect}>
            {busy === 'connect' ? 'Opening Google…' : 'Connect with Google'}
          </Button>
        </>
      )}
    </div>
  )
}
