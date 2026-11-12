// src/components/BusinessDetailsForm.tsx
// Shared fields for onboarding, "Add location" and editing the business on the Dashboard.
import { ExternalLink } from 'lucide-react'
import { Input, Label } from './ui/primitives'

export interface BusinessDetails {
  name: string
  address: string
  reviewLink: string
  mapsUrl: string
}

export const isHttpUrl = (v: string) => /^https?:\/\/\S+\.\S+/i.test(v.trim())

export function businessDetailsValid(d: BusinessDetails) {
  return d.name.trim().length > 0 && (!d.reviewLink || isHttpUrl(d.reviewLink)) && (!d.mapsUrl || isHttpUrl(d.mapsUrl))
}

export function BusinessDetailsForm({ value, onChange }: { value: BusinessDetails; onChange: (v: BusinessDetails) => void }) {
  const set = (k: keyof BusinessDetails, v: string) => onChange({ ...value, [k]: v })
  return (
    <div className="space-y-4">
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
