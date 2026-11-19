// src/pages/ReviewPage.tsx
// Public review page (no login): local-octo.vercel.app/review?t=<contact token> or ?b=<business public key>.
// Four big faces. Happy (5) and Good (4) open Google's review page straight away;
// Bad (2) and Worse (1) get a review form (review text + name); "Submit review" saves it in the app only
// (Reviews → Negative Reviews) and Google never opens.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
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

  const [info, setInfo] = useState<{ businessName: string; firstName: string; knownContact?: boolean } | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [rating, setRating] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'' | 'thanks' | 'google'>('')

  useEffect(() => {
    document.title = 'Leave a review'
    if (!API.startsWith('http')) {
      setInfo({ businessName: 'Your Business', firstName: '', knownContact: false }) // demo build without Supabase
      return
    }
    call<{ businessName: string; firstName: string; knownContact: boolean }>(undefined, `?${t ? `t=${t}` : `b=${b}`}`)
      .then(setInfo)
      .catch((e) => {
        setError(e.message)
        setInvalid(true)
      })
  }, [t, b])

  const submit = async (r: number) => {
    setBusy(true)
    setError('')
    const positive = r >= 4
    try {
      const res = API.startsWith('http')
        ? await call<{ reviewLink: string | null }>({
            method: 'POST',
            body: JSON.stringify({ t, b, rating: r, text, ...(positive || info?.knownContact ? {} : { name }) }),
          })
        : { reviewLink: null }
      if (positive && res.reviewLink) {
        // Happy / Good: straight to Google's review page
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
    if (r >= 4) void submit(r) // Happy / Good: record the tap, then open Google directly
  }

  const positive = rating !== null && rating >= 4

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-xl overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-line">
        <div className="bg-brand-700 px-6 py-6 text-center text-white">
          {info ? (
            <p className="text-[22px] font-semibold">{info.businessName}</p>
          ) : (
            <span className="mx-auto block h-7 w-44 animate-pulse rounded-md bg-white/25" />
          )}
          <p className="mt-1 text-sm text-brand-100">{info?.firstName ? `Hi ${info.firstName}, ` : ''}how was your experience?</p>
        </div>

        <div className="p-5 sm:p-7">
          {invalid && <p className="py-10 text-center text-muted">{error}</p>}

          {done === 'thanks' && (
            <div className="py-10 text-center">
              <p className="text-5xl">🙏</p>
              <p className="mt-4 text-xl font-semibold">Thank you for your review!</p>
              <p className="mt-1 text-muted">{`${info?.businessName ?? 'We'} really appreciate${info?.businessName ? 's' : ''} you taking the time.`}</p>
            </div>
          )}

          {done === 'google' && (
            <div className="py-10 text-center">
              <Loader2 className="mx-auto size-6 animate-spin text-brand-700" />
              <p className="mt-4 font-semibold">Opening Google…</p>
            </div>
          )}

          {!invalid && !done && (
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

              {rating !== null && !positive && (
                <div className="mt-6">
                  <label htmlFor="review-text" className="text-sm font-medium">Write your review</label>
                  <textarea
                    id="review-text"
                    rows={4}
                    value={text}
                    maxLength={4000}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Tell us about your experience…"
                    className="mt-1.5 w-full rounded-lg border border-line px-3 py-2.5 text-[15px] outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
                  />

                  {!info?.knownContact && (
                    <input
                      aria-label="Your name"
                      placeholder="Your name"
                      value={name}
                      maxLength={120}
                      onChange={(e) => setName(e.target.value)}
                      className="mt-3 w-full rounded-lg border border-line px-3 py-2.5 text-[15px] outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
                    />
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => submit(rating!)}
                    className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 text-[16px] font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
                  >
                    {busy && <Loader2 className="size-4 animate-spin" />} Submit review
                  </button>
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
