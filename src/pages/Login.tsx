// src/pages/Login.tsx
import { useState, type FormEvent } from 'react'
import { CircleCheck, Mail, Star } from 'lucide-react'
import { Button, Input, Label } from '../components/ui/primitives'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../store/AuthProvider'
import { db } from '../lib/supabase'
import { brand } from '../config/brand'
import { isEmail } from '../lib/utils'

type Mode = 'signin' | 'signup' | 'forgot' | 'reset'

export default function Login() {
  const toast = useToast()
  const { recovering, clearRecovering } = useAuth()
  const [mode, setMode] = useState<Mode>(recovering ? 'reset' : 'signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const auth = db().auth
      if (mode === 'signin') {
        const { error } = await auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { data, error } = await auth.signUp({
          email,
          password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: window.location.origin + window.location.pathname },
        })
        if (error) throw error
        if (!data.session) setSent(`We sent a confirmation link to ${email}. Open it to finish signing up.`)
      } else if (mode === 'forgot') {
        const { error } = await auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname })
        if (error) throw error
        setSent(`If ${email} has an account, a reset link is on its way.`)
      } else {
        const { error } = await auth.updateUser({ password })
        if (error) throw error
        clearRecovering()
        toast('Password updated')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong', 'error')
    } finally {
      setBusy(false)
    }
  }

  const valid =
    mode === 'reset'
      ? password.length >= 8
      : isEmail(email) && (mode === 'forgot' || (password.length >= (mode === 'signup' ? 8 : 1) && (mode !== 'signup' || name.trim())))

  const titles: Record<Mode, [string, string]> = {
    signin: ['Welcome back', 'Sign in to manage your reviews'],
    signup: ['Create your account', 'Start collecting more 5-star reviews'],
    forgot: ['Reset your password', "We'll email you a reset link"],
    reset: ['Set a new password', 'Choose a password with at least 8 characters'],
  }

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-brand-800 via-brand-700 to-brand-500 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-white/15 font-medium">{brand.shortName}</span>
          <span className="text-lg font-semibold">{brand.appName}</span>
        </div>
        <div>
          <p className="max-w-md text-[34px] font-bold leading-tight">More Google reviews. On autopilot.</p>
          <ul className="mt-8 space-y-3 text-[16px] text-white/90">
            {['Review requests on WhatsApp, SMS and email', 'Smart follow-ups that stop when customers click', 'AI replies and review widgets for your website'].map((t) => (
              <li key={t} className="flex items-center gap-2"><CircleCheck className="size-5 text-brand-200" /> {t}</li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-1 text-brand-100">
          {[1, 2, 3, 4, 5].map((i) => <Star key={i} className="size-5 text-amber-300" fill="currentColor" strokeWidth={0} />)}
          <span className="ml-2 text-sm">Built for local businesses</span>
        </div>
      </div>

      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-lg bg-brand-700 font-medium text-white">{brand.shortName}</span>
            <span className="text-lg font-semibold">{brand.appName}</span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight">{titles[mode][0]}</h1>
          <p className="mt-1 text-muted">{titles[mode][1]}</p>

          {sent ? (
            <div className="mt-8 rounded-xl border border-brand-200 bg-brand-50 p-5">
              <Mail className="size-6 text-brand-700" />
              <p className="mt-3 text-[15px]">{sent}</p>
              <Button variant="outline" className="mt-4 w-full" onClick={() => { setSent(''); setMode('signin') }}>Back to sign in</Button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-4">
              {mode === 'signup' && (
                <div>
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              )}
              {mode !== 'reset' && (
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              )}
              {mode !== 'forgot' && (
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pw">{mode === 'reset' ? 'New password' : 'Password'}</Label>
                    {mode === 'signin' && (
                      <button type="button" onClick={() => setMode('forgot')} className="mb-2 text-sm font-medium text-brand-700 hover:underline">
                        Forgot?
                      </button>
                    )}
                  </div>
                  <Input
                    id="pw"
                    type="password"
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  {mode !== 'signin' && <p className="mt-1 text-xs text-muted">At least 8 characters</p>}
                </div>
              )}
              <Button type="submit" size="lg" className="w-full" disabled={!valid || busy}>
                {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Update password'}
              </Button>
            </form>
          )}

          {!sent && mode !== 'reset' && (
            <p className="mt-6 text-center text-sm text-muted">
              {mode === 'signin' ? (
                <>New here? <button onClick={() => setMode('signup')} className="font-medium text-brand-700 hover:underline">Create an account</button></>
              ) : (
                <>Already have an account? <button onClick={() => setMode('signin')} className="font-medium text-brand-700 hover:underline">Sign in</button></>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
