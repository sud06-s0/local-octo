// supabase/functions/_shared/supabase.ts
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'

/** New `sb_secret_` key if available, otherwise the legacy service_role key. */
export function secretKey(): string {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, string>
      const key = keys.default ?? Object.values(keys)[0]
      if (key) return key
    } catch {
      /* fall through */
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!legacy) throw new Error('No Supabase secret key in environment')
  return legacy
}

/** Server client that bypasses RLS. Never return its data unchecked to a user. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Reads the caller's access token and returns the user, or null. */
export async function getUser(req: Request, admin: SupabaseClient): Promise<User | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

/** True if the user belongs to the business (or is Local Octo platform staff). */
export async function isMember(admin: SupabaseClient, userId: string, businessId: string): Promise<boolean> {
  const [{ data: member }, { data: profile }] = await Promise.all([
    admin.from('business_members').select('user_id').eq('business_id', businessId).eq('user_id', userId).maybeSingle(),
    admin.from('profiles').select('is_platform_admin').eq('id', userId).maybeSingle(),
  ])
  return !!member || !!profile?.is_platform_admin
}

export function functionsUrl(): string {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1`
}
