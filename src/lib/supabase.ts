// src/lib/supabase.ts
import { createClient, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { brand } from '../config/brand'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? ''
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? ''

/** Live mode when both env vars are set; otherwise the app runs on sample data (demo mode). */
export const isLive = !!url && !!key

export const supabase: SupabaseClient | null = isLive ? createClient(url, key) : null

export function db(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

export const functionsBase = isLive ? `${url}/functions/v1` : ''

export const widgetScriptUrl = isLive ? `${functionsBase}/widget?format=js` : brand.widgetScriptUrl
export const contactsWebhookUrl = isLive ? `${functionsBase}/contacts-webhook` : `${brand.webhookBaseUrl}/contacts`

/** Calls an Edge Function and turns its JSON error into a readable message. */
export async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detail = await error.context.json().catch(() => null)
      throw new Error(detail?.error ?? error.message)
    }
    throw error
  }
  return data as T
}
