// supabase/functions/_shared/renderImage.ts
// Draws the personalised review-request image: the business photo with "<Name>!" (or "<Name> Sir!" / "<Name> Ma'am!") on a white label.
// Uses ImageScript's Deno build (pure WebAssembly). The npm build needs a native add-on that
// Supabase's Edge Runtime can't load ("unsupported arch/platform").

import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts'
import decodeWebp, { init as initWebp } from 'npm:@jsquash/webp@1.5.0/decode.js'
import { FIRA_SANS_BOLD_LATIN } from './font.ts'
import { defaultPhotoUrl, labelText } from './reviewImage.ts'

const W = 800
const H = 600

let fontBytes: Uint8Array | null = null
function font(): Uint8Array {
  if (!fontBytes) fontBytes = Uint8Array.from(atob(FIRA_SANS_BOLD_LATIN), (c) => c.charCodeAt(0))
  return fontBytes
}

// ImageScript reads JPG/PNG/GIF/TIFF but not WebP. WebP photos are decoded with @jsquash/webp; its wasm is
// loaded once from a CDN (not from the package files, which the Edge Runtime may not be able to read).
const WEBP_WASM = [
  'https://cdn.jsdelivr.net/npm/@jsquash/webp@1.5.0/codec/dec/webp_dec.wasm',
  'https://unpkg.com/@jsquash/webp@1.5.0/codec/dec/webp_dec.wasm',
]
let webpReady: Promise<void> | null = null
function loadWebp(): Promise<void> {
  webpReady ??= (async () => {
    for (const url of WEBP_WASM) {
      try {
        const res = await fetch(url)
        if (res.ok) return await initWebp(await WebAssembly.compile(await res.arrayBuffer()))
      } catch { /* try the next CDN */ }
    }
    throw new Error('WebP decoder could not be loaded')
  })().catch((e) => {
    webpReady = null // retry on the next image
    throw e
  })
  return webpReady
}

function isWebp(b: Uint8Array): boolean {
  // "RIFF" .... "WEBP"
  return b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
}

/** Any photo the business uploaded (JPG, PNG, GIF, WebP) as an ImageScript image. */
async function decodePhoto(bytes: Uint8Array): Promise<Image | null> {
  if (isWebp(bytes)) {
    await loadWebp()
    const d = await decodeWebp(bytes.slice().buffer)
    const img = new Image(d.width, d.height)
    img.bitmap.set(d.data)
    return img
  }
  const decoded = await Image.decode(bytes)
  return decoded instanceof Image ? decoded : null
}

export async function renderReviewImage(photoUrl: string | null, firstName: string, gender?: string | null): Promise<Uint8Array> {
  photoUrl = photoUrl || defaultPhotoUrl()

  // Background: the business photo (or demo photo), cover-cropped to 800x600; brand purple only if it can't be loaded
  let canvas = new Image(W, H).fill(Image.rgbaToColor(154, 77, 255, 255))
  if (photoUrl && /^https?:\/\//i.test(photoUrl)) {
    try {
      const res = await fetch(photoUrl)
      if (res.ok) {
        const decoded = await decodePhoto(new Uint8Array(await res.arrayBuffer()))
        if (decoded) {
          const scale = Math.max(W / decoded.width, H / decoded.height)
          const resized = decoded.resize(Math.ceil(decoded.width * scale), Math.ceil(decoded.height * scale))
          canvas = resized.crop(Math.floor((resized.width - W) / 2), Math.floor((resized.height - H) / 2), W, H)
        }
      } else {
        console.error('review-image: photo download failed', res.status, photoUrl)
      }
    } catch (e) {
      console.error('review-image: photo could not be read', e)
    }
  }

  // Label: shrink the font until it fits 86% of the width
  const text = labelText(firstName, gender)
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
