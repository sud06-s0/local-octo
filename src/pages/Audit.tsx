// src/pages/Audit.tsx
// Audit / rank report for the selected business. Agency logins only (hidden from clients' menu, and refused by the audit function).
// "Download PDF" prints the report; "Copy public link" gives a page anyone can open (/audit-report/<token>).

import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import { Download, Link2, Loader2, Play, Plus, Sparkles, X } from 'lucide-react'
import { Button, Card, Input, PageHeader } from '../components/ui/primitives'
import { useStore } from '../store/AppStore'
import { useAuth } from '../store/AuthProvider'
import { useToast } from '../components/ui/Toast'
import { db, invokeFn } from '../lib/supabase'
import { AuditReport, type Report } from '../components/audit/AuditReport'

const MAX_KEYWORDS = 10

interface Saved {
  id: string
  created_at: string
  keywords: string[]
  share_token: string
  report: Report
}

export default function Audit() {
  const { isAgency } = useAuth()
  if (!isAgency) return <Navigate to="/dashboard" replace />
  return <AuditInner />
}

function AuditInner() {
  const { mode, activeBusinessId, state } = useStore()
  const toast = useToast()
  const [current, setCurrent] = useState<Saved | null>(null)
  const [keywords, setKeywords] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [suggesting, setSuggesting] = useState(false)
  const [running, setRunning] = useState(false)
  const [runKeywords, setRunKeywords] = useState<string[]>([])

  const suggest = useCallback(async () => {
    if (!activeBusinessId) return
    setSuggesting(true)
    try {
      const r = await invokeFn<{ keywords: string[]; source: string }>('audit', { action: 'suggest', businessId: activeBusinessId })
      setKeywords(r.keywords.slice(0, MAX_KEYWORDS))
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
        if (rows[0]) setKeywords(rows[0].keywords)
        else void suggest()
      })
    return () => {
      off = true
    }
  }, [mode, activeBusinessId]) // eslint-disable-line react-hooks/exhaustive-deps

  const addKeyword = () => {
    const k = draft.trim().toLowerCase()
    if (!k) return
    if (keywords.includes(k)) return setDraft('')
    if (keywords.length >= MAX_KEYWORDS) return toast(`Up to ${MAX_KEYWORDS} keywords`)
    setKeywords([...keywords, k])
    setDraft('')
  }

  const run = async () => {
    if (!activeBusinessId || !keywords.length) return
    setRunKeywords(keywords)
    setRunning(true)
    try {
      const r = await invokeFn<{ id: string; createdAt: string; shareToken: string; report: Report }>('audit', { action: 'run', businessId: activeBusinessId, keywords })
      const saved: Saved = { id: r.id, created_at: r.createdAt, keywords, share_token: r.shareToken, report: r.report }
      setCurrent(saved)
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
            {!keywords.length && <span className="text-sm text-muted">{suggesting ? 'Getting keywords…' : 'No keywords yet'}</span>}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
              placeholder="e.g. gym in salt lake"
              className="flex-1"
            />
            <Button variant="outline" icon={Plus} onClick={addKeyword}>
              Add
            </Button>
            <Button icon={running ? Loader2 : Play} onClick={run} disabled={running || !keywords.length}>
              {running ? 'Running…' : 'Run audit'}
            </Button>
          </div>
        </Card>
      </div>

      {running && <RunProgress keywords={runKeywords} />}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-brand-700" />
        </div>
      ) : current ? (
        <div className={running ? 'pointer-events-none opacity-40 print:hidden' : ''}>
          <AuditReport report={current.report} createdAt={current.created_at} />
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

