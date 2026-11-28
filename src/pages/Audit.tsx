// src/pages/Audit.tsx
// Audit / rank report for the selected business. Agency logins: unlimited runs. Client logins: 1 run per calendar month.
// "Download PDF" prints the report; "Copy public link" gives a page anyone can open (/audit-report/<token>).

import { useCallback, useEffect, useState } from 'react'
import { Download, Link2, Loader2, Play, Plus, Sparkles, X } from 'lucide-react'
import { Button, Card, Input, PageHeader } from '../components/ui/primitives'
import { useStore } from '../store/AppStore'
import { useAuth } from '../store/AuthProvider'
import { useToast } from '../components/ui/Toast'
import { db, invokeFn } from '../lib/supabase'
import { AuditReport, type Report } from '../components/audit/AuditReport'

const MAX_KEYWORDS = 5

interface Saved {
  id: string
  created_at: string
  keywords: string[]
  share_token: string
  report: Report
}

const monthKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7)
const nextMonthStart = () => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
}

export default function Audit() {
  const { mode, activeBusinessId, state } = useStore()
  const { isAgency } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState<Saved | null>(null)
  const [keywords, setKeywords] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState<string[] | null>(null) // up to 10 ideas, shown after clicking Suggest
  const [running, setRunning] = useState(false)
  const [runKeywords, setRunKeywords] = useState<string[]>([])
  const [lastClientRun, setLastClientRun] = useState<string | null>(null)
  // Clients get 1 audit per calendar month (agency runs don't count)
  const usedThisMonth = !isAgency && !!lastClientRun && monthKey(new Date(lastClientRun)) === monthKey(new Date())

  const suggest = useCallback(async () => {
    if (!activeBusinessId) return
    setSuggesting(true)
    try {
      const r = await invokeFn<{ keywords: string[]; source: string }>('audit', { action: 'suggest', businessId: activeBusinessId })
      setSuggestions(r.keywords.slice(0, 10))
      if (!r.keywords.length) toast('No keywords found. Add them yourself.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not get keywords')
    } finally {
      setSuggesting(false)
    }
  }, [activeBusinessId, toast])

  useEffect(() => {
    if (mode !== 'live' || !activeBusinessId) {
      setLoading(false)
      return
    }
    let off = false
    setLoading(true)
    setCurrent(null)
    db()
      .from('business_audits')
      .select('id, created_at, keywords, share_token, report')
      .eq('business_id', activeBusinessId)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (off) return
        setLoading(false)
        if (error) return toast(error.message)
        const rows = (data ?? []) as Saved[]
        setCurrent(rows[0] ?? null)
        if (rows[0]) setKeywords(rows[0].keywords.slice(0, MAX_KEYWORDS))
      })
    if (!isAgency)
      db()
        .from('businesses')
        .select('last_client_audit_at')
        .eq('id', activeBusinessId)
        .maybeSingle()
        .then(({ data }) => !off && setLastClientRun(data?.last_client_audit_at ?? null))
    return () => {
      off = true
    }
  }, [mode, activeBusinessId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setSuggestions(null), [activeBusinessId])

  const addKeyword = (value?: string) => {
    const k = (value ?? draft).trim().toLowerCase()
    if (!k) return
    if (keywords.includes(k)) return setDraft('')
    if (keywords.length >= MAX_KEYWORDS) return toast(`Max ${MAX_KEYWORDS} keywords. Remove one to add another.`)
    setKeywords([...keywords, k])
    if (value === undefined) setDraft('')
  }

  const run = async () => {
    if (!activeBusinessId || !keywords.length) return
    setRunKeywords(keywords)
    setRunning(true)
    try {
      const r = await invokeFn<{ id: string; createdAt: string; shareToken: string; report: Report }>('audit', { action: 'run', businessId: activeBusinessId, keywords })
      const saved: Saved = { id: r.id, created_at: r.createdAt, keywords, share_token: r.shareToken, report: r.report }
      setCurrent(saved)
      if (!isAgency) setLastClientRun(new Date().toISOString())
      toast('Audit ready')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Audit failed')
    } finally {
      setRunning(false)
    }
  }

  const copyLink = async () => {
    if (!current?.share_token) return toast('Run the SQL for share links first')
    const url = `${window.location.origin}/audit-report/${current.share_token}`
    try {
      await navigator.clipboard.writeText(url)
      toast('Public link copied')
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  if (mode !== 'live') {
    return (
      <div className="mx-auto max-w-[1100px]">
        <PageHeader title="Audit" subtitle="Works once Supabase is connected" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="print:hidden">
        <PageHeader
          title="Audit"
          subtitle={`Google profile and rank report for ${state.settings.business.name}`}
          actions={
            current && (
              <>
                <Button variant="outline" icon={Link2} onClick={copyLink}>
                  Copy public link
                </Button>
                <Button variant="outline" icon={Download} onClick={() => window.print()}>
                  Download PDF
                </Button>
              </>
            )
          }
        />

        <Card className="mb-6 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-ink">
              Keywords <span className="text-sm font-normal text-muted">({keywords.length}/{MAX_KEYWORDS})</span>
            </p>
            <Button variant="ghost" size="sm" icon={suggesting ? Loader2 : Sparkles} onClick={suggest} disabled={suggesting || running}>
              Suggest
            </Button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {keywords.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-sm text-brand-800 ring-1 ring-brand-100">
                {k}
                <button onClick={() => setKeywords(keywords.filter((x) => x !== k))} aria-label={`Remove ${k}`} className="rounded p-0.5 hover:bg-brand-100">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
            {!keywords.length && <span className="text-sm text-muted">No keywords yet — add your own or click Suggest</span>}
          </div>
          {suggestions && (
            <div className="mb-3 rounded-lg border border-line bg-canvas p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">Suggestions — click to add</p>
                <button onClick={() => setSuggestions(null)} aria-label="Close suggestions" className="rounded p-0.5 text-muted hover:text-ink">
                  <X className="size-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {suggestions.filter((sg) => !keywords.includes(sg.toLowerCase())).map((sg) => (
                  <button
                    key={sg}
                    onClick={() => addKeyword(sg)}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1 text-sm text-ink hover:border-brand-300 hover:bg-brand-50"
                  >
                    <Plus className="size-3.5" /> {sg}
                  </button>
                ))}
                {suggestions.every((sg) => keywords.includes(sg.toLowerCase())) && <span className="text-sm text-muted">All suggestions added.</span>}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
              placeholder={keywords.length >= MAX_KEYWORDS ? `Max ${MAX_KEYWORDS} keywords — remove one to add another` : 'e.g. pu college near me'}
              className="flex-1"
            />
            <Button variant="outline" icon={Plus} onClick={() => addKeyword()}>
              Add
            </Button>
            <Button icon={running ? Loader2 : Play} onClick={run} disabled={running || !keywords.length || usedThisMonth}>
              {running ? 'Running…' : 'Run audit'}
            </Button>
          </div>
          {!isAgency && (
            <p className="mt-3 text-sm text-muted">
              {usedThisMonth ? `You've used this month's audit. The next one is available on ${nextMonthStart()}.` : 'You can run 1 audit per month.'}
            </p>
          )}
        </Card>
      </div>

      {running && <RunProgress keywords={runKeywords} />}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-brand-700" />
        </div>
      ) : current ? (
        <div className={running ? 'pointer-events-none opacity-40 print:hidden' : ''}>
          <AuditReport report={current.report} createdAt={current.created_at} shareToken={current.share_token} />
        </div>
      ) : running ? null : (
        <Card className="p-10 text-center text-muted print:hidden">No report yet. Check the keywords and run the audit.</Card>
      )}
    </div>
  )
}

/** Time estimate + steps while the audit runs (the function itself doesn't report progress). */
function RunProgress({ keywords }: { keywords: string[] }) {
  // Rough timings: profile ~6s, each 7x7 keyword ~9s, each 3x3 keyword ~3s, summary ~10s
  const steps = [
    { label: 'Reading the Google Business Profile', secs: 6 },
    ...keywords.map((k, i) => ({ label: `Checking ranks for "${k}"`, secs: i < 3 ? 9 : 3 })),
    { label: 'Finding competitors and checking the profile', secs: 3 },
    { label: 'Writing the summary', secs: 10 },
  ]
  const total = steps.reduce((a, b) => a + b.secs, 0)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const t = setInterval(() => setElapsed((Date.now() - start) / 1000), 500)
    return () => clearInterval(t)
  }, [])

  let acc = 0
  const current = steps.findIndex((s) => (acc += s.secs) > elapsed)
  const left = Math.max(0, Math.ceil(total - elapsed))
  const over = elapsed >= total
  const pctDone = Math.min(97, (elapsed / total) * 100)
  const leftText = left >= 60 ? `${Math.floor(left / 60)} min ${left % 60} s` : `${left} s`

  return (
    <Card className="mb-6 p-5 print:hidden">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-medium text-ink">
          <Loader2 className="size-4 animate-spin text-brand-700" />
          {over ? 'Almost done — finishing up…' : `Running the audit — about ${leftText} left`}
        </p>
        <span className="text-sm text-muted">{Math.round(pctDone)}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-canvas">
        <div className="h-full rounded-full bg-brand-700 transition-[width] duration-500" style={{ width: `${pctDone}%` }} />
      </div>
      <p className="mt-3 text-sm text-muted">{over ? steps[steps.length - 1].label : steps[current]?.label}…</p>
      <p className="mt-1 text-xs text-muted">Keep this page open. The report shows here when it's ready.</p>
    </Card>
  )
}

