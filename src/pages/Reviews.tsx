// src/pages/Reviews.tsx
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { GoogleG } from '../components/ui/BrandIcons'
import { ChevronLeft, ChevronRight, Globe, Link2, MessageSquare, Pencil, RefreshCw, Search, Send, Share2, Sparkles, Star, Trash2 } from 'lucide-react'
import { Avatar, Badge, Button, Card, EmptyState, Input, Label, Stars, Textarea, Toggle } from '../components/ui/primitives'
import { useStore } from '../store/AppStore'
import { useToast } from '../components/ui/Toast'
import { brand } from '../config/brand'
import { cn, timeAgo } from '../lib/utils'
import type { Review } from '../types'

type ReplyFilter = 'all' | 'needs' | 'replied'
type Sort = 'newest' | 'oldest' | 'highest' | 'lowest'
const PAGE_SIZE = 10

function ReviewCard({ review }: { review: Review }) {
  const { mode, setReviewReply, addSocialPost, draftReply } = useStore()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [text, setText] = useState(review.reply?.text ?? '')
  const reply = review.reply

  const post = (t: string) => {
    if (!t.trim()) return
    setReviewReply(review.id, { text: t.trim(), source: 'app', at: new Date().toISOString() })
    setEditing(false)
    // Posting to Google needs the Google Business Profile API (pending approval) — until then the reply is saved here.
    toast(mode === 'live' ? 'Reply saved — it goes live on Google once Google Business Profile is connected' : 'Reply posted to Google')
  }

  const startDraft = async () => {
    setDrafting(true)
    try {
      const t = await draftReply(review)
      setReviewReply(review.id, { text: t, source: 'draft', at: new Date().toISOString() })
      setText(t)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not draft a reply', 'error')
    } finally {
      setDrafting(false)
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <Avatar name={review.author} color={review.avatarColor} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold">{review.author}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <Stars rating={review.rating} size={15} />
            <span className="text-sm text-muted">{timeAgo(review.createdAt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={review.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-sm hover:bg-canvas"
          >
            <Link2 className="size-4" /> <span className="hidden sm:inline">Link</span>
          </a>
          {review.rating === 5 && review.text && (
            <Button
              variant="ghost"
              size="sm"
              icon={Share2}
              onClick={() => {
                addSocialPost({ reviewId: review.id, network: 'facebook', format: 'feed', status: 'scheduled', at: new Date().toISOString() })
                toast('Added to your social posting queue')
              }}
            >
              <span className="hidden sm:inline">Share</span>
            </Button>
          )}
        </div>
      </div>

      {review.text && <p className="mt-4 text-[16px] leading-relaxed text-ink/90">{review.text}</p>}

      {/* Reply states */}
      {!reply && !editing && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="soft" size="sm" icon={Sparkles} onClick={startDraft} disabled={drafting}>{drafting ? 'Drafting…' : 'Draft with AI'}</Button>
          <Button variant="outline" size="sm" icon={MessageSquare} onClick={() => { setText(''); setEditing(true) }}>Write reply</Button>
        </div>
      )}

      {(editing || reply?.source === 'draft') && (
        <div className={cn('mt-4 rounded-xl border p-4', reply?.source === 'draft' && !editing ? 'border-brand-200 bg-brand-50/50' : 'border-line')}>
          {reply?.source === 'draft' && !editing && (
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-brand-700">
              <Sparkles className="size-3.5" /> AI draft · waiting for your approval
            </p>
          )}
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply…" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" icon={Send} disabled={!text.trim()} onClick={() => post(text)}>
              {reply?.source === 'draft' ? 'Approve & Post' : 'Post Reply'}
            </Button>
            {reply?.source === 'draft' && (
              <Button variant="outline" size="sm" icon={RefreshCw} onClick={startDraft} disabled={drafting}>{drafting ? 'Drafting…' : 'Regenerate'}</Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (reply?.source === 'draft') setReviewReply(review.id, undefined)
                setEditing(false)
                setText(reply?.source === 'app' ? reply.text : '')
              }}
            >
              {reply?.source === 'draft' ? 'Discard' : 'Cancel'}
            </Button>
          </div>
        </div>
      )}

      {reply && reply.source !== 'draft' && !editing && (
        <>
          <div className="mt-4 rounded-lg border border-line bg-canvas/70 p-4">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span className="font-semibold text-ink">Live on Google</span>
              <span className="inline-flex items-center gap-1">
                <Globe className="size-3.5" /> {reply.source === 'google' ? 'Not sent from here' : `Sent from ${brand.appName}`}
              </span>
              <span>· {timeAgo(reply.at)}</span>
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-ink/90">{reply.text}</p>
          </div>
          {reply.source === 'google' ? (
            <p className="mt-3 text-xs text-muted">Because this reply wasn't sent from here, it can only be changed in Google.</p>
          ) : (
            <div className="mt-3 flex gap-2">
              <Button variant="ghost" size="sm" icon={Pencil} onClick={() => { setText(reply.text); setEditing(true) }}>Edit</Button>
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                onClick={() => {
                  setReviewReply(review.id, undefined)
                  toast('Reply removed from Google')
                }}
              >
                Delete
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

export default function Reviews() {
  const { state, updateSettings, importFromGoogle } = useStore()
  const toast = useToast()
  const [syncing, setSyncing] = useState(false)
  const biz = state.settings.business
  const syncGoogle = async () => {
    setSyncing(true)
    try {
      const r = await importFromGoogle(biz.placeId)
      toast(r.added ? `${r.added} new review${r.added > 1 ? 's' : ''} from Google` : 'Up to date with Google')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Google sync failed', 'error')
    } finally {
      setSyncing(false)
    }
  }
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all')
  const [rating, setRating] = useState<number | null>(null)
  const [nickname, setNickname] = useState(state.settings.ai.nickname)
  const page = Math.max(0, Number(params.get('page') ?? 0))
  const sort = (params.get('sort') as Sort) || 'newest'

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    next.set(k, v)
    if (k !== 'page') next.set('page', '0')
    setParams(next, { replace: true })
  }

  const isReplied = (r: Review) => !!r.reply && r.reply.source !== 'draft'
  const counts = {
    needs: state.reviews.filter((r) => !isReplied(r)).length,
    replied: state.reviews.filter(isReplied).length,
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = state.reviews.filter((r) => {
      if (q && !(r.author.toLowerCase().includes(q) || r.text.toLowerCase().includes(q))) return false
      if (replyFilter === 'needs' && isReplied(r)) return false
      if (replyFilter === 'replied' && !isReplied(r)) return false
      if (rating && r.rating !== rating) return false
      return true
    })
    const by: Record<Sort, (a: Review, b: Review) => number> = {
      newest: (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      oldest: (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
      highest: (a, b) => b.rating - a.rating,
      lowest: (a, b) => a.rating - b.rating,
    }
    return list.sort(by[sort] ?? by.newest)
  }, [state.reviews, query, replyFilter, rating, sort])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const visible = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Reviews</h1>
          <p className="mt-1 text-[16px] text-muted">What Google actually shows, and where every reply stands.</p>
        </div>
        {biz.placeId && (
          <div className="flex items-center gap-3">
            {biz.googleSyncedAt && <span className="text-xs text-muted">Synced {timeAgo(biz.googleSyncedAt)}</span>}
            <Button variant="outline" icon={RefreshCw} disabled={syncing} onClick={syncGoogle}>
              {syncing ? 'Syncing…' : 'Sync from Google'}
            </Button>
          </div>
        )}
      </div>
      {!biz.placeId && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white p-4">
          <GoogleG className="size-6" />
          <p className="flex-1 text-[15px] text-ink/85">Link your Google Business Profile to import your rating and latest reviews.</p>
          <Link to="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
            Link on Dashboard →
          </Link>
        </div>
      )}

      {/* AI settings */}
      <Card className="mt-6 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50">
            <Sparkles className="size-5 text-brand-700" />
          </span>
          <div>
            <p className="text-[17px] font-semibold">AI Response Settings</p>
            <p className="text-[15px] text-muted">Configure how AI responds to your reviews</p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="text-[15px] font-medium">Auto-post AI replies to 4–5 star reviews</p>
            <p className="text-xs text-muted">Off, AI replies are still drafted — they just wait below for your approval.</p>
          </div>
          <Toggle
            checked={state.settings.ai.autoPostPositive}
            onChange={(v) => {
              updateSettings('ai', { autoPostPositive: v })
              toast(v ? 'AI replies will auto-post to 4–5 star reviews' : 'AI replies will wait for your approval')
            }}
            label="Auto-post AI replies"
          />
        </div>
        <div className="mt-5">
          <Label htmlFor="nickname">Business nickname</Label>
          <p className="-mt-1.5 mb-2 text-xs text-muted">The name AI uses when referencing your business in replies</p>
          <Input
            id="nickname"
            placeholder="e.g. Joe's Pizza"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onBlur={() => {
              if (nickname !== state.settings.ai.nickname) {
                updateSettings('ai', { nickname: nickname.trim() })
                toast('Business nickname saved')
              }
            }}
          />
        </div>
      </Card>

      {/* Filters */}
      <div className="relative mt-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setParam('page', '0') }}
          placeholder="Search reviews by text or reviewer name..."
          className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-[15px] outline-none focus:border-brand-500 focus:ring-3 focus:ring-brand-100"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {([
          ['all', 'All', null],
          ['needs', 'Needs reply', counts.needs],
          ['replied', 'Replied', counts.replied],
        ] as Array<[ReplyFilter, string, number | null]>).map(([v, label, n]) => (
          <button
            key={v}
            onClick={() => { setReplyFilter(v); setParam('page', '0') }}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[15px] transition',
              replyFilter === v ? 'bg-brand-50 font-medium text-ink ring-1 ring-brand-100' : 'text-ink/80 hover:bg-white',
            )}
          >
            {label}
            {n !== null && <span className="rounded bg-black/5 px-1.5 text-xs">{n}</span>}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => setParam('sort', e.target.value)}
          className="ml-auto h-9 rounded-lg border border-line bg-white px-2 text-sm outline-none"
          aria-label="Sort reviews"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="highest">Highest rating</option>
          <option value="lowest">Lowest rating</option>
        </select>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-[#eef0ef] p-1 scrollbar-none">
          <button
            onClick={() => setRating(null)}
            className={cn('whitespace-nowrap rounded-md px-3 py-1.5 text-[15px]', rating === null ? 'bg-white font-medium shadow-sm' : 'text-ink/80')}
          >
            All ratings
          </button>
          {[5, 4, 3, 2, 1].map((r) => (
            <button
              key={r}
              onClick={() => setRating(r)}
              className={cn('flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm', rating === r ? 'bg-white font-medium shadow-sm' : 'text-ink/80')}
            >
              <Star className="size-4 text-star" fill="currentColor" strokeWidth={0} /> {r} Star{r > 1 ? 's' : ''}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">
          Showing <b className="text-ink">{filtered.length ? current * PAGE_SIZE + 1 : 0}-{current * PAGE_SIZE + visible.length}</b> of <b className="text-ink">{filtered.length}</b>
        </p>
      </div>

      <div className="mt-6 space-y-4">
        {visible.length === 0 ? (
          <Card>
            <EmptyState icon={Star} title="No reviews found" body="Try a different rating, filter or search." />
          </Card>
        ) : (
          visible.map((r) => <ReviewCard key={r.id + (r.reply?.at ?? '')} review={r} />)
        )}
      </div>

      {pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" icon={ChevronLeft} disabled={current === 0} onClick={() => setParam('page', String(current - 1))}>Prev</Button>
          <Badge tone="gray">Page {current + 1} of {pages}</Badge>
          <Button variant="outline" size="sm" disabled={current >= pages - 1} onClick={() => setParam('page', String(current + 1))}>
            Next <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
