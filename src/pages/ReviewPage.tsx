// src/pages/ReviewPage.tsx
// Public review page (no login): local-octo.vercel.app/review?t=<contact token> or ?b=<business public key>.
// Four big faces: Happy (5) and Good (4) get text + photo and a "Post on Google" button;
// Bad (2) and Worse (1) only record the choice and never open Google.

import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { brand } from '../config/brand'
import { cn } from '../lib/utils'

const API = `${((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').trim()}/functions/v1/feedback`
const KEY = ((import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? '').trim()

const FACES = [
  { rating: 5, emoji: '😍', label: 'Happy' },
  { rating: 4, emoji: '🙂', label: 'Good' },
  { rating: 2, emoji: '🙁', label: 'Bad' },
  { rating: 1, emoji: '😠', label: 'Worse' },
] as const

/** Shrinks the photo to max 1600px JPEG so uploads stay small. */
async function toJpeg(file: File): Promise<string> {
  const img = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

async function call<T>(init?: RequestInit, query = ''): Promise<T> {
  const res = await fetch(`${API}${query}`, { ...init, headers: { apikey: KEY, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || 'Something went wrong')
  return body as T
}

export default function ReviewPage() {
  const params = new URLSearchParams(window.location.search)
  const t = params.get('t') ?? ''
  const b = params.get('b') ?? ''

  const [info, setInfo] = useState<{ businessName: string; firstName: string } | null>(null)
  const [error, setError] = useState('')
  const [rating, setRating] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'' | 'thanks' | 'google'>('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.title = 'Leave a review'
    if (!API.startsWith('http')) {
      setInfo({ businessName: 'Your Business', firstName: '' }) // demo build without Supabase
      return
    }
    call<{ businessName: string; firstName: string }>(undefined, `?${t ? `t=${t}` : `b=${b}`}`)
      .then(setInfo)
      .catch((e) => setError(e.message))
  }, [t, b])

  const submit = async (r: number) => {
    setBusy(true)
    setError('')
    const positive = r >= 4
    // Copy first (needs the tap), so the text is ready to paste on Google
    if (positive && text.trim()) await navigator.clipboard?.writeText(text.trim()).catch(() => {})
    try {
      const res = API.startsWith('http')
        ? await call<{ reviewLink: string | null }>({ method: 'POST', body: JSON.stringify({ t, b, rating: r, text: positive ? text : '', photo: positive ? photo : '' }) })
        : { reviewLink: null }
      if (positive && res.reviewLink) {
        setDone('google')
        window.location.assign(res.reviewLink)
      } else {
        setDone('thanks')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const pick = (r: number) => {
    setRating(r)
    if (r < 4) void submit(r) // Bad / Worse: just the choice, no text, no Google
  }

  const positive = rating !== null && rating >= 4

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-xl overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-line">
        <div className="bg-brand-700 px-6 py-6 text-center text-white">
          <p className="text-[22px] font-semibold">{info?.businessName ?? ' '}</p>
          <p className="mt-1 text-sm text-brand-100">{info?.firstName ? `Hi ${info.firstName}, ` : ''}how was your experience?</p>
        </div>

        <div className="p-5 sm:p-7">
          {!info && !error && <p className="py-10 text-center text-muted"><Loader2 className="mx-auto size-6 animate-spin" /></p>}
          {error && !info && <p className="py-10 text-center text-muted">{error}</p>}

          {info && done === 'thanks' && (
            <div className="py-10 text-center">
              <p className="text-5xl">🙏</p>
              <p className="mt-4 text-xl font-semibold">Thank you for your feedback!</p>
              <p className="mt-1 text-muted">We really appreciate you taking the time.</p>
            </div>
          )}

          {info && done === 'google' && (
            <div className="py-10 text-center">
              <Loader2 className="mx-auto size-6 animate-spin text-brand-700" />
              <p className="mt-4 font-semibold">Opening Google…</p>
              <p className="mt-1 text-sm text-muted">Your review is copied. Paste it, add your photo and tap Post.</p>
            </div>
          )}

          {info && !done && (
            <>
              <div className="grid grid-cols-4 gap-2 sm:gap-3">
                {FACES.map((f) => (
                  <button
                    key={f.rating}
                    type="button"
                    disabled={busy}
                    onClick={() => pick(f.rating)}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-2xl border-2 px-1 py-4 transition sm:py-5',
                      rating === f.rating ? 'border-brand-700 bg-brand-50' : 'border-line hover:border-brand-300 hover:bg-brand-50/50',
                    )}
                  >
                    <span className="text-5xl leading-none sm:text-6xl">{f.emoji}</span>
                    <span className="text-sm font-semibold sm:text-base">{f.label}</span>
                  </button>
                ))}
              </div>

              {positive && (
                <div className="mt-6">
                  <label htmlFor="review-text" className="text-sm font-medium">Write your review</label>
                  <textarea
                    id="review-text"
                    rows={4}
                    value={text}
                    maxLength={4000}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Tell others what you liked…"
                    className="mt-1.5 w-full rounded-lg border border-line px-3 py-2.5 text-[15px] outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
                  />

                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) setPhoto(await toJpeg(f).catch(() => ''))
                    }}
                  />
                  {photo ? (
                    <div className="relative mt-3 inline-block">
                      <img src={photo} alt="Your photo" className="h-28 rounded-lg object-cover ring-1 ring-line" />
                      <button type="button" onClick={() => setPhoto('')} className="absolute -right-2 -top-2 rounded-full bg-ink p-1 text-white" aria-label="Remove photo">
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => fileRef.current?.click()} className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-brand-300 px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50">
                      <ImagePlus className="size-4" /> Add a photo
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => submit(rating!)}
                    className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 text-[16px] font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
                  >
                    {busy && <Loader2 className="size-4 animate-spin" />} Post on Google
                  </button>
                  <p className="mt-2 text-center text-xs text-muted">Google opens with your review copied. Paste it there and add your photo.</p>
                </div>
              )}

              {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}
            </>
          )}
        </div>
      </div>
      <p className="mt-6 text-center text-xs text-muted">Powered by {brand.appName}</p>
    </div>
  )
}
