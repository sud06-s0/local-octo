// src/components/BusinessDetailsForm.tsx
// Shared fields for onboarding, "Add location" and editing the business on the Dashboard.
import { useEffect, useRef, useState } from 'react'
import { CircleCheck, ExternalLink, Search, Star } from 'lucide-react'
import { Input, Label } from './ui/primitives'
import { GoogleG } from './ui/BrandIcons'
import { useStore } from '../store/AppStore'
import type { GooglePlaceResult } from '../types'

export interface BusinessDetails {
  name: string
  address: string
  reviewLink: string
  mapsUrl: string
  /** Set when picked from Google; the profile and reviews are imported on save */
  placeId?: string
}

/** Search Google for the business; picking a result fills the form. */
function GoogleBusinessSearch({ onPick, pickedId }: { onPick: (r: GooglePlaceResult) => void; pickedId?: string }) {
  const { searchGoogle } = useStore()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GooglePlaceResult[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (query.trim().length < 3) {
      setResults([])
      return
    }
    timer.current = setTimeout(async () => {
      setBusy(true)
      setError('')
      try {
        setResults(await searchGoogle(query))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        setBusy(false)
      }
    }, 450)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query, searchGoogle])

  return (
    <div className="rounded-xl border border-line bg-canvas/60 p-4">
      <p className="flex items-center gap-2 text-[15px] font-medium">
        <GoogleG className="size-4" /> Find your business on Google
      </p>
      <p className="mt-0.5 text-xs text-muted">Pick it and we fill in the details, review link and rating, and import the latest reviews.</p>
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Business name and area, e.g. Local Octo J P Nagar" className="pl-9" />
      </div>
      {busy && <p className="mt-2 text-xs text-muted">Searching Google…</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {results.length > 0 && (
        <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-white">
          {results.map((r) => (
            <li key={r.placeId}>
              <button
                type="button"
                onClick={() => {
                  onPick(r)
                  setResults([])
                  setQuery('')
                }}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-brand-50/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className="block truncate text-xs text-muted">{r.address}</span>
                </span>
                {r.rating != null && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                    <Star className="size-3.5 text-star" fill="currentColor" strokeWidth={0} /> {r.rating.toFixed(1)} ({r.reviewCount})
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {pickedId && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-brand-700">
          <CircleCheck className="size-3.5" /> Linked to Google. Reviews and rating import when you save.
        </p>
      )}
    </div>
  )
}

export const isHttpUrl = (v: string) => /^https?:\/\/\S+\.\S+/i.test(v.trim())

export function businessDetailsValid(d: BusinessDetails) {
  return d.name.trim().length > 0 && (!d.reviewLink || isHttpUrl(d.reviewLink)) && (!d.mapsUrl || isHttpUrl(d.mapsUrl))
}

export function BusinessDetailsForm({ value, onChange }: { value: BusinessDetails; onChange: (v: BusinessDetails) => void }) {
  const set = (k: keyof BusinessDetails, v: string) => onChange({ ...value, [k]: v })
  return (
    <div className="space-y-4">
      <GoogleBusinessSearch
        pickedId={value.placeId}
        onPick={(r) =>
          onChange({
            ...value,
            name: r.name,
            address: r.address,
            placeId: r.placeId,
            reviewLink: `https://search.google.com/local/writereview?placeid=${r.placeId}`,
            mapsUrl: `https://www.google.com/maps/place/?q=place_id:${r.placeId}`,
          })
        }
      />
      <div>
        <Label htmlFor="bd-name" required>Business name</Label>
        <Input id="bd-name" value={value.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div>
        <Label htmlFor="bd-address">Address</Label>
        <Input id="bd-address" value={value.address} onChange={(e) => set('address', e.target.value)} placeholder="Street, area, city" />
      </div>
      <div>
        <Label htmlFor="bd-review">Google review link</Label>
        <Input id="bd-review" value={value.reviewLink} onChange={(e) => set('reviewLink', e.target.value)} placeholder="https://g.page/r/…/review" />
        {value.reviewLink && !isHttpUrl(value.reviewLink) && <p className="mt-1 text-xs text-red-600">Paste the full link starting with https://</p>}
        <p className="mt-1.5 text-xs text-muted">
          Google Business Profile → <b>Ask for reviews</b> → copy the link. Review requests can't go out until this is set.{' '}
          <a href="https://business.google.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-brand-700 hover:underline">
            Open Google <ExternalLink className="size-3" />
          </a>
        </p>
      </div>
      <div>
        <Label htmlFor="bd-maps">Google Maps link</Label>
        <Input id="bd-maps" value={value.mapsUrl} onChange={(e) => set('mapsUrl', e.target.value)} placeholder="https://maps.app.goo.gl/…" />
        {value.mapsUrl && !isHttpUrl(value.mapsUrl) && <p className="mt-1 text-xs text-red-600">Paste the full link starting with https://</p>}
      </div>
    </div>
  )
}
