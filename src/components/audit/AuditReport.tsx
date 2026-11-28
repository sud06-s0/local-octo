// src/components/audit/AuditReport.tsx
// The audit report itself — used in the app (Audit page) and on the public share page (/audit-report/<token>).
// Handles version 1 reports (saved before the pass/fail checks) by hiding the parts they don't have.

import type { ReactNode } from 'react'
import { AlertTriangle, ArrowUp, CheckCircle2, CircleDashed, MapPin, Send, XCircle } from 'lucide-react'
import { Badge, Card, Stars } from '../ui/primitives'
import { cn } from '../../lib/utils'
import { brand } from '../../config/brand'
import { RankGrid, RankMap, rankText, rankTone } from './RankMap'

export interface KeywordRow {
  keyword: string
  grid: number[]
  center: number
  average: number
  foundIn: number
  top3In: number
  impressions: number | null
  size?: number
  stepKm?: number
  points?: number
  growth?: number
}
export interface AuditCheck {
  key: string
  label: string
  pass: boolean | null
  detail: string
}
export interface Report {
  version?: number
  business: { name: string; address: string; rating: number | null; reviewCount: number | null; category: string; lat?: number; lng?: number }
  center?: { lat: number; lng: number }
  areaKm?: number
  source: 'gbp' | 'places'
  gbpNote: string
  gridStepKm?: number
  searchRank: number
  optimizationScore?: number
  market?: { monthly: number; people: number; ticket: number }
  summary?: string
  checks?: AuditCheck[]
  suggestions?: {
    items?: { title: string; detail: string; items?: string[] }[]
    description: string | null
    descriptionKeywords: string[]
    services: string[] | null
    moreServices: number | null
    servicesWithoutDescription: string[] | null
  }
  scores: {
    profileScore?: number
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
  competitors: { name: string; address?: string; rating: number | null; reviews: number | null; keywords: number; averageRank: number; totalKeywords?: number }[]
}

const scoreTone = (s: number | null | undefined) => (s == null ? 'text-muted' : s >= 80 ? 'text-emerald-700' : s >= 50 ? 'text-amber-700' : 'text-red-600')
export const fmtDate = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

export function contactUrl(business: string) {
  return brand.auditContactUrl || `mailto:${brand.supportEmail}?subject=${encodeURIComponent(`Google profile audit — ${business}`)}`
}

function GetInTouch({ business, label = 'Get In Touch', className }: { business: string; label?: string; className?: string }) {
  return (
    <a
      href={contactUrl(business)}
      target="_blank"
      rel="noreferrer"
      className={cn('inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800', className)}
    >
      <Send className="size-4" /> {label}
    </a>
  )
}

function Section({ title, children, className, action }: { title: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <Card className={cn('break-inside-avoid p-5', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  )
}

function Gauge({ value }: { value: number }) {
  const r = 52
  const len = Math.PI * r
  const color = value >= 80 ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444'
  return (
    <svg viewBox="0 0 128 74" className="w-40">
      <path d="M12 68 A52 52 0 0 1 116 68" fill="none" stroke="#ebe8f0" strokeWidth="12" strokeLinecap="round" />
      <path d="M12 68 A52 52 0 0 1 116 68" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(value / 100) * len} ${len}`} />
      <text x="64" y="62" textAnchor="middle" className="fill-ink" style={{ fontSize: 22, fontWeight: 600 }}>
        {value}%
      </text>
    </svg>
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
        <div className={cn('h-full rounded-full', score == null ? 'bg-gray-300' : score >= 80 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-600')} style={{ width: `${score ?? 0}%` }} />
      </div>
    </div>
  )
}

function PassBadge({ pass }: { pass: boolean | null }) {
  if (pass == null) return <Badge tone="gray">Not checked</Badge>
  return pass ? (
    <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">Pass</span>
  ) : (
    <Badge tone="red">Fail</Badge>
  )
}

function NameList({ items }: { items: string[] }) {
  return (
    <ul className={cn('mt-2 grid gap-x-4 gap-y-1 text-sm text-ink', items.every((s) => s.length <= 40) && 'sm:grid-cols-2')}>
      {items.map((s) => (
        <li key={s} className="flex items-center gap-2">
          <span className="mt-1.5 size-1.5 shrink-0 self-start rounded-full bg-brand-600" />
          {s}
        </li>
      ))}
    </ul>
  )
}

export function AuditReport({ report: r, createdAt, shareToken }: { report: Report; createdAt: string; shareToken?: string }) {
  const s = r.scores
  const risk = s.suspensionRisk
  const score = r.optimizationScore ?? s.profileScore ?? 0
  const name = r.business.name
  const heat = r.keywords.filter((k) => (k.size ?? 3) >= 7)
  const small = r.keywords.filter((k) => (k.size ?? 3) < 7)
  const hasLoc = r.business.lat != null && r.business.lng != null
  // Grid centre: the chosen audit centre, or the business for older reports
  const cLat = r.center?.lat ?? r.business.lat!
  const cLng = r.center?.lng ?? r.business.lng!
  const movedCenter = !!r.center && hasLoc && (Math.abs(r.center.lat - r.business.lat!) > 0.0005 || Math.abs(r.center.lng - r.business.lng!) > 0.0005)
  const marker = movedCenter ? { lat: r.business.lat!, lng: r.business.lng! } : undefined
  const fmtKm = (km: number) => `${km < 10 ? Math.round(km * 10) / 10 : Math.round(km)} km (${Math.round((km / 1.609) * 10) / 10} mi)`
  const drillFor = (k: KeywordRow) => (shareToken ? { token: shareToken, keywordIndex: r.keywords.indexOf(k) } : undefined)

  return (
    <div className="space-y-5 print:space-y-4">
      {/* Header */}
      <Card className="break-inside-avoid p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-muted">Google Business Profile audit · {fmtDate(createdAt)}</p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">{name}</h1>
            {r.business.category && <p className="text-sm text-muted">{r.business.category}</p>}
            {r.business.rating != null && (
              <p className="mt-2 flex items-center gap-2 text-sm">
                <span className="font-semibold">{r.business.rating.toFixed(1)}/5</span>
                <Stars rating={r.business.rating} />
                <span className="text-muted">{r.business.reviewCount ?? 0} reviews</span>
              </p>
            )}
            <p className="mt-2 flex items-start gap-1.5 text-sm text-muted">
              <MapPin className="mt-0.5 size-4 shrink-0" />
              {r.business.address}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <div className="text-center">
              <Gauge value={score} />
              <p className="text-xs font-medium text-muted">{r.checks ? 'Optimization Score' : 'Profile Score'}</p>
            </div>
            <div className="rounded-xl bg-canvas px-5 py-4 text-center">
              <p className="text-xs uppercase tracking-wide text-muted">Search rank</p>
              <p className={cn('text-3xl font-semibold', r.searchRank <= 5 ? 'text-emerald-700' : r.searchRank <= 10 ? 'text-amber-700' : 'text-red-600')}>
                {r.searchRank > 20 ? '20+' : r.searchRank}
              </p>
              <p className="text-xs text-muted">average, top 5 keywords</p>
            </div>
          </div>
        </div>
        {r.gbpNote && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 print:hidden">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {r.gbpNote}
          </p>
        )}
      </Card>

      {/* Market opportunity */}
      {r.market && (
        <Card className="break-inside-avoid p-6">
          <p className="font-medium text-ink">Monthly Market Opportunity</p>
          <p className="mt-2 text-3xl font-semibold text-brand-800">{inr(r.market.monthly)}</p>
          <p className="mt-1 text-sm text-brand-800">Estimated amount people spend on your type of business each month within 30 minutes of you.</p>
          <p className="mt-1 text-sm text-muted">
            About {r.market.people.toLocaleString('en-IN')} people use your type of business each month and spend roughly {inr(r.market.ticket)} each time.
          </p>
          <GetInTouch business={name} className="mt-4" />
        </Card>
      )}

      {/* Summary */}
      {r.summary && (
        <Section title="Audit Summary">
          <div className="space-y-3 text-[15px] leading-relaxed text-ink">
            {r.summary.split(/\n\s*\n/).map((p, i) => (
              <p key={i}>{p.trim()}</p>
            ))}
          </div>
        </Section>
      )}

      {/* Pass / fail */}
      {r.checks && (
        <Section title="Audit Results" action={<GetInTouch business={name} />}>
          <ul className="divide-y divide-line">
            {r.checks.map((c) => (
              <li key={c.key} className="flex items-start justify-between gap-4 py-3">
                <div className="flex min-w-0 gap-3">
                  {c.pass == null ? (
                    <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted" />
                  ) : c.pass ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" />
                  ) : (
                    <XCircle className="mt-0.5 size-5 shrink-0 text-red-500" />
                  )}
                  <div>
                    <p className="font-medium text-ink">{c.label}</p>
                    <p className="text-sm text-muted">{c.pass ? 'Great work passing this requirement! ' : ''}{c.detail}</p>
                  </div>
                </div>
                <PassBadge pass={c.pass} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Competitors */}
      <Section title={r.checks ? 'Top Competitors' : 'Competitors ranking above you'} action={r.checks ? <GetInTouch business={name} /> : undefined}>
        {r.competitors.length ? (
          <ol className="divide-y divide-line">
            {r.competitors.map((c, i) => (
              <li key={c.name + i} className="flex items-start gap-3 py-3">
                <span className="w-7 shrink-0 text-sm font-semibold text-brand-800">#{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{c.name}</p>
                  {c.address && <p className="truncate text-sm text-muted">{c.address}</p>}
                  <p className="mt-0.5 flex items-center gap-2 text-sm">
                    {c.rating != null && (
                      <>
                        <span className="font-medium">{c.rating.toFixed(1)}</span>
                        <Stars rating={c.rating} size={13} />
                      </>
                    )}
                    {c.reviews != null && <span className="text-muted">({c.reviews.toLocaleString('en-IN')})</span>}
                  </p>
                </div>
                <span className="shrink-0 text-right text-xs text-muted">
                  avg rank <span className="text-sm font-semibold text-ink">{c.averageRank}</span>
                  {c.totalKeywords != null && (
                    <>
                      <br />
                      in {c.keywords} of {c.totalKeywords} keywords
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">No competitors found for these keywords.</p>
        )}
      </Section>

      {/* Suggestions */}
      {r.suggestions?.items ? (
        <Section title={`${brand.appName}'s optimization suggestions`} action={r.suggestions.items.length ? <GetInTouch business={name} label="Let us fix these issues" /> : undefined}>
          {r.suggestions.items.length ? (
            <>
              <p className="mb-4 text-sm text-muted">Do these to rank higher in your local Google search results.</p>
              <ol className="space-y-3">
                {r.suggestions.items.map((sg, i) => (
                  <li key={sg.title} className="flex gap-3 rounded-xl border border-line p-4">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-800">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{sg.title}</p>
                      <p className="mt-0.5 text-sm text-muted">{sg.detail}</p>
                      {!!sg.items?.length && <NameList items={sg.items} />}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-ink">
              <CheckCircle2 className="size-5 text-emerald-700" /> Nothing to fix — this profile is fully optimized.
            </p>
          )}
        </Section>
      ) : (
        r.suggestions &&
        (r.suggestions.description != null || r.suggestions.services) && (
          <Section title={`${brand.appName}'s optimization suggestions`} action={<GetInTouch business={name} label="Let us fix these issues" />}>
            <div className="space-y-4">
              {!!r.suggestions.moreServices && <p className="text-sm font-medium text-red-600">Add at least {r.suggestions.moreServices} more services.</p>}
              {!!r.suggestions.servicesWithoutDescription?.length && (
                <div className="rounded-xl border border-line p-4">
                  <p className="font-medium text-ink">Your services without descriptions</p>
                  <NameList items={r.suggestions.servicesWithoutDescription} />
                </div>
              )}
              {!r.suggestions.moreServices && !r.suggestions.servicesWithoutDescription?.length && <p className="text-sm text-muted">Run the audit again for detailed suggestions.</p>}
            </div>
          </Section>
        )
      )}

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
                  {c.done == null ? <CircleDashed className="size-4 text-muted" /> : c.done ? <CheckCircle2 className="size-4 text-emerald-700" /> : <XCircle className="size-4 text-red-500" />}
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

      {/* Keyword table */}
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
              {r.keywords.map((k) => {
                const n = k.points ?? k.grid.length
                return (
                  <tr key={k.keyword} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 text-ink">{k.keyword}</td>
                    {r.keywords.some((x) => x.impressions != null) && <td className="py-2 pr-3">{k.impressions ?? '—'}</td>}
                    <td className="py-2 pr-3">
                      <span className={cn('inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold', rankTone(k.center))}>{rankText(k.center)}</span>
                    </td>
                    <td className="py-2 pr-3">{k.average > 20 ? '20+' : k.average}</td>
                    <td className="py-2 pr-3">{k.foundIn}/{n}</td>
                    <td className="py-2">{k.top3In}/{n}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">Green = top 3, amber = 4–10, red = 11 or lower. 20+ = not in the first 20 results.</p>
      </Section>

      {/* Heatmaps */}
      {heat.length > 0 && (
        <Section title="Heatmap audits" className="print:break-before-page">
          <div className="space-y-6">
            {heat.map((k) => (
              <div key={k.keyword} className="mx-auto max-w-[760px] break-inside-avoid rounded-xl border border-line p-4">
                <p className="text-sm text-muted">
                  Keyword: <span className="font-medium text-brand-800">{k.keyword}</span>
                </p>
                <div className="my-3 flex flex-wrap items-end justify-between gap-3 rounded-lg bg-canvas px-4 py-3">
                  <div>
                    <p className="text-xs text-muted">Average ranking</p>
                    <p className="text-xl font-semibold text-ink">#{k.average > 20 ? 20 : Math.round(k.average)}</p>
                  </div>
                  {k.growth != null && k.growth > 1 && (
                    <div className="text-right">
                      <p className="text-xs text-muted">Ranking #1 can grow your customers by</p>
                      <p className="flex items-center justify-end gap-1 text-xl font-semibold text-emerald-700">
                        {k.growth}x <ArrowUp className="size-4" />
                      </p>
                    </div>
                  )}
                </div>
                {hasLoc ? (
                  <RankMap lat={cLat} lng={cLng} size={k.size ?? 7} stepKm={k.stepKm ?? 1} grid={k.grid} drill={drillFor(k)} marker={marker} />
                ) : (
                  <RankGrid grid={k.grid} size={k.size ?? 7} />
                )}
                <p className="mt-2 text-xs text-muted">
                  {k.size}×{k.size} points over {fmtKm(r.areaKm ?? ((k.size ?? 7) - 1) * (k.stepKm ?? 1))} square, {fmtKm(k.stepKm ?? 1)} apart.{' '}
                  {movedCenter ? 'Black ring = centre of the area, black pin = your business.' : 'Black ring = your business.'}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}
      {small.length > 0 && (
        <Section title={heat.length ? 'More keywords' : `Rank map (3 × 3 grid, ${small[0].stepKm ?? r.gridStepKm ?? 1.5} km apart)`} className={heat.length ? '' : 'print:break-before-page'}>
          <div className="grid gap-5 sm:grid-cols-2 print:grid-cols-2">
            {small.map((k) => (
              <div key={k.keyword} className="min-w-0 break-inside-avoid">
                <p className="mb-2 truncate text-sm font-medium text-ink" title={k.keyword}>
                  {k.keyword} <span className="font-normal text-muted">· avg {k.average > 20 ? '20+' : k.average}</span>
                </p>
                {hasLoc ? <RankMap lat={cLat} lng={cLng} size={k.size ?? 3} stepKm={k.stepKm ?? 1.5} grid={k.grid} drill={drillFor(k)} marker={marker} /> : <RankGrid grid={k.grid} size={k.size ?? 3} />}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Closing */}
      {r.checks && (
        <Card className="break-inside-avoid p-6">
          <p className="text-lg font-semibold text-ink">Get in touch to:</p>
          <ul className="mt-3 space-y-2 text-[15px] text-ink">
            {['Optimize your Google Business Profile', 'Rank higher on Google Maps', 'Grow your business faster with more customers from Google'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-700" /> {t}
              </li>
            ))}
          </ul>
          <GetInTouch business={name} label="Get In Touch!" className="mt-5" />
        </Card>
      )}
    </div>
  )
}
