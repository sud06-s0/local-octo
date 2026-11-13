// src/lib/lazyPage.ts
// After a new deploy, an open tab may ask for page files that no longer exist.
// lazyPage() retries once, then reloads the app one time to pick up the new files.

import { lazy, type ComponentType } from 'react'

const RELOAD_KEY = 'lo-chunk-reload'

export function isChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|error loading dynamically|MIME type/i.test(msg)
}

/** Reloads the page once per tab session; returns false if it already tried. */
export function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    /* storage unavailable: still reload once */
  }
  window.location.reload()
  return true
}

/** Clears the guard once the app has loaded fine, so a later deploy can reload again. */
export function markAppHealthy() {
  try {
    sessionStorage.removeItem(RELOAD_KEY)
  } catch {
    /* ignore */
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await factory()
    } catch (err) {
      if (!isChunkError(err)) throw err
      // one quick retry (flaky network), then a full reload for a new deploy
      try {
        await new Promise((r) => setTimeout(r, 400))
        return await factory()
      } catch (err2) {
        if (isChunkError(err2) && reloadOnce()) return new Promise<never>(() => {}) // page is reloading
        throw err2
      }
    }
  })
}
