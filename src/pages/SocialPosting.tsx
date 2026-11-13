// src/pages/SocialPosting.tsx
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListPlus,
  MessageSquare,
  MessageSquareReply,
  Palette,
  PenLine,
  Plus,
  SquarePen,
  Trash2,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Badge, Button, Card, EmptyState, Input, Stars, Textarea, Toggle } from '../components/ui/primitives'
import { Modal } from '../components/ui/Modal'
import { FacebookMark, InstagramMark } from '../components/ui/BrandIcons'
import { useStore } from '../store/AppStore'
import { useToast } from '../components/ui/Toast'
import { cn, formatDate, uid } from '../lib/utils'
import type { CaptionSource, DayKey, PostTemplate, Review, Settings } from '../types'

type Social = Settings['social']

const DAYS: Array<{ key: DayKey; label: string }> = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
]

/** Curated backgrounds for review posts */
const PRESETS: Array<Omit<PostTemplate, 'id'>> = [
  { name: 'Sunset blur', kind: 'preset', textColor: '#1d2320', background: 'radial-gradient(circle at 20% 15%, #a7c4e0 0, transparent 45%), radial-gradient(circle at 80% 30%, #ffc36b 0, transparent 50%), radial-gradient(circle at 45% 70%, #ff7a45 0, transparent 55%), radial-gradient(circle at 60% 95%, #fff1e6 0, transparent 40%), #ffb07a' },
  { name: 'Clean white', kind: 'preset', textColor: '#1d2320', background: '#ffffff' },
  { name: 'Warm stone', kind: 'preset', textColor: '#1d2320', background: '#ddd8d2' },
  { name: 'Midnight', kind: 'preset', textColor: '#ffffff', background: 'linear-gradient(180deg, #0b2545 0%, #13315c 55%, #3e6a8a 100%)' },
  { name: 'Mint mist', kind: 'preset', textColor: '#1d2320', background: 'linear-gradient(160deg, #8ff0e0 0%, #d8f6f2 55%, #eef3ff 100%)' },
  { name: 'Ocean blue', kind: 'preset', textColor: '#ffffff', background: 'linear-gradient(135deg, #0a2fb8 0%, #0a63e0 55%, #1bb3f5 100%)' },
  { name: 'Mountain dusk', kind: 'preset', textColor: '#ffffff', background: 'linear-gradient(180deg, #ffc1b6 0%, #c98bd8 30%, #5a63c9 60%, #1b237a 100%)' },
  { name: 'Mint stripes', kind: 'preset', textColor: '#1d2320', background: 'repeating-linear-gradient(135deg, #b9eadc 0 6px, #ffffff 6px 14px)' },
  { name: 'Brand green', kind: 'preset', textColor: '#ffffff', background: 'linear-gradient(135deg, #10431f 0%, #17672e 55%, #2f8c4a 100%)' },
  { name: 'Charcoal', kind: 'preset', textColor: '#ffffff', background: 'linear-gradient(160deg, #1d2320 0%, #3a423e 100%)' },
  { name: 'Lavender', kind: 'preset', textColor: '#1d2320', background: 'linear-gradient(160deg, #e9ddff 0%, #f6efff 60%, #ffffff 100%)' },
  { name: 'Golden hour', kind: 'preset', textColor: '#1d2320', background: 'linear-gradient(160deg, #ffe08a 0%, #ffd0a1 50%, #ffb38a 100%)' },
]

const CAPTION_MODES: Array<{ value: CaptionSource; label: string; icon: LucideIcon; title: string; body: string }> = [
  { value: 'review', label: 'Review Comment', icon: MessageSquare, title: 'Review Comment Mode', body: 'Posts will use the original review comment text as the caption. Perfect for sharing authentic customer feedback.' },
  { value: 'reply', label: 'Review Reply', icon: MessageSquareReply, title: 'Review Reply Mode', body: "Posts will use your reply to the review as the caption, so followers see how you look after customers. Reviews without a reply use the review text." },
  { value: 'custom', label: 'Custom Caption', icon: PenLine, title: 'Custom Caption Mode', body: 'Write one caption for every post. Tags are filled in from each review.' },
]
const CAPTION_TAGS = ['{reviewer_name}', '{rating}', '{review_text}', '{business_name}']

function bgStyle(t: Pick<PostTemplate, 'kind' | 'background'>): CSSProperties {
  return t.kind === 'upload' ? { backgroundImage: `url("${t.background}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: t.background }
}

/** Square post preview: template background with the review on top */
function PostPreview({ template, review, business, className }: { template: Omit<PostTemplate, 'id'>; review?: Review; business: string; className?: string }) {
  const dark = template.textColor === '#ffffff'
  return (
    <div className={cn('relative flex aspect-square flex-col justify-center overflow-hidden rounded-xl p-[8%]', className)} style={bgStyle(template)}>
      {template.kind === 'upload' && <div className="absolute inset-0 bg-black/35" />}
      <div className="relative" style={{ color: template.kind === 'upload' ? '#ffffff' : template.textColor }}>
        <Stars rating={review?.rating ?? 5} size={14} color={dark || template.kind === 'upload' ? '#fde68a' : '#f5a623'} />
        <p className="mt-2 line-clamp-5 text-[11px] font-medium leading-snug">“{review?.text || 'Great service, very professional and friendly. Highly recommended!'}”</p>
        <p className="mt-2 text-[10px] font-semibold opacity-90">— {review?.author ?? 'Happy Customer'}</p>
        <p className="mt-3 text-[9px] font-semibold uppercase tracking-wider opacity-70">{business}</p>
      </div>
    </div>
  )
}

function SectionHeader({ icon: Icon, title, subtitle, action }: { icon: LucideIcon; title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-[17px] font-semibold">
          <Icon className="size-5" /> {title}
        </h2>
        <p className="mt-0.5 text-[15px] text-muted">{subtitle}</p>
      </div>
      {action}
    </div>
  )
}

/* ---------- Create Template view ---------- */
function CreateTemplate({ onBack, onSave, review, business }: { onBack: () => void; onSave: (t: PostTemplate) => void; review?: Review; business: string }) {
  const { uploadBusinessAsset } = useStore()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'select' | 'upload'>('select')
  const [picked, setPicked] = useState<number | null>(null)
  const [uploaded, setUploaded] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [name, setName] = useState('')

  const draft: Omit<PostTemplate, 'id'> | null =
    tab === 'select' && picked !== null
      ? PRESETS[picked]
      : tab === 'upload' && uploaded
        ? { name: 'Custom design', kind: 'upload', background: uploaded, textColor: '#ffffff' }
        : null

  const onFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast('Please choose an image', 'error')
    if (file.size > 5 * 1024 * 1024) return toast('Image must be under 5 MB', 'error')
    setUploading(true)
    try {
      setUploaded(await uploadBusinessAsset(file, 'post-template'))
    } catch {
      /* toast shown by store */
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card className="mx-auto max-w-[900px] p-6 sm:p-9">
      <button onClick={onBack} className="inline-flex items-center gap-2 text-[15px] text-ink/80 hover:text-ink">
        <ArrowLeft className="size-4" /> Back to Social Posting
      </button>
      <h1 className="mt-6 text-center text-[28px] font-semibold tracking-tight">Create Template</h1>
      <p className="mt-2 text-center text-[16px] text-muted">Choose from our templates or upload your own custom design</p>

      <div className="mt-8 flex rounded-lg bg-[#eef0ef] p-1">
        {([
          ['select', 'Select Template', Palette],
          ['upload', 'Upload Custom', Upload],
        ] as const).map(([v, label, Icon]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={cn('flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-[15px] font-medium', tab === v ? 'bg-white shadow-sm' : 'text-ink/80')}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'select' ? (
        <>
          <p className="mt-10 flex items-center justify-center gap-2 text-lg font-semibold">
            <Palette className="size-5 text-violet-500" /> Choose a Template
          </p>
          <p className="mt-1 text-center text-[15px] text-muted">Select from our curated collection of beautiful backgrounds</p>
          <div className="mt-6 grid max-h-[460px] grid-cols-2 gap-4 overflow-y-auto pr-1 sm:grid-cols-4">
            {PRESETS.map((p, i) => (
              <button
                key={p.name}
                onClick={() => setPicked(i)}
                className={cn('rounded-xl bg-white p-3 text-left shadow-sm ring-1 transition', picked === i ? 'ring-2 ring-brand-600' : 'ring-line hover:ring-brand-200')}
              >
                <span className="relative block aspect-square rounded-lg ring-1 ring-black/5" style={bgStyle(p)}>
                  {picked === i && (
                    <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-brand-700 text-white">
                      <Check className="size-3.5" />
                    </span>
                  )}
                </span>
                <span className="mt-2 block text-sm">{p.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div
          onClick={() => fileRef.current?.click()}
          className="mt-8 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-line px-6 py-12 text-center hover:border-brand-300 hover:bg-canvas"
        >
          {uploaded ? (
            <img src={uploaded} alt="Uploaded design" className="max-h-56 rounded-lg" />
          ) : (
            <>
              <span className="flex size-12 items-center justify-center rounded-full bg-brand-50">
                <Upload className="size-5 text-brand-700" />
              </span>
              <p className="mt-3 font-medium">{uploading ? 'Uploading…' : 'Upload your own background'}</p>
              <p className="mt-1 text-sm text-muted">Square image works best (1080×1080), up to 5 MB</p>
            </>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </div>
      )}

      {draft && (
        <div className="mt-8 grid items-center gap-6 border-t border-line pt-8 sm:grid-cols-[240px_1fr]">
          <PostPreview template={draft} review={review} business={business} />
          <div>
            <label htmlFor="tpl-name" className="mb-2 block text-[15px] font-medium">Template name</label>
            <Input id="tpl-name" placeholder={draft.name} value={name} onChange={(e) => setName(e.target.value)} />
            <Button
              className="mt-4 w-full sm:w-auto"
              icon={Check}
              onClick={() => onSave({ ...draft, id: uid('tpl'), name: name.trim() || draft.name })}
            >
              Save Template
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

/* ---------- Page ---------- */
export default function SocialPosting() {
  const { state, updateSettings, addSocialPost } = useStore()
  const toast = useToast()
  const social = state.settings.social
  const business = state.settings.ai.nickname || state.settings.business.name
  const [view, setView] = useState<'home' | 'create'>('home')
  const [connectOpen, setConnectOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [caption, setCaption] = useState(social.customCaption)
  const [page, setPage] = useState(0)

  const save = (patch: Partial<Social>) => updateSettings('social', patch)
  const connected = [
    social.facebookConnected && { key: 'facebookConnected' as const, name: 'Facebook Page', icon: FacebookMark },
    social.instagramConnected && { key: 'instagramConnected' as const, name: 'Instagram Business', icon: InstagramMark },
  ].filter(Boolean) as Array<{ key: 'facebookConnected' | 'instagramConnected'; name: string; icon: typeof FacebookMark }>

  // Upcoming = scheduled posts grouped by review (one card shows its Feed / Story formats)
  const upcoming = useMemo(() => {
    const groups = new Map<string, { review?: Review; formats: Set<string>; at: string }>()
    for (const p of state.socialPosts.filter((x) => x.status === 'scheduled')) {
      const g = groups.get(p.reviewId) ?? { review: state.reviews.find((r) => r.id === p.reviewId), formats: new Set<string>(), at: p.at }
      g.formats.add(p.format)
      groups.set(p.reviewId, g)
    }
    return [...groups.entries()].map(([id, g]) => ({ id, ...g }))
  }, [state.socialPosts, state.reviews])
  const current = upcoming[Math.min(page, Math.max(upcoming.length - 1, 0))]

  const queued = new Set(upcoming.map((u) => u.id))
  // Reviews with text make better posts, so they come first
  const queueable = state.reviews.filter((r) => r.rating >= 4 && !queued.has(r.id)).sort((a, b) => Number(!!b.text) - Number(!!a.text))

  const addToQueue = (review: Review) => {
    const formats: Array<'feed' | 'story'> = []
    const any = Object.values(social.schedule)
    if (any.some((d) => d.feed) || !any.some((d) => d.story)) formats.push('feed')
    if (any.some((d) => d.story)) formats.push('story')
    for (const format of formats) {
      for (const network of [social.facebookConnected && 'facebook', social.instagramConnected && 'instagram'].filter(Boolean) as Array<'facebook' | 'instagram'>) {
        addSocialPost({ reviewId: review.id, network, format, status: 'scheduled', at: new Date().toISOString() })
      }
      if (!social.facebookConnected && !social.instagramConnected) {
        addSocialPost({ reviewId: review.id, network: 'facebook', format, status: 'scheduled', at: new Date().toISOString() })
      }
    }
    toast(`${review.author}'s review added to the queue`)
  }

  const activeTemplate = social.templates.find((t) => t.id === social.activeTemplateId) ?? social.templates[0]
  const previewReview = state.reviews.find((r) => r.text && r.rating >= 4)

  if (view === 'create') {
    return (
      <CreateTemplate
        business={business}
        review={previewReview}
        onBack={() => setView('home')}
        onSave={(t) => {
          save({ templates: [...social.templates, t], activeTemplateId: social.activeTemplateId ?? t.id })
          toast('Template saved')
          setView('home')
        }}
      />
    )
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-8">
      {/* Social connections */}
      <Card className="p-5 sm:p-6">
        <SectionHeader
          icon={Users}
          title="Social Connections"
          subtitle="Manage your connected social media accounts"
          action={<Button icon={Plus} onClick={() => setConnectOpen(true)}>Connect Social Accounts</Button>}
        />
        {connected.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[17px] text-muted">No social accounts connected yet</p>
            <p className="mt-3 text-[15px] text-muted">Connect your social media accounts to start scheduling posts</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {connected.map(({ key, name, icon: Icon }) => (
              <div key={key} className="flex items-center gap-3 rounded-xl border border-line p-4">
                <Icon className="size-9" />
                <div className="flex-1">
                  <p className="font-medium">{name}</p>
                  <p className="text-sm text-brand-700">Connected</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { save({ [key]: false }); toast(`${name} disconnected`) }}>
                  Disconnect
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Caption */}
      <Card className="p-5 sm:p-6">
        <SectionHeader icon={MessageSquare} title="Post Caption Configuration" subtitle="Choose what caption to use for your social media posts" />
        <p className="mt-6 text-[16px] font-medium">Caption Source</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {CAPTION_MODES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => save({ captionSource: value })}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-md px-4 text-[15px] font-medium transition',
                social.captionSource === value ? 'bg-brand-700 text-white' : 'text-ink hover:bg-canvas',
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        {CAPTION_MODES.filter((c) => c.value === social.captionSource).map((c) => (
          <div key={c.value} className="mt-4 rounded-lg border border-line bg-canvas/70 p-4">
            <p className="flex items-center gap-2 text-[15px] font-medium">
              <c.icon className="size-4 text-brand-700" /> {c.title}
            </p>
            <p className="mt-1.5 text-[15px] text-muted">{c.body}</p>
            {c.value === 'custom' && (
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap gap-2">
                  {CAPTION_TAGS.map((t) => (
                    <button key={t} onClick={() => setCaption((v) => `${v} ${t}`.trim())} className="rounded-md bg-white px-2 py-1 font-mono text-xs text-brand-800 ring-1 ring-brand-100 hover:bg-brand-50">
                      {t}
                    </button>
                  ))}
                </div>
                <Textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} className="bg-white" />
                <Button className="mt-3" size="sm" disabled={caption === social.customCaption || !caption.trim()} onClick={() => { save({ customCaption: caption }); toast('Caption saved') }}>
                  Save Caption
                </Button>
              </div>
            )}
          </div>
        ))}
      </Card>

      {/* Schedule */}
      <Card className="p-5 sm:p-6">
        <SectionHeader
          icon={CalendarDays}
          title="Automated Posting Schedule"
          subtitle="Choose which days and post types for automated publishing"
          action={
            <label className="flex items-center gap-2 text-[15px]">
              <Toggle checked={social.autoPost} onChange={(v) => { save({ autoPost: v }); toast(v ? 'Auto posting enabled' : 'Auto posting paused') }} label="Auto Posting Enabled" />
              Auto Posting Enabled
            </label>
          }
        />
        <div className="mt-6 space-y-2">
          {DAYS.map(({ key, label }) => {
            const d = social.schedule[key]
            const set = (patch: Partial<typeof d>) => save({ schedule: { ...social.schedule, [key]: { ...d, ...patch } } })
            return (
              <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 rounded-lg bg-brand-50/80 px-3 py-2.5 sm:grid-cols-[1fr_200px_200px] sm:px-4">
                <span className="text-[16px] font-medium">{label}</span>
                <label className="flex items-center gap-2 text-[15px]">
                  <Toggle checked={d.story} onChange={(v) => set({ story: v })} label={`${label} story post`} /> <span className="hidden sm:inline">Story Post</span><span className="sm:hidden">Story</span>
                </label>
                <label className="flex items-center gap-2 text-[15px]">
                  <Toggle checked={d.feed} onChange={(v) => set({ feed: v })} label={`${label} feed post`} /> <span className="hidden sm:inline">Feed Post</span><span className="sm:hidden">Feed</span>
                </label>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Upcoming */}
      <Card className="p-5 sm:p-6">
        <SectionHeader
          icon={FileText}
          title="Upcoming Posts"
          subtitle="Reviews scheduled for social media posting"
          action={<Button variant="outline" icon={ListPlus} onClick={() => setQueueOpen(true)}>Review Queue</Button>}
        />
        {upcoming.length === 0 ? (
          <EmptyState icon={FileText} title="Nothing scheduled" body="Add reviews from the Review Queue, or turn on auto posting to schedule new 4–5 star reviews." />
        ) : (
          <>
            <div className="mt-6 flex items-center justify-between text-[15px] text-muted">
              <span>{Math.min(page, upcoming.length - 1) + 1} of {upcoming.length}</span>
              <span className="flex gap-1">
                <button className="rounded-md p-1.5 hover:bg-canvas disabled:opacity-30" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous">
                  <ChevronLeft className="size-4" />
                </button>
                <button className="rounded-md p-1.5 hover:bg-canvas disabled:opacity-30" disabled={page >= upcoming.length - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next">
                  <ChevronRight className="size-4" />
                </button>
              </span>
            </div>
            {current && (
              <div className="mt-4 rounded-xl border border-line bg-brand-50/30 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[17px] font-semibold">{current.review?.author ?? 'Review'}</p>
                  <div className="flex gap-1.5">
                    {current.formats.has('feed') && <Badge tone="blue">Feed</Badge>}
                    {current.formats.has('story') && <Badge className="bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200">Story</Badge>}
                  </div>
                </div>
                <p className="mt-4 rounded-lg bg-white/80 p-4 text-[15px] leading-relaxed text-ink/90">
                  “{current.review?.text || `${current.review?.rating ?? 5}-star review`}”
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
                  <span className="flex items-center gap-1.5 text-brand-700"><span className="size-2 rounded-full bg-brand-600" /> Queued</span>
                  <span>{current.review ? formatDate(current.review.createdAt) : ''}</span>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Templates */}
      <Card className="p-5 sm:p-6">
        <SectionHeader
          icon={SquarePen}
          title="Post Templates"
          subtitle="Pre-designed templates to speed up your content creation"
          action={<Button icon={Plus} onClick={() => setView('create')}>Create Template</Button>}
        />
        {social.templates.length === 0 ? (
          <EmptyState icon={SquarePen} title="No templates yet" body="Create your first template to get started with faster content creation" />
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {social.templates.map((t) => {
              const active = activeTemplate?.id === t.id
              return (
                <div key={t.id} className={cn('rounded-xl p-2.5 ring-1', active ? 'ring-2 ring-brand-600' : 'ring-line')}>
                  <PostPreview template={t} review={previewReview} business={business} />
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{t.name}</span>
                    <button
                      onClick={() => {
                        const rest = social.templates.filter((x) => x.id !== t.id)
                        save({ templates: rest, activeTemplateId: active ? (rest[0]?.id ?? null) : social.activeTemplateId })
                      }}
                      className="rounded p-1 text-muted hover:bg-canvas hover:text-red-600"
                      aria-label={`Delete ${t.name}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  {active ? (
                    <Badge className="mt-1.5">In use</Badge>
                  ) : (
                    <button onClick={() => save({ activeTemplateId: t.id })} className="mt-1.5 text-xs font-medium text-brand-700 hover:underline">
                      Use for posts
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Connect modal */}
      <Modal open={connectOpen} onClose={() => setConnectOpen(false)} title="Connect Social Accounts">
        <div className="space-y-3">
          {([
            ['facebookConnected', 'Facebook Page', FacebookMark],
            ['instagramConnected', 'Instagram Business', InstagramMark],
          ] as const).map(([key, name, Icon]) => (
            <div key={key} className="flex items-center gap-3 rounded-xl border border-line p-4">
              <Icon className="size-9" />
              <span className="flex-1 font-medium">{name}</span>
              <Button
                size="sm"
                variant={social[key] ? 'outline' : 'primary'}
                onClick={() => { save({ [key]: !social[key] }); toast(social[key] ? `${name} disconnected` : `${name} connected`) }}
              >
                {social[key] ? 'Disconnect' : 'Connect'}
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted">Publishing to Facebook and Instagram goes live once the Meta app is approved for posting.</p>
        </div>
      </Modal>

      {/* Review queue modal */}
      <Modal open={queueOpen} onClose={() => setQueueOpen(false)} title="Review Queue" size="lg">
        {queueable.length === 0 ? (
          <EmptyState icon={ListPlus} title="All caught up" body="Every 4–5 star review is already scheduled." />
        ) : (
          <ul className="space-y-3">
            {queueable.map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-xl border border-line p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.author}</span>
                    <Stars rating={r.rating} size={13} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{r.text || 'Rating only, no text'}</p>
                </div>
                <Button size="sm" icon={Plus} onClick={() => addToQueue(r)}>Add</Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  )
}
