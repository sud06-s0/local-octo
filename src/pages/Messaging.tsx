// src/pages/Messaging.tsx
import { forwardRef, useEffect, useRef, useState } from 'react'
import { Bell, CircleCheck, Clock, Calendar, ImagePlus, Mail, MessageCircle, MessageSquare, RefreshCw, Smartphone, Sparkles, TrendingUp, Trash2, CircleStop } from 'lucide-react'
import { Badge, Button, Card, Input, Label, PageHeader, Segmented, Textarea, Toggle } from '../components/ui/primitives'
import { IncomingBubble, OutgoingBubble, PhoneMockup } from '../components/ui/PhoneMockup'
import { Modal } from '../components/ui/Modal'
import { useStore } from '../store/AppStore'
import { useAuth } from '../store/AuthProvider'
import { useToast } from '../components/ui/Toast'
import { brand } from '../config/brand'
import { cn, fillTemplate, isEmail, isPhone, timeAgo, toTemplateName } from '../lib/utils'
import type { WaStandardTemplate, WaTemplate, WaTemplateKind, WaTemplateStatus } from '../types'

const SAMPLE = 'Jessica'
/** Demo photo shown in the preview until a business uploads its own (public/default-personal.png) */
const DEFAULT_IMAGE = `${import.meta.env.BASE_URL}default-personal.png`
const MAX_CHARS = 400
const TOKENS: Array<{ label: string; token: string; required?: boolean }> = [
  { label: 'First Name', token: '{first_name}' },
  { label: 'Review Link', token: '{review_link}', required: true },
  { label: 'Owner Name', token: '{owner_name}' },
  { label: 'Business Name', token: '{business_name}' },
]

function TokenChips({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {TOKENS.map((t) => (
        <button
          key={t.token}
          type="button"
          onClick={() => onInsert(t.token)}
          className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-1.5 text-[15px] text-ink hover:border-brand-300 hover:bg-brand-50/50"
        >
          {t.label}
          {t.required && <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800">Required</span>}
        </button>
      ))}
    </div>
  )
}

const KIND_LABEL: Record<WaTemplateKind, string> = {
  initial: 'First message',
  initial_image: 'First message with photo',
  followup: 'Follow-up',
  followup_image: 'Follow-up with photo',
}

/** Exact text for the standard templates (Meta rejects bodies that end with a variable, hence "Thank you!") */
const STANDARD_BODY: Record<WaTemplateKind, string> = {
  initial: 'Hi {{1}}, thanks for choosing {{2}}! Would you mind taking a moment to leave us a Google review? {{3}} Thank you!',
  initial_image: 'Hi {{1}}, thanks for choosing {{2}}! Would you mind taking a moment to leave us a Google review? {{3}} Thank you!',
  followup: 'Hi {{1}}, just a quick reminder from {{2}} — your feedback means a lot to us! {{3}} Thank you!',
  followup_image: 'Hi {{1}}, just a quick reminder from {{2}} — your feedback means a lot to us! {{3}} Thank you!',
}

/** Photo with the sample customer's name, as customers receive it */
function PreviewImage({ src, name }: { src: string; name: string }) {
  return (
    <div className="ml-auto w-[86%] overflow-hidden rounded-2xl">
      <div className="relative aspect-[4/3] bg-brand-600">
        <img src={src} alt="Personalized" className="size-full object-cover" />
        <span className="absolute bottom-2.5 left-1/2 -translate-x-1/2 rounded-md bg-white px-2.5 py-0.5 text-lg font-bold text-ink shadow">{name}!</span>
      </div>
    </div>
  )
}

/** The 4 standard templates: submitted to Meta from here, with their approval status. */
function StandardTemplates({ canSubmit }: { canSubmit: boolean }) {
  const { mode, checkStandardTemplates, submitStandardTemplates } = useStore()
  const [list, setList] = useState<WaStandardTemplate[] | null>(null)
  const [busy, setBusy] = useState<'' | 'check' | 'submit'>('')
  const [error, setError] = useState('')

  const run = async (what: 'check' | 'submit') => {
    setBusy(what)
    setError('')
    try {
      setList(await (what === 'submit' ? submitStandardTemplates() : checkStandardTemplates()))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach WhatsApp')
    } finally {
      setBusy('')
    }
  }
  const check = () => run('check')
  const missing = canSubmit && list?.some((t) => t.status === 'not_created' || t.status === 'failed')
  // Clients only see what's approved
  const shown = canSubmit ? list : list?.filter((t) => t.status === 'approved')

  useEffect(() => {
    check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-[17px] font-semibold">
            <MessageCircle className="size-5 text-brand-800" /> WhatsApp templates
          </p>
          <p className="mt-0.5 text-sm text-muted">
            {canSubmit
              ? 'Standard messages, sent to WhatsApp for approval. Used with Standard Templates, and until a custom template is approved.'
              : 'Approved WhatsApp messages used for your review requests.'}
          </p>
        </div>
        {canSubmit && (
        <div className="flex gap-2">
          {missing && (
            <Button size="sm" disabled={!!busy} onClick={() => run('submit')}>
              {busy === 'submit' ? 'Submitting…' : 'Submit to WhatsApp'}
            </Button>
          )}
          <Button size="sm" variant="outline" icon={RefreshCw} disabled={!!busy} onClick={check}>
            {busy === 'check' ? 'Checking…' : 'Check WhatsApp'}
          </Button>
        </div>
        )}
      </div>
      {error && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>}
      {shown && !shown.length && !canSubmit && <p className="mt-3 text-sm text-muted">No approved WhatsApp messages yet. Your agency handles approvals.</p>}
      {shown && (
        <ul className="mt-4 space-y-2.5">
          {shown.map((t) => (
            <li key={t.kind} className="rounded-lg p-3 ring-1 ring-line">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {KIND_LABEL[t.kind]} <span className="font-mono text-xs text-muted">· {t.name}</span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <CategoryBadge category={t.category} />
                  <Badge tone={STATUS_STYLE[t.status].tone}>{STATUS_STYLE[t.status].label}</Badge>
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                {t.kind.endsWith('_image') && <span className="font-medium text-ink/70">[Photo] </span>}
                {STANDARD_BODY[t.kind]}
              </p>
              {t.reason && <p className="mt-1.5 text-xs text-red-600">{t.reason}</p>}
            </li>
          ))}
        </ul>
      )}
      {mode === 'demo' && <p className="mt-3 text-xs text-muted">Demo data. Connect WhatsApp to see the real status.</p>}
    </Card>
  )
}
/** Marketing / Utility label, as Meta categorised the template (affects the price per message). */
function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null
  const c = category.toLowerCase()
  return (
    <Badge tone={c === 'utility' ? 'green' : 'gray'}>
      {c === 'utility' ? 'Utility' : c === 'authentication' ? 'Authentication' : 'Marketing'}
    </Badge>
  )
}

const STATUS_STYLE: Record<WaTemplateStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  not_created: { label: 'Not submitted yet', tone: 'gray' },
  pending: { label: 'Waiting for WhatsApp approval', tone: 'amber' },
  approved: { label: 'Approved · ready to send', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  failed: { label: 'Not submitted', tone: 'red' },
  paused: { label: 'Paused by WhatsApp', tone: 'amber' },
  disabled: { label: 'Disabled by WhatsApp', tone: 'red' },
}

/** Latest WhatsApp template per kind, with approval status. */
function WhatsAppApproval({
  kinds,
  templates,
  onRefresh,
  busy,
}: {
  kinds: WaTemplateKind[]
  templates: WaTemplate[]
  onRefresh: () => void
  busy: boolean
}) {
  const latest = kinds.map((k) => ({ kind: k, t: templates.find((x) => x.kind === k) }))
  const anyOpen = latest.some((l) => l.t)
  const anyBad = latest.some((l) => l.t && ['rejected', 'failed', 'disabled'].includes(l.t.status))
  return (
    <div className="mt-5 rounded-xl border border-line bg-canvas/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[15px] font-semibold">
          <MessageCircle className="size-4 text-brand-800" /> WhatsApp approval
        </p>
        <div className="flex gap-2">
          {anyOpen && (
            <Button size="sm" variant="outline" icon={RefreshCw} disabled={busy} onClick={onRefresh}>
              Check WhatsApp
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">
        WhatsApp only sends messages Meta has approved. Until yours is approved, customers get the standard message.
        {anyBad && <span className="mt-1 block text-red-600">To submit again, change the template name above and save. WhatsApp doesn't reuse a name.</span>}
      </p>
      <ul className="mt-3 space-y-2.5">
        {latest.map(({ kind, t }) => (
          <li key={kind} className="rounded-lg bg-white p-3 ring-1 ring-line">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{KIND_LABEL[kind]}</span>
              {t ? (
                <span className="flex flex-wrap gap-1.5">
                  <CategoryBadge category={t.category} />
                  <Badge tone={STATUS_STYLE[t.status].tone}>{STATUS_STYLE[t.status].label}</Badge>
                </span>
              ) : (
                <Badge tone="gray">Not submitted yet</Badge>
              )}
            </div>
            {t && (
              <>
                <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-muted">{t.body}</p>
                {t.reason && <p className={cn('mt-1.5 text-xs', t.status === 'approved' ? 'text-muted' : 'text-red-600')}>{t.reason}</p>}
                <p className="mt-1 text-[11px] text-muted">
                  Submitted {timeAgo(t.createdAt)} · {t.name}
                </p>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

const cleanName = (v: string) => v.replace(/^_+|_+$/g, '')

/** Name the business gives its WhatsApp template (shown in WhatsApp Manager). */
function TemplateNameField({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const n = cleanName(value)
  return (
    <div className="mt-4">
      <Label htmlFor={id}>Template name</Label>
      <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(toTemplateName(e.target.value))} />
      <p className="mt-1 text-xs text-muted">
        Lowercase letters, numbers and _ only.{n && <> The photo version is named <span className="font-mono">{n}_photo</span>.</>}
      </p>
    </div>
  )
}

const CounterTextarea = forwardRef<HTMLTextAreaElement, { value: string; onChange: (v: string) => void; rows: number }>(function CounterTextarea(
  { value, onChange, rows },
  ref,
) {
  return (
    <div className="relative mt-4">
      <Textarea ref={ref} rows={rows} maxLength={MAX_CHARS} value={value} onChange={(e) => onChange(e.target.value)} className="pb-8" />
      <span className="pointer-events-none absolute bottom-2.5 right-3 text-xs text-muted">{MAX_CHARS - value.length} characters remaining</span>
    </div>
  )
})

function ReviewLinkText() {
  return <span className="underline decoration-white/60 underline-offset-2">[Review Link]</span>
}

/** Renders a template with the review-link token shown as a link label. */
function Rendered({ text }: { text: string }) {
  const parts = text.split('{review_link}')
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <ReviewLinkText />}
        </span>
      ))}
    </>
  )
}

type Channel = 'whatsapp' | 'sms' | 'email'

/** Message preview for the selected channel. SMS and Email show a demo until their APIs are connected. */
function ChannelPreview({
  channel,
  image,
  name,
  businessName,
  text,
  time,
  reply,
}: {
  channel: Channel
  image: string | null
  name: string
  businessName: string
  text: string
  time: string
  reply?: string
}) {
  return (
    <>
      {channel !== 'whatsapp' && (
        <p className="mx-auto mb-4 max-w-[360px] rounded-lg bg-brand-50 px-3 py-2 text-center text-xs text-brand-800 ring-1 ring-brand-200">
          {channel === 'sms' ? 'SMS' : 'Email'} API not connected · demo preview
        </p>
      )}
      {channel === 'email' ? (
        <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-line">
          <div className="border-b border-line px-4 py-3">
            <p className="text-xs text-muted"><span className="font-medium text-ink">{businessName}</span> · to customer</p>
            <p className="mt-0.5 text-sm font-semibold">How was your visit to {businessName}?</p>
          </div>
          {image && <div className="px-4 pt-4"><PreviewImage src={image} name={name} /></div>}
          <div className="px-4 py-4 text-sm leading-relaxed"><Rendered text={text} /></div>
          <div className="px-4 pb-5">
            <span className="block rounded-lg bg-brand-700 py-2.5 text-center text-sm font-semibold text-white">Leave a review</span>
          </div>
        </div>
      ) : (
        <PhoneMockup>
          {channel === 'whatsapp' && image && <PreviewImage src={image} name={name} />}
          <OutgoingBubble time={time}>
            <Rendered text={text} />
          </OutgoingBubble>
          {reply && <IncomingBubble time="2:45 PM">{reply}</IncomingBubble>}
        </PhoneMockup>
      )}
    </>
  )
}

export default function Messaging() {
  const { state, mode, updateSettings, sendTest, uploadMessageImage, waTemplates, submitWhatsAppTemplates, refreshWhatsAppTemplates } = useStore()
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const toast = useToast()
  const m = state.settings.messaging
  const fileRef = useRef<HTMLInputElement>(null)
  const [owner, setOwner] = useState(m.ownerFirstName)
  const [biz, setBiz] = useState(m.businessName)
  const [custom, setCustom] = useState(m.customMessage)
  const [customFollow, setCustomFollow] = useState(m.customFollowUp)
  const [testOpen, setTestOpen] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  // WhatsApp custom templates (agency): own text + template names, submitted to Meta for approval
  const [waMsg, setWaMsg] = useState(m.waMessage)
  const [waFollow, setWaFollow] = useState(m.waFollowUp)
  const [waName, setWaName] = useState(m.waTemplateName ?? '')
  const [waFollowName, setWaFollowName] = useState(m.waFollowUpTemplateName ?? '')
  const [waBusy, setWaBusy] = useState(false)

  /** Saves first (the Edge Function reads the saved text), then submits to WhatsApp. */
  const saveAndSubmit = async (patch: Partial<typeof m>, kinds: Array<'initial' | 'followup'>, savedMsg: string) => {
    setWaBusy(true)
    try {
      await updateSettings('messaging', patch)
      const warnings = await submitWhatsAppTemplates(kinds)
      toast(`${savedMsg}: sent to WhatsApp for approval`)
      warnings.forEach((w) => toast(w, 'error'))
    } catch (e) {
      toast(`${savedMsg}. WhatsApp: ${e instanceof Error ? e.message : 'submission failed'}`, 'error')
    } finally {
      setWaBusy(false)
    }
  }

  const refreshWa = async () => {
    setWaBusy(true)
    try {
      const warnings = await refreshWhatsAppTemplates()
      warnings.forEach((w) => toast(w, 'error'))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not check status', 'error')
    } finally {
      setWaBusy(false)
    }
  }

  const customRef = useRef<HTMLTextAreaElement>(null)
  const waRef = useRef<HTMLTextAreaElement>(null)

  // Preview shows the Owner First Name once it's filled in, so the owner sees the message as a customer would
  const sample = (m.ownerFirstName ?? '').trim() || SAMPLE
  const vars = { first_name: sample, business_name: m.businessName, owner_name: m.ownerFirstName }
  // WhatsApp: standard templates or the agency's custom template; SMS / email: smart or custom message
  const smartFirst = `Hey ${sample}, we hope you enjoyed your experience with ${m.businessName}! Would you mind taking a moment to leave a review? Here's the link: {review_link}`
  const smartFollow = `Hey ${sample}, just wanted to quickly follow up. We'd really appreciate your feedback! {review_link}`
  const { isAgency } = useAuth()
  const waCustom = channel === 'whatsapp' && m.waMode === 'custom'
  const useCustom = channel !== 'whatsapp' && m.mode === 'custom'
  const initialText = waCustom ? fillTemplate(m.waMessage, vars) : useCustom ? fillTemplate(m.customMessage, vars) : smartFirst
  const followText = waCustom ? fillTemplate(m.waFollowUp, vars) : useCustom ? fillTemplate(m.customFollowUp, vars) : smartFollow

  const onImage = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast('Please choose an image file', 'error')
    if (file.size > 2 * 1024 * 1024) return toast('Image must be under 2 MB', 'error')
    setUploading(true)
    try {
      await uploadMessageImage(file)
      toast('Image uploaded')
    } catch {
      /* error toast shown by the store */
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const insertToken = (token: string) => {
    const el = customRef.current
    if (!el) return setCustom((c) => c + token)
    const start = el.selectionStart
    const next = (custom.slice(0, start) + token + custom.slice(el.selectionEnd)).slice(0, MAX_CHARS)
    setCustom(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Messaging" subtitle="Configure how review requests are sent to your customers" />

      <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
        {/* Phone preview */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          {/* The business's own photo, or the built-in demo photo until they upload one */}
          <ChannelPreview
            channel={channel}
            image={m.personalizedImage ? m.imageDataUrl || DEFAULT_IMAGE : null}
            name={sample}
            businessName={m.businessName || state.settings.business.name}
            text={initialText}
            time="9:41 AM"
          />
          <div className="mt-5 text-center">
            <Button onClick={() => setTestOpen(true)}>Send Test Message</Button>
          </div>
        </div>

        {/* Settings */}
        <div className="space-y-6">
          <Segmented
            className="w-full sm:w-full sm:[&>button]:flex-1"
            value={channel}
            onChange={setChannel}
            options={[
              { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
              { value: 'sms', label: 'SMS', icon: Smartphone },
              { value: 'email', label: 'Email', icon: Mail },
            ]}
          />
          {channel === 'whatsapp' ? (
          <Card className="border-brand-200 bg-brand-50/60 p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white">
                <MessageCircle className="size-5 text-brand-800" />
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">WhatsApp</p>
                  <Badge className="bg-brand-700 text-white ring-brand-700"><CircleCheck className="size-3.5" /> Enabled</Badge>
                </div>
                <p className="mt-1 text-[17px] font-semibold">{m.waMode === 'custom' ? 'Custom template is enabled' : 'Standard templates are enabled'}</p>
                <p className="mt-1 text-[15px] text-muted">
                  Only templates WhatsApp has approved are sent.{m.waMode === 'custom' ? ' Until the custom template is approved, the standard one goes out.' : ''}
                </p>
              </div>
            </div>
          </Card>
          ) : (
          <>
          <Card className="border-brand-200 bg-brand-50/60 p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white">
                {m.mode === 'smart' ? <Sparkles className="size-5 text-brand-800" /> : <MessageSquare className="size-5 text-brand-800" />}
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Current Sending Mode</p>
                  <Badge className="bg-brand-700 text-white ring-brand-700"><CircleCheck className="size-3.5" /> Enabled</Badge>
                </div>
                <p className="mt-1 text-[17px] font-semibold">{m.mode === 'smart' ? 'Smart messaging is enabled' : 'Custom message is enabled'}</p>
                <p className="mt-1 text-[15px] text-muted">
                  {m.mode === 'smart'
                    ? `Review requests will use optimized ${brand.appName} message templates.`
                    : 'Review requests will use the message you wrote below.'}
                </p>
              </div>
            </div>
          </Card>

          <Segmented
            className="w-full sm:w-full sm:[&>button]:flex-1"
            value={m.mode}
            onChange={(v) => {
              updateSettings('messaging', { mode: v })
              toast(v === 'smart' ? 'Smart messaging enabled' : 'Custom message enabled')
            }}
            options={[
              { value: 'smart', label: 'Smart Message', icon: Sparkles },
              { value: 'custom', label: 'Custom Message', icon: MessageSquare },
            ]}
          />
          </>
          )}

          {/* Standard / Custom switch: agency only (clients use the templates the agency set) */}
          {channel === 'whatsapp' && isAgency && (
            <Segmented
              className="w-full sm:w-full sm:[&>button]:flex-1"
              value={m.waMode}
              onChange={(v) => {
                updateSettings('messaging', { waMode: v })
                toast(v === 'custom' ? 'WhatsApp custom template enabled' : 'WhatsApp standard templates enabled')
              }}
              options={[
                { value: 'standard', label: 'Standard Templates', icon: Sparkles },
                { value: 'custom', label: 'Custom Template', icon: MessageSquare },
              ]}
            />
          )}

          <Card className="p-5 sm:p-6">
            {channel === 'whatsapp' ? (
              isAgency && m.waMode === 'custom' ? (
                <div className="mb-6 border-b border-line pb-6">
                  <h2 className="text-lg font-semibold">Custom WhatsApp Template</h2>
                  <p className="mt-0.5 text-[15px] text-muted">{'Write the template and send it to WhatsApp for approval'}</p>
                  <>
                      <TemplateNameField id="wa-name" value={waName} onChange={setWaName} placeholder="e.g. review_request_localocto" />
                      <TokenChips onInsert={(t) => setWaMsg((v) => (v + ' ' + t).slice(0, MAX_CHARS))} />
                      <CounterTextarea ref={waRef} value={waMsg} onChange={setWaMsg} rows={5} />
                      {!waMsg.includes('{review_link}') && <p className="mt-1.5 text-xs text-red-600">Add the Review Link so customers can leave a review</p>}
                      <Button
                        className="mt-4 w-full"
                        disabled={
                          !waMsg.trim() || !waMsg.includes('{review_link}') || !cleanName(waName) ||
                          (waMsg === m.waMessage && cleanName(waName) === (m.waTemplateName ?? '')) || waBusy
                        }
                        onClick={() => {
                          setWaName(cleanName(waName))
                          saveAndSubmit({ waMessage: waMsg, waTemplateName: cleanName(waName) }, ['initial'], 'Template saved')
                        }}
                      >
                        {waBusy ? 'Submitting…' : 'Save & Submit for Approval'}
                      </Button>
                      <WhatsAppApproval kinds={['initial', 'initial_image']} templates={waTemplates} busy={waBusy} onRefresh={refreshWa} />
                    </>
                </div>
              ) : null
            ) : m.mode === 'smart' ? (
              <>
                <h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5 text-brand-800" /> Smart Messaging</h2>
                <p className="mt-1 text-[15px] text-muted">AI-optimized messages that continuously improve your response rates</p>
                <div className="mt-5 rounded-xl border border-line bg-canvas p-5">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-100/70">
                      <TrendingUp className="size-5 text-brand-800" />
                    </span>
                    <div>
                      <p className="text-[16px] font-semibold">Highest Converting Messages</p>
                      <p className="mt-1 text-[15px] text-muted">We test different message variations across thousands of review requests to find what works best.</p>
                    </div>
                  </div>
                  <ul className="mt-4 space-y-2.5 text-[15px] text-ink/85">
                    {['Multiple message styles tested automatically', 'Learns which tone resonates with your customers', 'Continuously optimized for higher click rates'].map((t) => (
                      <li key={t} className="flex items-center gap-2"><CircleCheck className="size-4 text-brand-600" /> {t}</li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold">Custom Message</h2>
                <p className="mt-0.5 text-[15px] text-muted">{'Write your own message for SMS and email'}</p>
                <>
                    <TokenChips onInsert={insertToken} />
                    <CounterTextarea ref={customRef} value={custom} onChange={setCustom} rows={5} />
                    {!custom.includes('{review_link}') && <p className="mt-1.5 text-xs text-red-600">Add the Review Link so customers can leave a review</p>}
                    <Button
                      className="mt-4 w-full"
                      disabled={!custom.trim() || !custom.includes('{review_link}') || custom === m.customMessage}
                      onClick={async () => {
                        await updateSettings('messaging', { customMessage: custom })
                        toast('Custom message saved')
                      }}
                    >
                      Save Message
                    </Button>
                  </>
              </>
            )}

            <div className={cn('space-y-4', channel !== 'whatsapp' && 'mt-6')}>
              <div>
                <Label htmlFor="owner">Customer First Name <span className="font-mono text-brand-800">{"{{1}}"}</span></Label>
                <Input id="owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="biz">Business Name <span className="font-mono text-brand-800">{"{{2}}"}</span></Label>
                <Input id="biz" value={biz} onChange={(e) => setBiz(e.target.value)} />
              </div>
              <Button
                variant="soft"
                className="w-full"
                disabled={!owner.trim() || !biz.trim() || (owner === m.ownerFirstName && biz === m.businessName)}
                onClick={() => {
                  updateSettings('messaging', { ownerFirstName: owner.trim(), businessName: biz.trim() })
                  toast('Message details updated')
                }}
              >
                Update
              </Button>
            </div>

            <div className="mt-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-[15px] font-medium">Personalized Image</p>
                <p className="text-sm text-muted">Add a custom image to your messages</p>
                <p className="mt-0.5 text-xs text-muted">Sent above the message on WhatsApp and email, with each customer's name on it</p>
              </div>
              <Toggle checked={m.personalizedImage} onChange={(v) => updateSettings('messaging', { personalizedImage: v })} label="Personalized image" />
            </div>
            {m.personalizedImage && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="outline" icon={ImagePlus} disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? 'Uploading…' : m.imageDataUrl ? 'Replace Image' : 'Upload Image'}
                </Button>
                {m.imageDataUrl && (
                  <Button variant="ghost" icon={Trash2} onClick={() => updateSettings('messaging', { imageDataUrl: null })}>
                    Remove
                  </Button>
                )}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onImage(e.target.files[0])} />
              </div>
            )}

            {channel === 'whatsapp' && (
              <div className="mt-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[15px] font-medium">Sir / Ma'am after first name</p>
                  <p className="text-sm text-muted">"Adarsh Sir", "Varsha Ma'am" in WhatsApp messages and on the image</p>
                  <p className="mt-0.5 text-xs text-muted">Uses each contact's gender; contacts without a gender get just their first name</p>
                </div>
                <Toggle checked={m.useTitle !== false} onChange={(v) => updateSettings('messaging', { useTitle: v })} label="Sir / Ma'am after first name" />
              </div>
            )}
          </Card>

          {channel === 'whatsapp' && <StandardTemplates canSubmit />}
        </div>
      </div>

      {/* Follow-ups */}
      <div className="my-12 h-px bg-line" />
      <h2 className="text-xl font-semibold">Follow-up Messages</h2>
      <p className="mt-1 text-[16px] text-muted">Increase your review rate with automated follow-ups</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
        {/* Phone preview: sticky and its own height, so a tall settings column can't stretch it */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          {/* Follow-ups are text only */}
          <ChannelPreview
            channel={channel}
            image={null}
            name={sample}
            businessName={m.businessName || state.settings.business.name}
            text={followText}
            time="2:30 PM"
            reply="Just left a review! Thanks for your help!"
          />
        </div>

        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                <TrendingUp className="size-5 text-brand-800" />
              </span>
              <div className="flex-1">
                <p className="text-[17px] font-semibold">Enable Follow-ups</p>
                <p className="text-[15px] text-muted">Automatically remind customers to leave a review</p>
              </div>
              <Toggle
                checked={m.followUpsEnabled}
                onChange={(v) => {
                  updateSettings('messaging', { followUpsEnabled: v })
                  toast(v ? 'Follow-ups enabled' : 'Follow-ups disabled')
                }}
                label="Enable follow-ups"
              />
            </div>
            <div className="mt-5 rounded-xl border border-brand-200 bg-brand-50/70 p-4">
              <p className="flex items-center gap-2 text-[15px] font-medium text-brand-800">
                <CircleCheck className="size-5" /> 42% of reviews come from follow-up messages
              </p>
              <p className="mt-1 pl-7 text-[15px] text-brand-800">We'll send gentle reminders to customers who haven't left a review yet.</p>
            </div>
            {channel === 'whatsapp' && isAgency && m.waMode === 'custom' && m.followUpsEnabled && (
              <div className="mt-6 border-t border-line pt-5">
                <p className="text-[16px] font-semibold">Custom WhatsApp Follow-up Template</p>
                <p className="mt-0.5 text-[15px] text-muted">Text only. Sent if the customer hasn't clicked your review link</p>
                <>
                    <TemplateNameField id="wa-follow-name" value={waFollowName} onChange={setWaFollowName} placeholder="e.g. review_followup_localocto" />
                    <TokenChips onInsert={(t) => setWaFollow((v) => (v + ' ' + t).slice(0, MAX_CHARS))} />
                    <CounterTextarea value={waFollow} onChange={setWaFollow} rows={4} />
                    <Button
                      className="mt-4 w-full"
                      disabled={
                        !waFollow.trim() || !waFollow.includes('{review_link}') || !cleanName(waFollowName) ||
                        (waFollow === m.waFollowUp && cleanName(waFollowName) === (m.waFollowUpTemplateName ?? '')) || waBusy
                      }
                      onClick={() => {
                        setWaFollowName(cleanName(waFollowName))
                        saveAndSubmit({ waFollowUp: waFollow, waFollowUpTemplateName: cleanName(waFollowName) }, ['followup'], 'Follow-up template saved')
                      }}
                    >
                      {waBusy ? 'Submitting…' : 'Save & Submit for Approval'}
                    </Button>
                    <WhatsAppApproval kinds={['followup']} templates={waTemplates} busy={waBusy} onRefresh={refreshWa} />
                  </>
              </div>
            )}
            {channel !== 'whatsapp' && m.mode === 'custom' && m.followUpsEnabled && (
              <div className="mt-6 border-t border-line pt-5">
                <p className="text-[16px] font-semibold">Custom Follow-up Message</p>
                <p className="mt-0.5 text-[15px] text-muted">Sent if the customer hasn't clicked your review link</p>
                <>
                    <TokenChips onInsert={(t) => setCustomFollow((v) => (v + ' ' + t).slice(0, MAX_CHARS))} />
                    <CounterTextarea value={customFollow} onChange={setCustomFollow} rows={4} />
                    <Button
                      className="mt-4 w-full"
                      disabled={!customFollow.trim() || !customFollow.includes('{review_link}') || customFollow === m.customFollowUp}
                      onClick={async () => {
                        await updateSettings('messaging', { customFollowUp: customFollow })
                        toast('Follow-up message saved')
                      }}
                    >
                      Save Follow-up
                    </Button>
                  </>
              </div>
            )}
          </Card>

          <Card className="p-5 sm:p-6">
            <p className="text-[17px] font-semibold">How Follow-ups Work</p>
            <ul className="mt-5 space-y-5">
              {[
                { icon: Clock, t: 'Automatic Timing', d: `First follow-up sent ${brand.followUpGapDays} days after the initial message` },
                { icon: Bell, t: 'Up to 3 Reminders', d: 'Gentle nudges spread out over time for best results' },
                { icon: CircleStop, t: 'Smart Stop', d: 'Stops immediately when customer clicks or responds' },
                { icon: Calendar, t: 'Business Hours Only', d: 'Messages sent during appropriate times for your customers' },
              ].map(({ icon: Icon, t, d }) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-canvas">
                    <Icon className="size-4 text-muted" />
                  </span>
                  <span>
                    <span className="block text-[15px] font-medium">{t}</span>
                    <span className="block text-[15px] text-muted">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Modal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        title="Send Test Message"
        footer={
          <>
            <Button variant="outline" onClick={() => setTestOpen(false)}>Cancel</Button>
            <Button
              disabled={!(isEmail(testTo) || isPhone(testTo)) || sending}
              onClick={async () => {
                setSending(true)
                try {
                  const channel = await sendTest(testTo.trim())
                  toast(mode === 'live' ? `Test sent to ${testTo} by ${channel}` : `Test message queued to ${testTo}`)
                  setTestOpen(false)
                  setTestTo('')
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Could not send test', 'error')
                } finally {
                  setSending(false)
                }
              }}
            >
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </>
        }
      >
        <Label htmlFor="test-to">Phone number or email</Label>
        <Input id="test-to" placeholder="+91 98xxxxxxx or you@business.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        <p className="mt-2 text-sm text-muted">
          We'll send the current message so you can see exactly what customers receive. On WhatsApp, a Custom Message is used once Meta approves it; until then the standard message is sent.
        </p>
      </Modal>
    </div>
  )
}
