// supabase/functions/_shared/reviewImage.ts
// Builds the personalised review-request image: the business photo with "<Name>!" on a white label.

// ImageScript's npm build still calls the Deno 1 API `Deno.core.encode`; provide it on Deno 2.
// deno-lint-ignore no-explicit-any
const D = Deno as any
D.core ??= {}
D.core.encode ??= (s: string) => new TextEncoder().encode(s)

import { FIRA_SANS_BOLD_LATIN } from './font.ts'
import { functionsUrl } from './supabase.ts'

const W = 800
const H = 600
const LATIN = /^[\x20-\x7E -ÿ‘-”]+$/

let fontBytes: Uint8Array | null = null
function font(): Uint8Array {
  if (!fontBytes) fontBytes = Uint8Array.from(atob(FIRA_SANS_BOLD_LATIN), (c) => c.charCodeAt(0))
  return fontBytes
}

/** First name for the label; falls back when the name uses a script the font doesn't cover. */
export function labelText(firstName: string): string {
  const name = (firstName || '').trim().split(/\s+/)[0] ?? ''
  // Very long single names would get too small to read; fall back to a friendly generic label
  return name && name.length <= 22 && LATIN.test(name) ? `${name}!` : 'Thank you!'
}

export async function renderReviewImage(photoUrl: string | null, firstName: string): Promise<Uint8Array> {
  const { Image } = await import('npm:imagescript@1.3.0')

  // Background: the business photo, cover-cropped to 800x600, or brand green if none/unreadable
  let canvas = new Image(W, H).fill(Image.rgbaToColor(23, 103, 46, 255))
  if (photoUrl && /^https?:\/\//i.test(photoUrl)) {
    try {
      const res = await fetch(photoUrl)
      if (res.ok) {
        const decoded = await Image.decode(new Uint8Array(await res.arrayBuffer()))
        if (decoded instanceof Image) {
          const scale = Math.max(W / decoded.width, H / decoded.height)
          const resized = decoded.resize(Math.ceil(decoded.width * scale), Math.ceil(decoded.height * scale))
          canvas = resized.crop(Math.floor((resized.width - W) / 2), Math.floor((resized.height - H) / 2), W, H)
        }
      }
    } catch {
      /* keep the green background */
    }
  }

  // Label: shrink the font until it fits 80% of the width
  const text = labelText(firstName)
  let size = 72
  let rendered = await Image.renderText(font(), size, text, Image.rgbaToColor(17, 17, 17, 255))
  while (rendered.width > W * 0.86 && size > 30) {
    size -= 6
    rendered = await Image.renderText(font(), size, text, Image.rgbaToColor(17, 17, 17, 255))
  }
  const padX = Math.round(size * 0.4)
  const padY = Math.round(size * 0.12)
  const label = new Image(rendered.width + padX * 2, rendered.height + padY * 2).fill(0xffffffff).roundCorners(Math.round(size * 0.22))
  label.composite(rendered, padX, padY)
  canvas.composite(label, Math.round((W - label.width) / 2), H - label.height - 32)

  return await canvas.encodeJPEG(85)
}

/* ---------- URLs ---------- */
async function sign(value: string): Promise<string> {
  const secret = Deno.env.get('IMAGE_SIGNING_SECRET') || Deno.env.get('CRON_SECRET') || 'change-me'
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return [...new Uint8Array(sig)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Image URL for a real contact (name comes from the database). */
export function contactImageUrl(token: string): string {
  return `${functionsUrl()}/review-image?t=${token}`
}

/** Signed image URL for test messages (any name, but only for that business). */
export async function testImageUrl(businessId: string, name: string): Promise<string> {
  const n = labelText(name).replace(/!$/, '')
  return `${functionsUrl()}/review-image?b=${businessId}&n=${encodeURIComponent(n)}&s=${await sign(`${businessId}:${n}`)}`
}

export async function verifyTestSignature(businessId: string, name: string, s: string): Promise<boolean> {
  return s.length === 24 && (await sign(`${businessId}:${name}`)) === s
}
