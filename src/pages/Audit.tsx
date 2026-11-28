// src/pages/Audit.tsx
// Audit / rank report for the selected business. Agency logins: unlimited runs. Client logins: 1 run per calendar month.
// Before running: pick up to 3 keywords and the audit area (centre + square size in km or miles, up to 100 km).
// "Download PDF" prints the report; "Copy public link" gives a page anyone can open (/audit-report/<token>).

import { useEffect, useState, type ReactNode } from 'react'
import { Check, Download, Link2, Loader2, Play, Plus, Sparkles, X } from 'lucide-react'
import { Button, Card, Input, PageHeader } from '../components/ui/primitives'
import { useStore } from '../store/AppStore'
import { useAuth } from '../store/AuthProvider'
import { useToast } from '../components/ui/Toast'
import { db, invokeFn } from '../lib/supabase'
import { cn } from '../lib/utils'
import { AuditReport, type Report } from '../components/audit/AuditReport'
import { AreaPicker, type AreaUnit, type GeoResult, type LatLng } from '../components/audit/AreaPicker'

const MAX_KEYWORDS = 3
const DEFAULT_AREA_KM = 6

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
const titleCase = (t: string) => t.replace(/\b\w/g, (c) => c.toUpperCase())

function savedUnit(): AreaUnit {
  try {
    return localStorage.getItem('lo.audit.unit') === 'mi' ? 'mi' : 'km'
  } catch {
    return 'km'
  }
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-3 flex items-center gap-2.5 text-lg font-semibold text-ink">
        <span className="flex size-7 items-center justify-center rounded-full bg-brand-700 text-sm text-white">{n}</span>
        {title}
      </h2>
      <Card className="p-5">{children}</Card>
    </section>
  )
}

export default function Audit() {
  const { mode, activeBusinessId, state } = useStore()
  const { isAgency } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState<Saved | null>(null)
  const [keywords, setKeywords] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [loading, setLoading] = useState(true)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState<string[] | null>(null) // up to 10 ideas, shown after clicking Suggest
  const [category, setCategory] = useState('')
  const [running, setRunning] = useState(false)
  const [runKeywords, setRunKeywords] = useState<string[]>([])
  const [lastClientRun, setLastClientRun] = useState<string | null>(null)
  // Audit area
  const [business, setBusiness] = useState<LatLng | null>(null)
  const [center, setCenter] = useState<LatLng | null>(null)
  const [areaKm, setAreaKm] = useState(DEFAULT_AREA_KM)
  const [unit, setUnitState] = useState<AreaUnit>(savedUnit)
  const setUnit = (u: AreaUnit) => {
    setUnitState(u)
    try {
      localStorage.setItem('lo.audit.unit', u)
    } catch {
      // ignore
    }
  }
  // Clients get 1 audit per calendar month (agency runs don't count)
  const usedThisMonth = !isAgency && !!lastClientRun && monthKey(new Date(lastClientRun)) === monthKey(new Date())

  const suggest = async () => {
    if (!activeBusinessId) return
    setSuggesting(true)
    try {
      const r = await invokeFn<{ keywords: string[]; source: string; category?: string }>('audit', { action: 'suggest', businessId: activeBusinessId })
      setSuggestions(r.keywords.slice(0, 10).map((k) => k.toLowerCase()))
      setCategory(r.category ?? '')
      if (!r.keywords.length) toast('No keywords found. Add them yourself.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not get keywords')
    } finally {
      setSuggesting(false)
    }
  }

  useEffect(() => {
    if (mode !== 'live' || !activeBusinessId) {
      setLoading(false)
      return
    }
    let off = false
    setLoading(true)
    setCurrent(null)
    setSuggestions(null)
    setBusiness(null)
    setCenter(null)
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
        const row = ((data ?? []) as Saved[])[0]
        setCurrent(row ?? null)
        setKeywords(row ? row.keywords.slice(0, MAX_KEYWORDS) : [])
        // Start from the last audit's area, if it had one
        if (row?.report.center) setCenter(row.report.center)
        if (row?.report.areaKm) setAreaKm(row.report.areaKm)
      })
    invokeFn<{ lat: number | null; lng: number | null }>('audit', { action: 'center', businessId: activeBusinessId })
      .then((r) => {
        if (off || r.lat == null || r.lng == null) return
        const b = { lat: r.lat, lng: r.lng }
        setBusiness(b)
        setCenter((cur) => cur ?? b)
      })
      .catch(() => {})
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

  const toggleKeyword = (k: string) => {
    if (keywords.includes(k)) return setKeywords(keywords.filter((x) => x !== k))
    if (keywords.length >= MAX_KEYWORDS) return toast(`Max ${MAX_KEYWORDS} keywords. Remove one to add another.`)
    setKeywords([...keywords, k])
  }
  const addCustom = () => {
    const k = draft.trim().toLowerCase()
    if (!k) return
    if (!keywords.includes(k)) {
      if (keywords.length >= MAX_KEYWORDS) return toast(`Max ${MAX_KEYWORDS} keywords. Remove one to add another.`)
      setKeywords([...keywords, k])
    }
    setDraft('')
  }

  const geocode = async (query: string): Promise<GeoResult[]> => {
    try {
      const r = await invokeFn<{ results: GeoResult[] }>('audit', { action: 'geocode', businessId: activeBusinessId, query, center: center ?? business })
      return r.results
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Search failed')
      return []
    }
  }

  const run = async () => {
    if (!activeBusinessId || !keywords.length) return
    setRunKeywords(keywords)
    setRunning(true)
    try {
      const r = await invokeFn<{ id: string; createdAt: string; shareToken: string; report: Report }>('audit', {
        action: 'run',
        businessId: activeBusinessId,
        keywords,
        center: center ?? undefined,
        areaKm,
      })
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

  // Suggestion chips only; picked keywords (incl. custom ones) are listed in the Selected box
  const chips = suggestions ?? []

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

        <Step n={1} title="Select keywords">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-ink">Choose up to {MAX_KEYWORDS} keywords to audit.</p>
              {suggestions && category && (
                <p className="text-sm text-muted">
                  These suggestions are for a <span className="font-medium text-ink">{category}</span>.
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" icon={suggesting ? Loader2 : Sparkles} onClick={suggest} disabled={suggesting || running}>
              {suggestions ? 'Refresh suggestions' : 'Get suggestions'}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {chips.map((k) => {
              const on = keywords.includes(k)
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleKeyword(k)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition',
                    on ? 'bg-brand-700 text-white hover:bg-brand-800' : 'bg-canvas text-ink ring-1 ring-line hover:ring-brand-300',
                  )}
                >
                  {on ? <Check className="size-3.5" /> : <Plus className="size-3.5" />} {titleCase(k)}
                </button>
              )
            })}
            {showCustom ? (
              <span className="inline-flex items-center gap-1.5">
                <Input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.preventDefault(), addCustom())
                    if (e.key === 'Escape') setShowCustom(false)
                  }}
                  placeholder="e.g. pu college near me"
                  className="h-9 w-56"
                />
                <Button size="sm" onClick={addCustom}>
                  Add
                </Button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowCustom(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50"
              >
                <Plus className="size-3.5" /> Add custom
              </button>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-line p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-medium text-ink">Selected keywords</p>
              <span className="text-sm font-semibold text-emerald-700">
                {keywords.length} / {MAX_KEYWORDS}
              </span>
            </div>
            {keywords.length ? (
              <div className="flex flex-wrap gap-2">
                {keywords.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white">
                    {titleCase(k)}
                    <button type="button" onClick={() => toggleKeyword(k)} aria-label={`Remove ${k}`} className="rounded p-0.5 hover:bg-white/20">
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">None yet — pick from the suggestions or add your own.</p>
            )}
          </div>
        </Step>

        <Step n={2} title="Location & area">
          {center ? (
            <AreaPicker
              center={center}
              onCenter={setCenter}
              areaKm={areaKm}
              onArea={setAreaKm}
              unit={unit}
              onUnit={setUnit}
              business={business}
              onSearch={geocode}
              disabled={running}
            />
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" /> Loading the business location…
            </p>
          )}
        </Step>

        <div className="mb-8 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            {!isAgency
              ? usedThisMonth
                ? `You've used this month's audit. The next one is available on ${nextMonthStart()}.`
                : 'You can run 1 audit per month.'
              : 'Each audit checks 49 points per keyword. It takes about a minute.'}
          </p>
          <Button icon={running ? Loader2 : Play} onClick={run} disabled={running || !keywords.length || usedThisMonth}>
            {running ? 'Running…' : 'Run audit'}
          </Button>
        </div>
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
        <Card className="p-10 text-center text-muted print:hidden">No report yet. Pick keywords and the area, then run the audit.</Card>
      )}
    </div>
  )
}

/** Time estimate + steps while the audit runs (the function itself doesn't report progress). */
function RunProgress({ keywords }: { keywords: string[] }) {
  // Rough timings: profile ~6s, each 7x7 keyword ~9s, summary ~10s
  const steps = [
    { label: 'Reading the Google Business Profile', secs: 6 },
    ...keywords.map((k) => ({ label: `Checking ranks for "${k}"`, secs: 9 })),
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

