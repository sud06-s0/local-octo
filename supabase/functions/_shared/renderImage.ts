// supabase/functions/_shared/renderImage.ts
// Draws the personalised review-request image: the business photo with "<Name>!" on a white label.
// Uses ImageScript's Deno build (pure WebAssembly). The npm build needs a native add-on that
// Supabase's Edge Runtime can't load ("unsupported arch/platform").

import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts'
import { FIRA_SANS_BOLD_LATIN } from './font.ts'
import { defaultPhotoUrl, labelText } from './reviewImage.ts'

const W = 800
const H = 600

let fontBytes: Uint8Array | null = null
function font(): Uint8Array {
  if (!fontBytes) fontBytes = Uint8Array.from(atob(FIRA_SANS_BOLD_LATIN), (c) => c.charCodeAt(0))
  return fontBytes
}

export async function renderReviewImage(photoUrl: string | null, firstName: string): Promise<Uint8Array> {
  photoUrl = photoUrl || defaultPhotoUrl()

  // Background: the business photo (or demo photo), cover-cropped to 800x600; brand green only if it can't be loaded
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
      } else {
        console.error('review-image: photo download failed', res.status, photoUrl)
      }
    } catch (e) {
      console.error('review-image: photo could not be read', e)
    }
  }

  // Label: shrink the font until it fits 86% of the width
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
