// src/lib/image.ts
// Turns any photo the browser can show (JPG, PNG, WebP, iPhone HEIC on Safari, huge camera photos)
// into a normal JPEG of at most `max` px. The review-image function can only read JPG/PNG and has a
// short time limit, so message photos are always converted before upload.

async function decode(file: Blob): Promise<{ src: CanvasImageSource; w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(file)
    return { src: bmp, w: bmp.width, h: bmp.height }
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return { src: img, w: img.naturalWidth, h: img.naturalHeight }
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
}

export async function toJpegBlob(file: Blob, max = 1600, quality = 0.85): Promise<Blob> {
  const { src, w, h } = await decode(file)
  if (!w || !h) throw new Error("Couldn't read this photo. Please choose a JPG or PNG photo.")
  const scale = Math.min(1, max / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff' // transparent PNGs get a white background instead of black
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error("Couldn't read this photo. Please choose a JPG or PNG photo.")
  return blob
}
