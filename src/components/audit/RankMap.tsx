// src/components/audit/RankMap.tsx
// Rank heatmap: the grid's ranks as pins on an OpenStreetMap background (no API key).
// Laid out in % of a square box, so it fills the card at any width — on screen and in the PDF.

import { cn } from '../../lib/utils'

const BOX = 800 // logical px the map is worked out at; everything is placed in % of it

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

export function RankMap({ lat, lng, size, stepKm, grid }: { lat: number; lng: number; size: number; stepKm: number; grid: number[] }) {
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
  const pins = points(lat, lng, size, stepKm)
  const mid = (pins.length - 1) / 2
  const at = (wx: number, wy: number) => ({ left: pct((wx - left) * scale), top: pct((wy - top) * scale) })
  const pin = size >= 7 ? { w: 'clamp(22px, 6.6cqw, 54px)', f: 'clamp(9px, 2.4cqw, 17px)' } : { w: 'clamp(30px, 12cqw, 64px)', f: 'clamp(11px, 4cqw, 20px)' }

  return (
    <div className="w-full" style={{ containerType: 'inline-size' }}>
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-[#eef0f3]">
        {tiles.map((t) => (
          <img
            key={`${t.x}-${t.y}`}
            src={`https://tile.openstreetmap.org/${z}/${t.x}/${t.y}.png`}
            alt=""
            loading="lazy"
            className="absolute max-w-none"
            style={{ ...at(t.x * 256, t.y * 256), width: pct(256 * scale + 0.5), height: pct(256 * scale + 0.5) }}
          />
        ))}
        {pins.map((p, i) => {
          const w = world(p.lat, p.lng, z)
          const r = grid[i] ?? 21
          return (
            <span
              key={i}
              className={cn(
                'absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-bold leading-none shadow-md ring-2 ring-white',
                rankTone(r),
                i === mid && 'z-10 outline outline-[3px] outline-offset-2 outline-ink',
              )}
              style={{ ...at(w.x, w.y), width: pin.w, height: pin.w, fontSize: pin.f }}
            >
              {rankText(r)}
            </span>
          )
        })}
        <span className="absolute bottom-0 right-0 bg-white/90 px-1.5 py-0.5 text-[10px] text-ink">© OpenStreetMap contributors</span>
      </div>
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
