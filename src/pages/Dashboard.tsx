// src/pages/Dashboard.tsx
import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartColumn, Copy, ExternalLink, Mail, MapPin, MousePointerClick, Pencil, SquarePen, Star, UserPlus, type LucideIcon } from 'lucide-react'
import { Button, Card, EmptyState, LabeledDivider, Stars, UnderlineHeading } from '../components/ui/primitives'
import { GoogleG } from '../components/ui/BrandIcons'
import { useStore } from '../store/AppStore'
import { Modal } from '../components/ui/Modal'
import { BusinessDetailsForm, businessDetailsValid, type BusinessDetails } from '../components/BusinessDetailsForm'
import { useToast } from '../components/ui/Toast'
import { cn, copyText } from '../lib/utils'

type Range = '7d' | '30d' | 'all'
const DAY = 86_400_000

function withinDays(iso: string | null, days: number) {
  return !!iso && Date.now() - new Date(iso).getTime() <= days * DAY
}

function StatTile({ label, value, icon: Icon }: { label: string; value: number; icon: LucideIcon }) {
  return (
    <div className="rounded-lg bg-canvas p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-ink/80">{label}</span>
        <Icon className="size-4 shrink-0 text-brand-600" />
      </div>
      <p className="mt-3 text-[22px] font-semibold text-ink">{value}</p>
    </div>
  )
}

export default function Dashboard() {
  const { state, updateSettings, importFromGoogle } = useStore()
  const toast = useToast()
  const { reviews, contacts, settings } = state
  const [range, setRange] = useState<Range>('30d')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [details, setDetails] = useState<BusinessDetails>(settings.business)

  const stats = useMemo(
    () => ({
      newReviews: reviews.filter((r) => withinDays(r.createdAt, 30)).length,
      updated: 0, // TODO: from Google Business Profile API (edited reviews)
      clicks: contacts.filter((c) => (c.status === 'clicked' || c.status === 'reviewed') && withinDays(c.lastSentAt, 30)).length,
      requests: contacts.filter((c) => withinDays(c.lastSentAt, 30)).reduce((n, c) => n + c.requestsSent, 0),
      added: contacts.filter((c) => withinDays(c.addedAt, 30)).length,
    }),
    [reviews, contacts],
  )

  // Google's own totals when imported (Places API), otherwise what's stored here
  const storedAvg = reviews.length ? reviews.reduce((n, r) => n + r.rating, 0) / reviews.length : 0
  const avg = settings.business.googleRating ?? storedAvg
  const totalReviews = settings.business.googleReviewCount ?? reviews.length

  const chartData = useMemo(() => {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : null
    const inRange = reviews.filter((r) => (days ? withinDays(r.createdAt, days) : true))
    if (inRange.length < 2) return []
    // Group by month for "all", by day otherwise
    const buckets = new Map<string, number>()
    const sorted = [...inRange].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
    let total = 0
    for (const r of sorted) {
      const d = new Date(r.createdAt)
      const key = days
        ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
        : d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
      total += 1
      buckets.set(key, total)
    }
    return [...buckets.entries()].map(([label, count]) => ({ label, count }))
  }, [reviews, range])

  // 5-star reviews needed to lift the average to 4.9
  const ratingSum = avg * totalReviews
  const toNext = avg >= 4.9 ? null : Math.ceil((4.9 * totalReviews - ratingSum) / 0.1)

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-6">
        {/* Business + performance */}
        <Card className="@container p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] font-semibold tracking-tight sm:text-[30px]">
              <UnderlineHeading>{settings.business.name}</UnderlineHeading>
            </h1>
            <button
              onClick={() => { setDetails(settings.business); setDetailsOpen(true) }}
              className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink"
              aria-label="Edit business details"
            >
              <Pencil className="size-4" />
            </button>
          </div>
          <p className="mt-3 flex items-start gap-2 text-[16px] text-ink/85">
            <MapPin className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
            {settings.business.address || <span className="text-muted">Add your address</span>}
          </p>
          {!settings.business.reviewLink && (
            <button
              onClick={() => { setDetails(settings.business); setDetailsOpen(true) }}
              className="mt-4 w-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800 hover:bg-amber-100/70"
            >
              <b>Add your Google review link</b> — review requests are on hold until it's set.
            </button>
          )}

          <div className="mt-7">
            <LabeledDivider label="Last 30 Days Performance" />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-5">
            <StatTile label="New Reviews" value={stats.newReviews} icon={Star} />
            <StatTile label="Updated Reviews" value={stats.updated} icon={SquarePen} />
            <StatTile label="Link Clicks" value={stats.clicks} icon={MousePointerClick} />
            <StatTile label="Requests Sent" value={stats.requests} icon={Mail} />
            <StatTile label="Contacts Added" value={stats.added} icon={UserPlus} />
          </div>
        </Card>

        {/* Review history */}
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium">Review History</h2>
            <div className="flex items-center gap-1">
              {(['7d', '30d', 'all'] as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-sm transition',
                    range === r ? 'bg-brand-700 font-medium text-white' : 'text-muted hover:bg-canvas hover:text-ink',
                  )}
                >
                  {r === 'all' ? 'All' : r}
                </button>
              ))}
            </div>
          </div>

          {chartData.length === 0 ? (
            <EmptyState icon={ChartColumn} title="Not enough data yet" body="Keep collecting reviews to see trends over time" />
          ) : (
            <div className="mt-6 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ left: -20, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="loArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1f7a3a" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#1f7a3a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#eef0ef" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#5d6762' }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#5d6762' }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 10, border: '1px solid #e4e7e6', fontSize: 13 }}
                    formatter={(v) => [v, 'Total reviews']}
                  />
                  <Area type="monotone" dataKey="count" stroke="#17672e" strokeWidth={2.5} fill="url(#loArea)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Business details"
        footer={
          <>
            <Button variant="outline" onClick={() => setDetailsOpen(false)}>Cancel</Button>
            <Button
              disabled={!businessDetailsValid(details)}
              onClick={async () => {
                await updateSettings('business', {
                  name: details.name.trim(),
                  address: details.address.trim(),
                  reviewLink: details.reviewLink.trim(),
                  mapsUrl: details.mapsUrl.trim(),
                })
                setDetailsOpen(false)
                toast('Business details saved')
                // Newly linked to Google: import rating, phone, website and latest reviews
                if (details.placeId && details.placeId !== settings.business.placeId) {
                  try {
                    const r = await importFromGoogle(details.placeId)
                    if (r.imported) toast(`Imported ${r.imported} reviews from Google`)
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Google import failed', 'error')
                  }
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <BusinessDetailsForm value={details} onChange={setDetails} />
      </Modal>

      {/* Google reviews summary */}
      <Card className="h-fit p-6">
        <h2 className="text-lg font-semibold">Google Reviews</h2>
        <div className="mt-8 flex flex-col items-center text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-canvas">
            <GoogleG className="size-7" />
          </span>
          <p className="mt-4">
            <span className="text-4xl font-bold">{avg.toFixed(1)}</span>
            <span className="ml-1 text-muted">/ 5</span>
          </p>
          <Stars rating={avg} size={24} className="mt-1" />
          <p className="mt-2 text-sm text-muted">{totalReviews} Google reviews</p>
        </div>

        <div className="my-6 h-px bg-line" />
        <div className="text-center">
          <p className="font-medium">{avg >= 4.8 ? 'Maintain Excellence' : 'Room to Grow'}</p>
          <p className="mt-1.5 text-xs text-muted">
            {avg >= 4.8 ? 'Keep getting 5-star reviews to maintain your perfect score!' : 'Send more review requests to lift your average rating.'}
          </p>
        </div>
        <div className="my-6 h-px bg-line" />

        <p className="text-center text-sm text-muted">
          {toNext === null ? `You're at ${avg.toFixed(1)} stars! 🎉` : `${toNext} more 5-star reviews to reach 4.9`}
        </p>

        <div className="mt-8 space-y-2.5">
          <a
            href={settings.business.mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-line bg-white text-sm font-medium hover:bg-canvas"
          >
            <ExternalLink className="size-4" /> View on Google Maps
          </a>
          <Button
            variant="outline"
            icon={Copy}
            className="w-full"
            onClick={async () => toast((await copyText(settings.business.reviewLink)) ? 'Review link copied' : 'Could not copy link', 'success')}
          >
            Copy Review Link
          </Button>
        </div>
      </Card>
    </div>
  )
}
