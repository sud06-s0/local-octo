// src/pages/Messaging.tsx
import { forwardRef, useRef, useState } from 'react'
import { Bell, CircleCheck, Clock, Calendar, ImagePlus, MessageSquare, Sparkles, TrendingUp, Trash2, CircleStop } from 'lucide-react'
import { Badge, Button, Card, Input, Label, PageHeader, Segmented, Textarea, Toggle } from '../components/ui/primitives'
import { IncomingBubble, OutgoingBubble, PhoneMockup } from '../components/ui/PhoneMockup'
import { Modal } from '../components/ui/Modal'
import { useStore } from '../store/AppStore'
import { useToast } from '../components/ui/Toast'
import { brand } from '../config/brand'
import { fillTemplate, initials, isEmail, isPhone } from '../lib/utils'

const SAMPLE = 'Jessica'
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
          {t.required && <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Required</span>}
        </button>
      ))}
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

export default function Messaging() {
  const { state, mode, updateSettings, sendTest, uploadMessageImage } = useStore()
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
  const customRef = useRef<HTMLTextAreaElement>(null)

  const vars = { first_name: SAMPLE, business_name: m.businessName, owner_name: m.ownerFirstName }
  const initialText =
    m.mode === 'smart'
      ? `Hey ${SAMPLE}, we hope you enjoyed your experience with ${m.businessName}! Would you mind taking a moment to leave a review? Here's the link: {review_link}`
      : fillTemplate(m.customMessage, vars)
  const followText =
    m.mode === 'smart'
      ? `Hey ${SAMPLE}, just wanted to quickly follow up. We'd really appreciate your feedback! {review_link}`
      : fillTemplate(m.customFollowUp, vars)

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
          <PhoneMockup>
            {m.personalizedImage && (
              <div className="ml-auto w-[86%] overflow-hidden rounded-2xl">
                <div className="relative aspect-[4/3] bg-gradient-to-br from-brand-500 to-brand-800">
                  {m.imageDataUrl ? (
                    <img src={m.imageDataUrl} alt="Personalized" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-start justify-center pt-5 text-white/90">
                      <span className="flex size-16 items-center justify-center rounded-full bg-white/15 text-xl font-semibold">{initials(m.ownerFirstName || 'LO')}</span>
                    </div>
                  )}
                  <span className="absolute bottom-2.5 left-1/2 -translate-x-1/2 rounded-md bg-white px-2.5 py-0.5 text-lg font-bold text-ink shadow">{SAMPLE}!</span>
                </div>
              </div>
            )}
            <OutgoingBubble time="9:41 AM">
              <Rendered text={initialText} />
            </OutgoingBubble>
          </PhoneMockup>
          <div className="mt-5 text-center">
            <Button onClick={() => setTestOpen(true)}>Send Test Message</Button>
          </div>
        </div>

        {/* Settings */}
        <div className="space-y-6">
          <Card className="border-brand-200 bg-brand-50/60 p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white">
                {m.mode === 'smart' ? <Sparkles className="size-5 text-brand-700" /> : <MessageSquare className="size-5 text-brand-700" />}
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

          <Card className="p-5 sm:p-6">
            {m.mode === 'smart' ? (
              <>
                <h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5 text-brand-700" /> Smart Messaging</h2>
                <p className="mt-1 text-[15px] text-muted">AI-optimized messages that continuously improve your response rates</p>
                <div className="mt-5 rounded-xl border border-line bg-canvas p-5">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-100/70">
                      <TrendingUp className="size-5 text-brand-700" />
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
                <p className="mt-0.5 text-[15px] text-muted">Write your own message template</p>
                <TokenChips onInsert={insertToken} />
                <CounterTextarea ref={customRef} value={custom} onChange={setCustom} rows={5} />
                {!custom.includes('{review_link}') && <p className="mt-1.5 text-xs text-red-600">Add the Review Link so customers can leave a review</p>}
                <Button
                  className="mt-4 w-full"
                  disabled={!custom.trim() || !custom.includes('{review_link}') || custom === m.customMessage}
                  onClick={() => {
                    updateSettings('messaging', { customMessage: custom })
                    toast('Custom message saved')
                  }}
                >
                  Save Message
                </Button>
              </>
            )}

            <div className="mt-6 space-y-4">
              <div>
                <Label htmlFor="owner">Owner First Name</Label>
                <Input id="owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="biz">Business Name</Label>
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
          </Card>
        </div>
      </div>

      {/* Follow-ups */}
      <div className="my-12 h-px bg-line" />
      <h2 className="text-xl font-semibold">Follow-up Messages</h2>
      <p className="mt-1 text-[16px] text-muted">Increase your review rate with automated follow-ups</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
        <PhoneMockup>
          <OutgoingBubble time="2:30 PM">
            <Rendered text={followText} />
          </OutgoingBubble>
          <IncomingBubble time="2:45 PM">Just left a review! Thanks for your help!</IncomingBubble>
        </PhoneMockup>

        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                <TrendingUp className="size-5 text-brand-700" />
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
              <p className="mt-1 pl-7 text-[15px] text-brand-700">We'll send gentle reminders to customers who haven't left a review yet.</p>
            </div>
            {m.mode === 'custom' && m.followUpsEnabled && (
              <div className="mt-6 border-t border-line pt-5">
                <p className="text-[16px] font-semibold">Custom Follow-up Message</p>
                <p className="mt-0.5 text-[15px] text-muted">Sent if the customer hasn't clicked your review link</p>
                <TokenChips onInsert={(t) => setCustomFollow((v) => (v + ' ' + t).slice(0, MAX_CHARS))} />
                <CounterTextarea value={customFollow} onChange={setCustomFollow} rows={4} />
                <Button
                  className="mt-4 w-full"
                  disabled={!customFollow.trim() || !customFollow.includes('{review_link}') || customFollow === m.customFollowUp}
                  onClick={() => {
                    updateSettings('messaging', { customFollowUp: customFollow })
                    toast('Follow-up message saved')
                  }}
                >
                  Save Follow-up
                </Button>
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
          We'll send the current message so you can see exactly what customers receive. WhatsApp and SMS use your approved templates; the custom text applies to email.
        </p>
      </Modal>
    </div>
  )
}
