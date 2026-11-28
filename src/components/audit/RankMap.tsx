// src/components/audit/RankMap.tsx
// Rank heatmap: the grid's ranks as pins on a Google map (Map Tiles API), or OpenStreetMap if no Google key is set.
// Laid out in % of a square box, so it fills the card at any width — on screen and in the PDF.
// With `drill`, clicking a dot opens the Competition Drilldown (top 5 businesses at that point) from the audit-drill function.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Loader2, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { googleTileSession, googleTileUrl } from '../../lib/googleTiles'
import { Stars } from '../ui/primitives'

const BOX = 800 // logical px the map is worked out at; everything is placed in % of it
const DRILL_API = `${((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').trim()}/functions/v1/audit-drill`
const API_KEY = ((import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? '').trim()

export const rankText = (r: number) => (r > 20 ? '20+' : String(r))
/** 1–3 green, 4–10 lime, 11–20 orange, 20+ dark red (white text on all, strong contrast). */
export const rankTone = (r: number) =>
  r <= 3 ? 'bg-emerald-700 text-white' : r <= 10 ? 'bg-lime-700 text-white' : r <= 20 ? 'bg-orange-600 text-white' : 'bg-red-800 text-white'

function world(lat: number, lng: number, z: number) {
  const scale = 256 * 2 ** z
  const s = Math.sin((lat * Math.PI) / 180)
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale }
}

/** Same point order as the audit function: row by row from the north-west, middle = business. */
function points(lat: number, lng: number, size: number, stepKm: number) {
  const dLat = stepKm / 111.32
  const dLng = stepKm / (111.32 * Math.cos((lat * Math.PI) / 180))
  const half = (size - 1) / 2
  const out: { lat: number; lng: number }[] = []
  for (let r = half; r >= -half; r--) for (let c = -half; c <= half; c++) out.push({ lat: lat + r * dLat, lng: lng + c * dLng })
  return out
}

const pct = (v: number) => `${(v / BOX) * 100}%`

interface DrillRow {
  rank: number
  name: string
  rating: number | null
  reviews: number | null
  you: boolean
}
interface DrillResult {
  rows: DrillRow[]
  yourRank: number
}
const drillCache = new Map<string, DrillResult>()

export function RankMap({
  lat,
  lng,
  size,
  stepKm,
  grid,
  drill,
}: {
  lat: number
  lng: number
  size: number
  stepKm: number
  grid: number[]
  drill?: { token: string; keywordIndex: number }
}) {
  // undefined = still asking Google, null = OpenStreetMap, string = Google tile session
  const [gSession, setGSession] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let on = true
    googleTileSession().then((s) => on && setGSession(s))
    return () => {
      on = false
    }
  }, [])

  const [sel, setSel] = useState<number | null>(null)
  const selRef = useRef<number | null>(null)
  const [rows, setRows] = useState<DrillRow[] | null>(null)
  // Rank from the live drilldown search, shown on the dot so the dot and the list always agree
  const [live, setLive] = useState<Record<number, number>>({})
  const [drillError, setDrillError] = useState('')

  const close = () => {
    selRef.current = null
    setSel(null)
  }
  const open = async (i: number) => {
    if (!drill) return
    if (selRef.current === i) return close()
    selRef.current = i
    setSel(i)
    setDrillError('')
    const key = `${drill.token}:${drill.keywordIndex}:${i}`
    const show = (d: DrillResult) => {
      setLive((cur) => ({ ...cur, [i]: d.yourRank }))
      if (selRef.current === i) setRows(d.rows)
    }
    const hit = drillCache.get(key)
    if (hit) return show(hit)
    setRows(null)
    try {
      const res = await fetch(`${DRILL_API}?t=${drill.token}&k=${drill.keywordIndex}&i=${i}`, { headers: { apikey: API_KEY } })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !Array.isArray(body?.rows)) throw new Error(body?.error ?? 'Could not load')
      drillCache.set(key, body)
      show(body)
    } catch (e) {
      if (selRef.current === i) setDrillError(e instanceof Error ? e.message : 'Could not load')
    }
  }

  const mPerPx0 = 156543.03 * Math.cos((lat * Math.PI) / 180) // metres per world px at zoom 0
  // Map shows the grid plus a margin of about half a step on each side
  const spanM = (size + 0.4) * stepKm * 1000
  const z = Math.max(10, Math.min(17, Math.round(Math.log2((mPerPx0 * BOX) / spanM))))
  // Resize the tiles so the grid fills the box at that zoom level (scale about 0.7–1.4)
  const scale = (mPerPx0 * BOX) / 2 ** z / spanM
  const view = BOX / scale // world px visible at zoom z
  const c = world(lat, lng, z)
  const left = c.x - view / 2
  const top = c.y - view / 2
  const tiles: { x: number; y: number }[] = []
  for (let tx = Math.floor(left / 256); tx <= Math.floor((left + view) / 256); tx++)
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + view) / 256); ty++) tiles.push({ x: tx, y: ty })
  const pinPos = points(lat, lng, size, stepKm).map((p) => {
    const w = world(p.lat, p.lng, z)
    return { x: (w.x - left) * scale, y: (w.y - top) * scale }
  })
  const mid = (pinPos.length - 1) / 2
  const pin = size >= 7 ? { w: 'clamp(22px, 6.6cqw, 54px)', f: 'clamp(9px, 2.4cqw, 17px)' } : { w: 'clamp(30px, 12cqw, 64px)', f: 'clamp(11px, 4cqw, 20px)' }

  // Drilldown panel next to the clicked dot (right of it on the left half, left of it on the right half)
  let panel: CSSProperties | null = null
  if (sel != null) {
    const p = pinPos[sel]
    const gap = 'clamp(16px, 5cqw, 40px)'
    const topPx = Math.min(Math.max(p.y - BOX * 0.2, BOX * 0.02), BOX * 0.18)
    // Set as CSS variables: used on big maps (672px+); on smaller maps and phones the panel sits along the bottom of the map instead
    panel = {
      '--pl': p.x < BOX / 2 ? `calc(${pct(p.x)} + ${gap})` : 'auto',
      '--pr': p.x < BOX / 2 ? 'auto' : `calc(${pct(BOX - p.x)} + ${gap})`,
      '--pt': pct(topPx),
    } as CSSProperties
  }

  return (
    <div className="@container w-full">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-[#eef0f3]">
        {gSession !== undefined &&
          tiles.map((t) => (
            <img
              key={`${t.x}-${t.y}`}
              src={gSession ? googleTileUrl(gSession, z, t.x, t.y) : `https://tile.openstreetmap.org/${z}/${t.x}/${t.y}.png`}
              alt=""
              loading="lazy"
              className="absolute max-w-none"
              style={{ left: pct((t.x * 256 - left) * scale), top: pct((t.y * 256 - top) * scale), width: pct(256 * scale + 0.5), height: pct(256 * scale + 0.5) }}
            />
          ))}

        {sel != null && (
          <span
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-600 bg-blue-500/20 print:hidden"
            style={{ left: pct(pinPos[sel].x), top: pct(pinPos[sel].y), width: size >= 7 ? '14cqw' : '24cqw', height: size >= 7 ? '14cqw' : '24cqw' }}
          />
        )}

        {pinPos.map((p, i) => {
          const r = live[i] ?? grid[i] ?? 21
          const cls = cn(
            'absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-bold leading-none shadow-md ring-2 ring-white',
            rankTone(r),
            i === mid && 'outline outline-[3px] outline-offset-2 outline-ink',
          )
          const style = { left: pct(p.x), top: pct(p.y), width: pin.w, height: pin.w, fontSize: pin.f }
          return drill ? (
            <button key={i} type="button" onClick={() => open(i)} aria-label={`Rank ${rankText(r)} — see who ranks here`} className={cn(cls, 'cursor-pointer transition hover:scale-110')} style={style}>
              {rankText(r)}
            </button>
          ) : (
            <span key={i} className={cls} style={style}>
              {rankText(r)}
            </span>
          )
        })}

        {panel && (
          <div
            className={cn(
              'absolute inset-x-2 z-20 flex max-h-[70%] flex-col overflow-hidden rounded-xl border border-line bg-white shadow-xl @2xl:inset-x-auto @2xl:bottom-auto @2xl:left-[var(--pl)] @2xl:right-[var(--pr)] @2xl:top-[var(--pt)] @2xl:max-h-[80%] @2xl:w-[min(320px,44%)] print:hidden',
              sel != null && pinPos[sel].y > BOX / 2 ? 'top-2' : 'bottom-2',
            )}
            style={panel}
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <p className="font-semibold text-ink">Competition Drilldown</p>
              <button type="button" onClick={close} className="rounded p-1 text-muted hover:bg-canvas hover:text-ink" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="overflow-y-auto">
              {drillError ? (
                <p className="p-4 text-sm text-red-700">{drillError}</p>
              ) : !rows ? (
                <p className="flex items-center gap-2 p-4 text-sm text-muted">
                  <Loader2 className="size-4 animate-spin" /> Loading…
                </p>
              ) : rows.length === 0 ? (
                <p className="p-4 text-sm text-muted">No businesses found here.</p>
              ) : (
                <ol className="divide-y divide-line">
                  {rows.map((row) => (
                    <li key={`${row.rank}-${row.name}`} className={cn('flex items-start gap-3 px-4 py-2.5', row.you && 'bg-brand-50')}>
                      <span className="w-7 shrink-0 pt-0.5 text-sm font-semibold text-muted">#{row.rank}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink" title={row.name}>
                          {row.name} {row.you && <span className="font-medium text-brand-800">(you)</span>}
                        </p>
                        {row.rating != null && (
                          <p className="mt-0.5 flex items-center gap-1.5 text-sm">
                            <Stars rating={row.rating} size={13} />
                            <span className="font-medium text-ink">{row.rating.toFixed(1)}</span>
                            {row.reviews != null && <span className="text-muted">({row.reviews.toLocaleString('en-IN')})</span>}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            {rows && sel != null && live[sel] != null && (
              <p className="border-t border-line bg-canvas px-4 py-2 text-sm font-medium text-ink">
                {live[sel] > 20 ? 'You: not in the top 20 here' : `You: #${live[sel]} here`}
              </p>
            )}
          </div>
        )}

        {gSession ? (
          <>
            <img src="https://maps.gstatic.com/mapfiles/api-3/images/google_white5.png" alt="Google" className="absolute bottom-1.5 left-1.5 h-[18px] w-auto max-w-none" />
            <span className="absolute bottom-0 right-0 bg-white/90 px-1.5 py-0.5 text-[10px] text-ink">Map data ©{new Date().getFullYear()} Google</span>
          </>
        ) : (
          gSession === null && <span className="absolute bottom-0 right-0 bg-white/90 px-1.5 py-0.5 text-[10px] text-ink">© OpenStreetMap contributors</span>
        )}
      </div>
      {drill && <p className="mt-2 text-xs text-muted print:hidden">Click any dot to see who ranks there.</p>}
    </div>
  )
}

/** Plain grid (old reports saved without the business location). */
export function RankGrid({ grid, size }: { grid: number[]; size: number }) {
  return (
    <div className="grid w-fit gap-1.5 rounded-xl bg-canvas p-2" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
      {grid.map((r, i) => (
        <span key={i} className={cn('flex size-10 items-center justify-center rounded-full text-sm font-bold', rankTone(r), i === (grid.length - 1) / 2 && 'ring-2 ring-ink ring-offset-2')}>
          {rankText(r)}
        </span>
      ))}
    </div>
  )
}
