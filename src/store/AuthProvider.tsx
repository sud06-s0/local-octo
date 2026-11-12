// src/store/AuthProvider.tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isLive, supabase } from '../lib/supabase'

interface AuthState {
  ready: boolean
  signedIn: boolean
  session: Session | null
  user: { id: string; name: string; email: string }
  recovering: boolean // user opened a password-reset link
  clearRecovering: () => void
  signOut: () => Promise<void>
}

const DEMO_USER = { id: 'demo', name: 'Adarsh Kumar', email: 'adarsh.k@localocto.com' }
const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!isLive)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthState>(() => {
    const u = session?.user
    return {
      ready,
      signedIn: !isLive || !!session,
      session,
      user: u
        ? { id: u.id, name: (u.user_metadata?.full_name as string | undefined) || u.email?.split('@')[0] || 'User', email: u.email ?? '' }
        : DEMO_USER,
      recovering,
      clearRecovering: () => setRecovering(false),
      signOut: async () => {
        await supabase?.auth.signOut()
      },
    }
  }, [ready, session, recovering])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
