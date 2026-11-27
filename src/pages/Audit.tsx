// src/pages/Audit.tsx
// Audit / rank report for the selected business. Agency logins only (hidden from clients' menu, and refused by the audit function).
// "Download PDF" prints the report; the sidebar and buttons are hidden in print.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router'
import { AlertTriangle, CheckCircle2, CircleDashed, Download, Loader2, MapPin, Play, Plus, Sparkles, X, XCircle } from 'lucide-react'
import { Badge, Button, Card, Input, PageHeader, Stars } from '../components/ui/primitives'
import { useStore } from '../store/AppStore'
import { useAuth } from '../store/AuthProvider'
import { useToast } from '../components/ui/Toast'
import { db, invokeFn } from '../lib/supabase'
import { cn } from '../lib/utils'

const MAX_KEYWORDS = 10

interface KeywordRow {
  keyword: string
  grid: number[]
  center: number
  average: number
  foundIn: number
  top3In: number
  impressions: number | null
}
interface Report {
  business: { name: string; address: string; rating: number | null; reviewCount: number | null; category: string }
  source: 'gbp' | 'places'
  gbpNote: string
  gridStepKm: number
  searchRank: number
  scores: {
    profileScore: number
    title: { value: string; score: number; issues: string[]; risk: string }
    categories: { count: number | null; target: number; score: number | null; list: string[] }
    services: { count: number | null; target: number; score: number | null }
    description: { length: number | null; target: number; mentionsCategory: boolean; score: number | null }
    completion: { score: number; checklist: { label: string; done: boolean | null }[] }
    reviews: { perWeek: number; target: number; score: number; synced: number }
    response: { rate: number | null; target: number; score: number | null }
    suspensionRisk: string
  }
  keywords: KeywordRow[]
  competitors: { name: string; rating: number | null; reviews: number | null; keywords: number; averageRank: number }[]
}
interface Saved {
  id: string
  created_at: string
  keywords: string[]
  report: Report
}

const rankText = (r: number) => (r > 20 ? '20+' : String(r))
const rankTone = (r: number) => (r <= 3 ? 'bg-emerald-500 text-white' : r <= 10 ? 'bg-amber-400 text-ink' : 'bg-red-500 text-white')
const scoreTone = (s: number | null) => (s == null ? 'text-muted' : s >= 80 ? 'text-emerald-600' : s >= 50 ? 'text-amber-600' : 'text-red-600')
const fmtDate = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function Audit() {
  const { isAgency } = useAuth()
  if (!isAgency) return <Navigate to="/dashboard" replace />
  return <AuditInner />
}

function AuditInner() {
  const { mode, activeBusinessId, state } = useStore()
  const toast = useToast()
  const [history, setHistory] = useState<Saved[]>([])
  const [current, setCurrent] = useState<Saved | null>(null)
  const [keywords, setKeywords] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [suggesting, setSuggesting] = useState(false)
  const [running, setRunning] = useState(false)

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
      .select('id, created_at, keywords, report')
      .eq('business_id', activeBusinessId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (off) return
        setLoading(false)
        if (error) return toast(error.message)
        const rows = (data ?? []) as Saved[]
        setHistory(rows)
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
    setRunning(true)
    try {
      const r = await invokeFn<{ id: string; createdAt: string; report: Report }>('audit', { action: 'run', businessId: activeBusinessId, keywords })
      const saved: Saved = { id: r.id, created_at: r.createdAt, keywords, report: r.report }
      setHistory((h) => [saved, ...h])
      setCurrent(saved)
      toast('Audit ready')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Audit failed')
    } finally {
      setRunning(false)
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
              <Button variant="outline" icon={Download} onClick={() => window.print()}>
                Download PDF
              </Button>
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
              {running ? 'Running… (up to a minute)' : 'Run audit'}
            </Button>
          </div>
          {history.length > 1 && (
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className="text-muted">Past reports</span>
              <select
                className="rounded-lg border border-line bg-white px-2 py-1.5"
                value={current?.id ?? ''}
                onChange={(e) => setCurrent(history.find((h) => h.id === e.target.value) ?? null)}
              >
                {history.map((h) => (
                  <option key={h.id} value={h.id}>
                    {fmtDate(h.created_at)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </Card>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-brand-700" />
        </div>
      ) : current ? (
        <ReportView saved={current} />
      ) : (
        <Card className="p-10 text-center text-muted print:hidden">No report yet. Check the keywords and run the audit.</Card>
      )}
    </div>
  )
}

/* ---------- report ---------- */

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('break-inside-avoid p-5', className)}>
      <h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>
      {children}
    </Card>
  )
}

function Bar({ label, value, target, score, unit = '' }: { label: string; value: number | null; target: number; score: number | null; unit?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink">{label}</span>
        <span className={cn('font-medium', scoreTone(score))}>
          {value == null ? 'Not checked' : `${value}${unit}`} <span className="font-normal text-muted">/ {target}{unit}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-canvas">
        <div
          className={cn('h-full rounded-full', score == null ? 'bg-gray-300' : score >= 80 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-400' : 'bg-red-500')}
          style={{ width: `${score ?? 0}%` }}
        />
      </div>
    </div>
  )
}

function ReportView({ saved }: { saved: Saved }) {
  const r = saved.report
  const s = r.scores
  const risk = s.suspensionRisk
  return (
    <div className="space-y-5 print:space-y-4">
      {/* Header */}
      <Card className="break-inside-avoid p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-muted">Google Business Profile audit · {fmtDate(saved.created_at)}</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">{r.business.name}</h2>
            {r.business.category && <p className="text-sm text-muted">{r.business.category}</p>}
            <p className="mt-2 flex items-start gap-1.5 text-sm text-muted">
              <MapPin className="mt-0.5 size-4 shrink-0" />
              {r.business.address}
            </p>
            {r.business.rating != null && (
              <p className="mt-2 flex items-center gap-2 text-sm">
                <span className="font-semibold">{r.business.rating.toFixed(1)}</span>
                <Stars rating={r.business.rating} />
                <span className="text-muted">{r.business.reviewCount ?? 0} reviews</span>
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl bg-canvas px-5 py-4 text-center">
              <p className="text-xs uppercase tracking-wide text-muted">Search rank</p>
              <p className={cn('text-3xl font-semibold', r.searchRank <= 3 ? 'text-emerald-600' : r.searchRank <= 10 ? 'text-amber-600' : 'text-red-600')}>
                {r.searchRank > 20 ? '20+' : r.searchRank}
              </p>
              <p className="text-xs text-muted">average</p>
            </div>
            <div className="rounded-xl bg-canvas px-5 py-4 text-center">
              <p className="text-xs uppercase tracking-wide text-muted">Profile score</p>
              <p className={cn('text-3xl font-semibold', scoreTone(s.profileScore))}>{s.profileScore}%</p>
              <p className="text-xs text-muted">out of 100</p>
            </div>
          </div>
        </div>
        {r.gbpNote && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {r.gbpNote}
          </p>
        )}
      </Card>

      <div className="grid gap-5 md:grid-cols-2 print:grid-cols-2">
        <Section title="Profile SEO">
          <div className="space-y-4">
            <Bar label="Business name" value={s.title.score} target={100} score={s.title.score} unit="%" />
            <Bar label="Categories" value={s.categories.count} target={s.categories.target} score={s.categories.score} />
            <Bar label="Services" value={s.services.count} target={s.services.target} score={s.services.score} />
            <Bar label="Description length" value={s.description.length} target={s.description.target} score={s.description.score} unit=" chars" />
            <Bar label="New reviews per week" value={s.reviews.perWeek} target={s.reviews.target} score={s.reviews.score} />
            <Bar label="Review replies" value={s.response.rate} target={s.response.target} score={s.response.score} unit="%" />
          </div>
          {s.categories.list.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {s.categories.list.map((c) => (
                <Badge key={c} tone="gray">{c}</Badge>
              ))}
            </div>
          )}
        </Section>

        <div className="space-y-5 print:space-y-4">
          <Section title="Profile completion">
            <p className={cn('mb-3 text-2xl font-semibold', scoreTone(s.completion.score))}>{s.completion.score}%</p>
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {s.completion.checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-2">
                  {c.done == null ? (
                    <CircleDashed className="size-4 text-muted" />
                  ) : c.done ? (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  ) : (
                    <XCircle className="size-4 text-red-500" />
                  )}
                  <span className={c.done == null ? 'text-muted' : 'text-ink'}>{c.label}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Suspension risk">
            <Badge tone={risk === 'High' ? 'red' : risk === 'Medium' ? 'amber' : 'green'} className="text-sm">{risk}</Badge>
            {s.title.issues.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink">
                {s.title.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">No keyword stuffing found in the business name.</p>
            )}
          </Section>
        </div>
      </div>

      <Section title="Keyword ranks">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-2 pr-3 font-medium">Keyword</th>
                {r.keywords.some((k) => k.impressions != null) && <th className="py-2 pr-3 font-medium">Searches</th>}
                <th className="py-2 pr-3 font-medium">At business</th>
                <th className="py-2 pr-3 font-medium">Average</th>
                <th className="py-2 pr-3 font-medium">Found in</th>
                <th className="py-2 font-medium">Top 3 in</th>
              </tr>
            </thead>
            <tbody>
              {r.keywords.map((k) => (
                <tr key={k.keyword} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 text-ink">{k.keyword}</td>
                  {r.keywords.some((x) => x.impressions != null) && <td className="py-2 pr-3">{k.impressions ?? '—'}</td>}
                  <td className="py-2 pr-3">
                    <span className={cn('inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold', rankTone(k.center))}>{rankText(k.center)}</span>
                  </td>
                  <td className="py-2 pr-3">{k.average > 20 ? '20+' : k.average}</td>
                  <td className="py-2 pr-3">{k.foundIn}/9</td>
                  <td className="py-2">{k.top3In}/9</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Competitors ranking above you">
        {r.competitors.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-2 pr-3 font-medium">Business</th>
                  <th className="py-2 pr-3 font-medium">Rating</th>
                  <th className="py-2 pr-3 font-medium">Reviews</th>
                  <th className="py-2 pr-3 font-medium">Above you in</th>
                  <th className="py-2 font-medium">Avg rank</th>
                </tr>
              </thead>
              <tbody>
                {r.competitors.map((c) => (
                  <tr key={c.name} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 text-ink">{c.name}</td>
                    <td className="py-2 pr-3">{c.rating?.toFixed(1) ?? '—'}</td>
                    <td className="py-2 pr-3">{c.reviews ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {c.keywords} keyword{c.keywords > 1 ? 's' : ''}
                    </td>
                    <td className="py-2">{c.averageRank}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">Nobody ranks above this business at its location.</p>
        )}
      </Section>

      <Section title={`Rank map (3 × 3 grid, ${r.gridStepKm} km apart)`} className="print:break-before-page">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
          {r.keywords.map((k) => (
            <div key={k.keyword} className="break-inside-avoid">
              <p className="mb-2 truncate text-sm font-medium text-ink" title={k.keyword}>{k.keyword}</p>
              <div className="grid w-fit grid-cols-3 gap-1.5 rounded-xl bg-canvas p-2">
                {k.grid.map((rank, i) => (
                  <span
                    key={i}
                    className={cn('flex size-11 items-center justify-center rounded-full text-sm font-semibold', rankTone(rank), i === 4 && 'ring-2 ring-ink ring-offset-2 ring-offset-canvas')}
                  >
                    {rankText(rank)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">Center = business location. Green 1–3, amber 4–10, red 11+.</p>
      </Section>
    </div>
  )
}
