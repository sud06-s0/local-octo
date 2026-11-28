// src/lib/googleTiles.ts
// Google Map Tiles API (2D roadmap) for the audit heatmaps. Needs VITE_GOOGLE_MAPS_KEY
// (a browser key restricted to the site + Map Tiles API). Without it the heatmaps fall back to OpenStreetMap.

const KEY = ((import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined) ?? '').trim()

let session: Promise<string | null> | null = null

/** One tile session per page load (a session is valid for about two weeks). null = use OpenStreetMap. */
export function googleTileSession(): Promise<string | null> {
  if (!KEY) return Promise.resolve(null)
  session ??= fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapType: 'roadmap', language: 'en-IN', region: 'IN' }),
  })
    .then(async (res) => (res.ok ? ((await res.json()).session as string) ?? null : null))
    .catch(() => null)
  return session
}

export const googleTileUrl = (s: string, z: number, x: number, y: number) =>
  `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(s)}&key=${encodeURIComponent(KEY)}`
