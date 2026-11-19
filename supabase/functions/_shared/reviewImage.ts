// supabase/functions/_shared/reviewImage.ts
// Label text and signed URLs for the personalised review-request image (drawing lives in renderImage.ts).

import { functionsUrl } from './supabase.ts'

const LATIN = /^[\x20-\x7E -ÿ‘-”]+$/

/** First name for the label; falls back when the name uses a script the font doesn't cover. */
export function labelText(firstName: string, gender?: string | null): string {
  const name = (firstName || '').trim().split(/\s+/)[0] ?? ''
  // Very long single names would get too small to read; fall back to a friendly generic label
  if (!(name && name.length <= 22 && LATIN.test(name))) return 'Thank you!'
  // Same as the WhatsApp message: "Adarsh Sir!" / "Varsha Ma'am!"
  const title = gender === 'male' ? ' Sir' : gender === 'female' ? " Ma'am" : ''
  return `${name}${title}!`
}

/** Demo photo used when a business hasn't uploaded its own (public/default-personal.jpg in the app). */
export function defaultPhotoUrl(): string {
  return Deno.env.get('DEFAULT_REVIEW_IMAGE_URL') || 'https://local-octo.vercel.app/default-personal.jpg'
}

/* ---------- URLs ---------- */
async function sign(value: string): Promise<string> {
  const secret = Deno.env.get('IMAGE_SIGNING_SECRET') || Deno.env.get('CRON_SECRET') || 'change-me'
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return [...new Uint8Array(sig)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Short fingerprint of the uploaded photo: a new photo gives a new image URL,
 *  so WhatsApp (which keeps a copy per URL) downloads the new one instead of reusing the old. */
export function photoVersion(photoUrl?: string | null): string {
  let h = 2166136261
  for (const c of photoUrl ?? '') h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0).toString(36)
}

/** Image URL for a real contact (name comes from the database). */
export function contactImageUrl(token: string, photoUrl?: string | null, gender?: string | null): string {
  return `${functionsUrl()}/review-image?t=${token}&v=${photoVersion(`${photoUrl ?? ''}|${gender ?? ''}`)}`
}

/** Signed image URL for test messages (any name, but only for that business). */
export async function testImageUrl(businessId: string, name: string, photoUrl?: string | null): Promise<string> {
  const n = labelText(name).replace(/!$/, '')
  return `${functionsUrl()}/review-image?b=${businessId}&n=${encodeURIComponent(n)}&s=${await sign(`${businessId}:${n}`)}&v=${photoVersion(photoUrl)}`
}

export async function verifyTestSignature(businessId: string, name: string, s: string): Promise<boolean> {
  return s.length === 24 && (await sign(`${businessId}:${name}`)) === s
}
