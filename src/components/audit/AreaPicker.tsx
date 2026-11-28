// src/components/audit/AreaPicker.tsx
// "Location & Radius" for the audit: centre point (drag/click the map or search an address) and the square audit area,
// shown in km or miles (1–100 km). The preview draws the area box and the 7 x 7 grid the audit will check.

import { useRef, useState, type PointerEvent } from 'react'
import { Crosshair, Loader2, MapPin, Search } from 'lucide-react'
import { cn } from '../../lib/utils'
import { MapCredit, tileSrc, useTileSession, world } from './RankMap'

const W = 800 // logical map size (width x height); positions are in % of these
const H = 500
const KM_PER_MI = 1.609344
export const MIN_AREA_KM = 1
export const MAX_AREA_KM = 100

export type AreaUnit = 'km' | 'mi'
export interface LatLng {
  lat: number
  lng: number
}
export interface GeoResult extends LatLng {
  name: string
  address: string
}

const fmt = (v: number) => (v < 10 ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v)))

function toLatLng(wx: number, wy: number, z: number): LatLng {
  const size = 256 * 2 ** z
  return { lng: (wx / size) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / size))) * 180) / Math.PI }
}

export function AreaPicker({
  center,
  onCenter,
  areaKm,
  onArea,
  unit,
  onUnit,
  business,
  onSearch,
  disabled,
}: {
  center: LatLng
  onCenter: (c: LatLng) => void
  areaKm: number
  onArea: (km: number) => void
  unit: AreaUnit
  onUnit: (u: AreaUnit) => void
  business: LatLng | null
  onSearch: (query: string) => Promise<GeoResult[]>
  disabled?: boolean
}) {
  const gSession = useTileSession()
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[] | null>(null)
  const [searching, setSearching] = useState(false)

  // Map view: the area square fits the map height with a margin around it
  const mPerPx0 = 156543.03 * Math.cos((center.lat * Math.PI) / 180)
  const spanM = areaKm * 1000 * 1.35
  const z = Math.max(3, Math.min(17, Math.round(Math.log2((mPerPx0 * H) / spanM))))
  const scale = (mPerPx0 * H) / 2 ** z / spanM
  const c = world(center.lat, center.lng, z)
  const left = c.x - W / scale / 2
  const top = c.y - H / scale / 2
  const px = (p: LatLng) => {
    const w = world(p.lat, p.lng, z)
    return { x: (w.x - left) * scale, y: (w.y - top) * scale }
  }
  const tiles: { x: number; y: number }[] = []
  for (let tx = Math.floor(left / 256); tx <= Math.floor((left + W / scale) / 256); tx++)
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + H / scale) / 256); ty++) tiles.push({ x: tx, y: ty })

  // Area square and the 7 x 7 dots
  const halfLat = areaKm / 2 / 111.32
  const halfLng = areaKm / 2 / (111.32 * Math.cos((center.lat * Math.PI) / 180))
  const nw = px({ lat: center.lat + halfLat, lng: center.lng - halfLng })
  const se = px({ lat: center.lat - halfLat, lng: center.lng + halfLng })
  const dots: { x: number; y: number }[] = []
  for (let r = 0; r < 7; r++) for (let col = 0; col < 7; col++) dots.push({ x: nw.x + ((se.x - nw.x) * col) / 6, y: nw.y + ((se.y - nw.y) * r) / 6 })
  const biz = business ? px(business) : null

  const wPct = (v: number) => `${(v / W) * 100}%`
  const hPct = (v: number) => `${(v / H) * 100}%`

  // Drag the map to move the centre; a click (no drag) moves the centre to that spot
  const toLogical = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toLogical(e)
    drag.current = { x: p.x, y: p.y, cx: c.x, cy: c.y, moved: false }
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const p = toLogical(e)
    if (Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > 4) d.moved = true
    if (d.moved) onCenter(toLatLng(d.cx - (p.x - d.x) / scale, d.cy - (p.y - d.y) / scale, z))
  }
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const p = toLogical(e)
    onCenter(toLatLng(left + p.x / scale, top + p.y / scale, z))
  }

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      setResults(await onSearch(query))
    } finally {
      setSearching(false)
    }
  }

  const shown = unit === 'km' ? areaKm : areaKm / KM_PER_MI
  const min = unit === 'km' ? MIN_AREA_KM : Math.ceil((MIN_AREA_KM / KM_PER_MI) * 10) / 10
  const max = unit === 'km' ? MAX_AREA_KM : Math.floor((MAX_AREA_KM / KM_PER_MI) * 10) / 10

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr]">
      <div className="space-y-5 rounded-xl border border-line p-4">
        <div>
          <p className="mb-2 font-medium text-ink">Centre point</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), search())}
              placeholder="Search address…"
              disabled={disabled}
              className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-9 text-[15px] text-ink outline-none placeholder:text-muted/90 focus:border-brand-500 focus:ring-3 focus:ring-brand-100"
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" />}
          </div>
          {results && (
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
              {results.length ? (
                results.map((g) => (
                  <li key={`${g.lat},${g.lng}`}>
                    <button
                      type="button"
                      onClick={() => {
                        onCenter({ lat: g.lat, lng: g.lng })
                        setResults(null)
                        setQuery(g.name)
                      }}
                      className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-canvas"
                    >
                      <MapPin className="mt-0.5 size-4 shrink-0 text-muted" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{g.name}</span>
                        <span className="block truncate text-xs text-muted">{g.address}</span>
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-sm text-muted">No places found.</li>
              )}
            </ul>
          )}
          <p className="mt-2 text-sm text-muted">Drag the map, click a spot, or search a nearby address.</p>
          {business && (
            <button
              type="button"
              onClick={() => onCenter(business)}
              disabled={disabled}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-800 hover:underline"
            >
              <Crosshair className="size-4" /> Use business location
            </button>
          )}
        </div>

        <div className="border-t border-line pt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-medium text-ink">Audit area</p>
            <div className="flex rounded-lg border border-line p-0.5 text-xs font-medium">
              {(['km', 'mi'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => onUnit(u)}
                  className={cn('rounded-md px-2.5 py-1', unit === u ? 'bg-brand-700 text-white' : 'text-muted hover:text-ink')}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-2 text-2xl font-semibold text-brand-800">
            {fmt(shown)} × {fmt(shown)} <span className="text-base font-medium">{unit}</span>
          </p>
          <input
            type="range"
            min={min}
            max={max}
            step={0.1}
            value={Math.min(max, Math.max(min, shown))}
            disabled={disabled}
            onChange={(e) => {
              const v = Number(e.target.value)
              onArea(Math.min(MAX_AREA_KM, Math.max(MIN_AREA_KM, unit === 'km' ? v : v * KM_PER_MI)))
            }}
            className="w-full accent-[var(--color-brand-700)]"
            aria-label="Audit area size"
          />
          <p className="mt-2 text-sm text-muted">
            Checks a {fmt(shown)} × {fmt(shown)} {unit} area with 49 points, {fmt(shown / 6)} {unit} apart.
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Preview</p>
        <div
          ref={box}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => (drag.current = null)}
          className={cn('relative aspect-[8/5] w-full touch-none select-none overflow-hidden rounded-xl border border-line bg-[#eef0f3]', disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing')}
        >
          {gSession !== undefined &&
            tiles.map((t) => (
              <img
                key={`${z}-${t.x}-${t.y}`}
                src={tileSrc(gSession, z, t.x, t.y)}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none"
                style={{ left: wPct((t.x * 256 - left) * scale), top: hPct((t.y * 256 - top) * scale), width: wPct(256 * scale + 0.5), height: hPct(256 * scale + 0.5) }}
              />
            ))}
          <div
            className="pointer-events-none absolute border-2 border-ink bg-brand-500/5"
            style={{ left: wPct(nw.x), top: hPct(nw.y), width: wPct(se.x - nw.x), height: hPct(se.y - nw.y) }}
          />
          {dots.map((d, i) => (
            <span key={i} className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/60" style={{ left: wPct(d.x), top: hPct(d.y) }} />
          ))}
          {biz && biz.x >= 0 && biz.y >= 0 && biz.x <= W && biz.y <= H && (
            <span className="pointer-events-none absolute -translate-x-1/2 -translate-y-full" style={{ left: wPct(biz.x), top: hPct(biz.y) }} title="Business location">
              <svg viewBox="0 0 24 32" className="h-7 w-5 drop-shadow">
                <path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 32 12 32s12-11.6 12-20.3C24 5.2 18.6 0 12 0z" fill="#1c1530" />
                <circle cx="12" cy="11.5" r="4.5" fill="#fff" />
              </svg>
            </span>
          )}
          <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
            <svg viewBox="0 0 24 32" className="h-9 w-7 drop-shadow-md">
              <path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 32 12 32s12-11.6 12-20.3C24 5.2 18.6 0 12 0z" fill="#dc2626" />
              <circle cx="12" cy="11.5" r="4.5" fill="#fff" />
            </svg>
          </span>
          <MapCredit gSession={gSession} />
        </div>
        <p className="mt-2 text-xs text-muted">Red pin = centre of the audit. {business ? 'Black pin = your business.' : ''}</p>
      </div>
    </div>
  )
}
