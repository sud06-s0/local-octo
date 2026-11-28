// src/components/audit/RankMap.tsx
// Rank heatmap: the grid's ranks as pins on an OpenStreetMap background (no API key). Scales down to fit narrow screens.

import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'

const BOX = 440 // drawn at 440 x 440 px, then scaled to the container

export const rankText = (r: number) => (r > 20 ? '20+' : String(r))
export const rankTone = (r: number) => (r <= 3 ? 'bg-emerald-500 text-white' : r <= 10 ? 'bg-amber-400 text-ink' : 'bg-red-600 text-white')

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

export function RankMap({ lat, lng, size, stepKm, grid }: { lat: number; lng: number; size: number; stepKm: number; grid: number[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / BOX)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const spanM = (size + 1) * stepKm * 1000
  const z = Math.max(10, Math.min(16, Math.floor(Math.log2((156543.03 * Math.cos((lat * Math.PI) / 180) * BOX) / spanM))))
  const c = world(lat, lng, z)
  const left = c.x - BOX / 2
  const top = c.y - BOX / 2
  const tiles: { x: number; y: number }[] = []
  for (let tx = Math.floor(left / 256); tx <= Math.floor((left + BOX) / 256); tx++)
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + BOX) / 256); ty++) tiles.push({ x: tx, y: ty })
  const pins = points(lat, lng, size, stepKm)
  const mid = (pins.length - 1) / 2
  const pin = size >= 7 ? 'size-8 text-[11px]' : 'size-10 text-sm'

  return (
    <div ref={wrap} className="w-full max-w-[440px]">
      <div className="overflow-hidden" style={{ height: BOX * scale }}>
        <div className="relative origin-top-left overflow-hidden rounded-xl bg-[#eef0f3]" style={{ width: BOX, height: BOX, transform: `scale(${scale})` }}>
          {tiles.map((t) => (
            <img
              key={`${t.x}-${t.y}`}
              src={`https://tile.openstreetmap.org/${z}/${t.x}/${t.y}.png`}
              alt=""
              loading="lazy"
              className="absolute size-64 max-w-none opacity-80 grayscale-[35%]"
              style={{ left: t.x * 256 - left, top: t.y * 256 - top, width: 256, height: 256 }}
            />
          ))}
          {pins.map((p, i) => {
            const w = world(p.lat, p.lng, z)
            const r = grid[i] ?? 21
            return (
              <span
                key={i}
                className={cn('absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-semibold shadow', pin, rankTone(r), i === mid ? 'z-10 ring-[3px] ring-ink' : 'ring-2 ring-white')}
                style={{ left: w.x - left, top: w.y - top }}
              >
                {rankText(r)}
              </span>
            )
          })}
          <span className="absolute bottom-0 right-0 bg-white/80 px-1 text-[9px] text-ink/70">© OpenStreetMap contributors</span>
        </div>
      </div>
    </div>
  )
}

/** Plain grid (old reports saved without the business location). */
export function RankGrid({ grid, size }: { grid: number[]; size: number }) {
  return (
    <div className="grid w-fit gap-1.5 rounded-xl bg-canvas p-2" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
      {grid.map((r, i) => (
        <span key={i} className={cn('flex size-10 items-center justify-center rounded-full text-sm font-semibold', rankTone(r), i === (grid.length - 1) / 2 && 'ring-2 ring-ink ring-offset-2')}>
          {rankText(r)}
        </span>
      ))}
    </div>
  )
}
