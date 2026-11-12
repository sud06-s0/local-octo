// src/pages/SocialPosting.tsx
import { useMemo, useState } from 'react'
import { CalendarClock, CircleCheck, Share2, Sparkles } from 'lucide-react'
import { Badge, Button, Card, Checkbox, EmptyState, PageHeader, Stars, Toggle } from '../components/ui/primitives'
import { FacebookMark, GoogleG, InstagramMark } from '../components/ui/BrandIcons'
import { useStore } from '../store/AppStore'
import { useToast } from '../components/ui/Toast'
import { cn, timeAgo } from '../lib/utils'
import type { Review, Settings } from '../types'

type Template = Settings['social']['template']

function PostPreview({ review, template, business, format }: { review: Review; template: Template; business: string; format: 'feed' | 'story' }) {
  const styles: Record<Template, { wrap: string; text: string; sub: string; star: string }> = {
    green: { wrap: 'bg-gradient-to-br from-brand-700 to-brand-500', text: 'text-white', sub: 'text-white/80', star: '#fde68a' },
    white: { wrap: 'bg-white border border-line', text: 'text-ink', sub: 'text-muted', star: '#fbbf24' },
    quote: { wrap: 'bg-brand-50', text: 'text-brand-900', sub: 'text-brand-700', star: '#17672e' },
  }
  const s = styles[template]
  return (
    <div className={cn('mx-auto flex flex-col justify-between overflow-hidden rounded-2xl p-6 shadow-md', s.wrap, format === 'feed' ? 'aspect-square w-full max-w-[340px]' : 'aspect-[9/16] w-full max-w-[220px]')}>
      <div className="flex items-center justify-between">
        <span className={cn('text-xs font-semibold uppercase tracking-wider', s.sub)}>Customer review</span>
        <span className="rounded-full bg-white p-1"><GoogleG className="size-4" /></span>
      </div>
      <div>
        {template === 'quote' && <span className="block font-serif text-6xl leading-none text-brand-300">“</span>}
        <Stars rating={review.rating} size={format === 'feed' ? 22 : 18} color={s.star} />
        <p className={cn('mt-3 font-medium leading-snug', s.text, format === 'feed' ? 'line-clamp-5 text-[16px]' : 'line-clamp-[8] text-[14px]')}>
          {review.text || 'Rated 5 stars on Google'}
        </p>
        <p className={cn('mt-3 text-sm font-semibold', s.text)}>— {review.author}</p>
      </div>
      <p className={cn('text-sm font-semibold', s.sub)}>{business}</p>
    </div>
  )
}

export default function SocialPosting() {
  const { state, updateSettings, addSocialPost } = useStore()
  const toast = useToast()
  const social = state.settings.social
  const business = state.settings.ai.nickname || state.settings.business.name
  const eligible = useMemo(() => state.reviews.filter((r) => r.rating >= social.minRating), [state.reviews, social.minRating])
  const [previewId, setPreviewId] = useState(eligible.find((r) => r.text)?.id ?? eligible[0]?.id)
  const [format, setFormat] = useState<'feed' | 'story'>('feed')
  const previewReview = state.reviews.find((r) => r.id === previewId) ?? eligible[0]

  const networks = [
    { key: 'facebookConnected' as const, name: 'Facebook Page', icon: FacebookMark, connected: social.facebookConnected, account: 'Local Octo' },
    { key: 'instagramConnected' as const, name: 'Instagram Business', icon: InstagramMark, connected: social.instagramConnected, account: '@localocto' },
  ]

  const postNow = () => {
    if (!previewReview) return
    const targets = networks.filter((n) => n.connected)
    if (!targets.length) return toast('Connect Facebook or Instagram first', 'error')
    targets.forEach((n) =>
      addSocialPost({
        reviewId: previewReview.id,
        network: n.key === 'facebookConnected' ? 'facebook' : 'instagram',
        format,
        status: 'scheduled',
        at: new Date().toISOString(),
      }),
    )
    toast(`Post scheduled to ${targets.map((t) => t.name.split(' ')[0]).join(' & ')}`)
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Social Posting" subtitle="Turn your best reviews into branded Facebook and Instagram posts automatically" />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Connected Accounts</h2>
            <div className="mt-4 space-y-3">
              {networks.map(({ key, name, icon: Icon, connected, account }) => (
                <div key={key} className="flex items-center gap-3 rounded-xl border border-line p-4">
                  <Icon className="size-9" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{name}</p>
                    <p className="truncate text-sm text-muted">{connected ? `Connected as ${account}` : 'Not connected'}</p>
                  </div>
                  <Button
                    variant={connected ? 'outline' : 'primary'}
                    size="sm"
                    onClick={() => {
                      updateSettings('social', { [key]: !connected })
                      toast(connected ? `${name} disconnected` : `${name} connected`)
                    }}
                  >
                    {connected ? 'Disconnect' : 'Connect'}
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50"><Sparkles className="size-5 text-brand-700" /></span>
              <div className="flex-1">
                <p className="text-[17px] font-semibold">Auto-post new reviews</p>
                <p className="text-[15px] text-muted">New reviews are turned into branded posts and published for you</p>
              </div>
              <Toggle checked={social.autoPost} onChange={(v) => updateSettings('social', { autoPost: v })} label="Auto-post reviews" />
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">Formats</p>
                <div className="flex flex-col gap-2.5">
                  <Checkbox checked={social.feed} onChange={(v) => updateSettings('social', { feed: v })} label="Feed post" />
                  <Checkbox checked={social.story} onChange={(v) => updateSettings('social', { story: v })} label="Story" />
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">Which reviews</p>
                <select
                  value={social.minRating}
                  onChange={(e) => updateSettings('social', { minRating: Number(e.target.value) as 4 | 5 })}
                  className="h-10 w-full rounded-lg border border-line bg-white px-3 text-[15px] outline-none"
                >
                  <option value={5}>5-star reviews only</option>
                  <option value={4}>4 and 5-star reviews</option>
                </select>
              </div>
            </div>

            <p className="mb-2 mt-6 text-sm font-medium uppercase tracking-wide text-muted">Template</p>
            <div className="grid grid-cols-3 gap-3">
              {(['green', 'white', 'quote'] as Template[]).map((t) => (
                <button
                  key={t}
                  onClick={() => updateSettings('social', { template: t })}
                  className={cn('rounded-xl border-2 p-2 text-sm font-medium capitalize transition', social.template === t ? 'border-brand-700' : 'border-line hover:border-brand-200')}
                >
                  <span className={cn('mb-2 block aspect-square rounded-lg', t === 'green' && 'bg-gradient-to-br from-brand-700 to-brand-500', t === 'white' && 'border border-line bg-white', t === 'quote' && 'bg-brand-50')} />
                  {t === 'quote' ? 'Quote' : t === 'green' ? 'Brand green' : 'Clean white'}
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* Preview */}
        <Card className="h-fit p-5 sm:p-6 lg:sticky lg:top-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Preview</h2>
            <div className="flex rounded-lg bg-[#eef0ef] p-1">
              {(['feed', 'story'] as const).map((f) => (
                <button key={f} onClick={() => setFormat(f)} className={cn('rounded-md px-3 py-1 text-sm capitalize', format === f ? 'bg-white font-medium shadow-sm' : 'text-ink/80')}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          {previewReview ? (
            <>
              <div className="mt-5">
                <PostPreview review={previewReview} template={social.template} business={business} format={format} />
              </div>
              <label className="mt-5 block text-sm font-medium text-muted" htmlFor="pick">Review to feature</label>
              <select
                id="pick"
                value={previewReview.id}
                onChange={(e) => setPreviewId(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-[15px] outline-none"
              >
                {eligible.map((r) => (
                  <option key={r.id} value={r.id}>{r.author} · {r.rating}★</option>
                ))}
              </select>
              <Button className="mt-4 w-full" icon={Share2} onClick={postNow}>Post Now</Button>
            </>
          ) : (
            <EmptyState icon={Share2} title="No eligible reviews yet" body="Reviews that match your rating rule will show here." />
          )}
        </Card>
      </div>

      {/* History */}
      <Card className="mt-6">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <h2 className="text-lg font-semibold">Recent Posts</h2>
        </div>
        {state.socialPosts.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No posts yet" body="Posts created from your reviews will appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {state.socialPosts.slice(0, 10).map((p) => {
              const r = state.reviews.find((x) => x.id === p.reviewId)
              return (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                  {p.network === 'facebook' ? <FacebookMark className="size-7" /> : <InstagramMark className="size-7" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">{r ? `${r.author}'s ${r.rating}-star review` : 'Review post'}</p>
                    <p className="text-sm capitalize text-muted">{p.format} · {timeAgo(p.at)}</p>
                  </div>
                  <Badge tone={p.status === 'posted' ? 'green' : p.status === 'failed' ? 'red' : 'amber'}>
                    {p.status === 'posted' && <CircleCheck className="size-3.5" />} {p.status}
                  </Badge>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
