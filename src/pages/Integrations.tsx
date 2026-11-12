// src/pages/Integrations.tsx
import { useState, type ReactNode } from 'react'
import { Copy, Eye, EyeOff, KeyRound, Mail, MessageCircle, Smartphone, Webhook, Zap } from 'lucide-react'
import { Badge, Button, Card, Input, PageHeader } from '../components/ui/primitives'
import { FacebookMark, GoogleG, InstagramMark } from '../components/ui/BrandIcons'
import { useStore } from '../store/AppStore'
import { useToast } from '../components/ui/Toast'
import { contactsWebhookUrl } from '../lib/supabase'
import { copyText } from '../lib/utils'
import type { IntegrationStatus } from '../types'

function Letter({ text, bg }: { text: string; bg: string }) {
  return <span className="flex size-10 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: bg }}>{text}</span>
}
function IconTile({ children, bg = 'bg-brand-50' }: { children: ReactNode; bg?: string }) {
  return <span className={`flex size-10 items-center justify-center rounded-lg ${bg}`}>{children}</span>
}

const groups: Array<{ title: string; items: Array<{ id: string; name: string; desc: string; icon: ReactNode }> }> = [
  {
    title: 'Reviews',
    items: [{ id: 'google', name: 'Google Business Profile', desc: 'Sync reviews, post replies and read insights', icon: <IconTile bg="bg-canvas"><GoogleG className="size-5" /></IconTile> }],
  },
  {
    title: 'Messaging',
    items: [
      { id: 'whatsapp', name: 'WhatsApp Business', desc: 'Send review requests on WhatsApp (Meta Cloud API)', icon: <IconTile bg="bg-[#25D366]"><MessageCircle className="size-5 text-white" /></IconTile> },
      { id: 'email', name: 'Email', desc: 'Send requests from your own domain', icon: <IconTile><Mail className="size-5 text-brand-700" /></IconTile> },
      { id: 'sms', name: 'SMS (DLT)', desc: 'TRAI DLT-registered SMS via MSG91', icon: <IconTile><Smartphone className="size-5 text-brand-700" /></IconTile> },
    ],
  },
  {
    title: 'CRM & Automation',
    items: [
      { id: 'zapier', name: 'Zapier', desc: 'Add contacts from 6,000+ apps', icon: <Letter text="Z" bg="#ff4f00" /> },
      { id: 'pabbly', name: 'Pabbly Connect', desc: 'Automate contact sync from your tools', icon: <Letter text="P" bg="#1d4ed8" /> },
      { id: 'webhooks', name: 'Webhooks', desc: 'Push contacts in from any system', icon: <IconTile><Webhook className="size-5 text-brand-700" /></IconTile> },
      { id: 'jobber', name: 'Jobber', desc: 'Send a request when a job is completed', icon: <Letter text="J" bg="#0b3d2e" /> },
      { id: 'housecall', name: 'Housecall Pro', desc: 'Send a request when a job is completed', icon: <Letter text="H" bg="#0b6cff" /> },
    ],
  },
  {
    title: 'Payments',
    items: [
      { id: 'quickbooks', name: 'QuickBooks Online', desc: 'Send a request when an invoice is paid', icon: <Letter text="QB" bg="#2ca01c" /> },
      { id: 'square', name: 'Square', desc: 'Send a request after a payment', icon: <Letter text="■" bg="#111" /> },
    ],
  },
  {
    title: 'Social',
    items: [
      { id: 'facebook', name: 'Facebook', desc: 'Post your best reviews to your Page', icon: <FacebookMark className="size-10" /> },
      { id: 'instagram', name: 'Instagram', desc: 'Share reviews as posts and stories', icon: <InstagramMark className="size-10" /> },
    ],
  },
]

const statusBadge: Record<IntegrationStatus, ReactNode> = {
  connected: <Badge tone="green">Connected</Badge>,
  available: <Badge tone="gray">Not connected</Badge>,
  coming_soon: <Badge tone="blue">Coming soon</Badge>,
}

export default function Integrations() {
  const { state, updateSettings, apiKeyPrefix, regenerateApiKey } = useStore()
  const toast = useToast()
  const [newKey, setNewKey] = useState('')
  const [showKey, setShowKey] = useState(true)
  const [generating, setGenerating] = useState(false)
  const status = state.settings.integrations
  const webhookUrl = contactsWebhookUrl

  const toggle = (id: string, name: string) => {
    const s = status[id]
    if (s === 'coming_soon') return
    updateSettings('integrations', { [id]: s === 'connected' ? 'available' : 'connected' })
    toast(s === 'connected' ? `${name} disconnected` : `${name} connected`)
  }

  const copy = async (text: string, what: string) => toast((await copyText(text)) ? `${what} copied` : 'Could not copy', 'success')

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Integrations" subtitle="Connect your tools so review requests go out automatically" />

      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">{g.title}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((it) => {
                const s = status[it.id] ?? 'available'
                return (
                  <Card key={it.id} className="flex flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      {it.icon}
                      {statusBadge[s]}
                    </div>
                    <p className="mt-4 text-[16px] font-semibold">{it.name}</p>
                    <p className="mt-1 flex-1 text-sm text-muted">{it.desc}</p>
                    <Button
                      className="mt-4 w-full"
                      size="sm"
                      variant={s === 'connected' ? 'outline' : 'primary'}
                      disabled={s === 'coming_soon'}
                      onClick={() => toggle(it.id, it.name)}
                    >
                      {s === 'connected' ? 'Disconnect' : s === 'coming_soon' ? 'Coming soon' : 'Connect'}
                    </Button>
                  </Card>
                )
              })}
            </div>
          </section>
        ))}

        <Card className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50"><Zap className="size-5 text-brand-700" /></span>
            <div>
              <p className="text-[17px] font-semibold">API & Webhooks</p>
              <p className="text-[15px] text-muted">Send a POST with first_name, last_name, email and phone to add a contact and trigger a review request.</p>
            </div>
          </div>
          <div className="mt-5 space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">Incoming webhook URL</p>
              <div className="flex gap-2">
                <Input readOnly value={webhookUrl} className="font-mono text-sm" />
                <Button variant="outline" icon={Copy} onClick={() => copy(webhookUrl, 'Webhook URL')} aria-label="Copy webhook URL" />
              </div>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><KeyRound className="size-4" /> API key</p>
              {newKey ? (
                <>
                  <div className="flex gap-2">
                    <Input readOnly value={showKey ? newKey : '•'.repeat(newKey.length)} className="font-mono text-sm" />
                    <Button variant="outline" icon={showKey ? EyeOff : Eye} onClick={() => setShowKey((v) => !v)} aria-label={showKey ? 'Hide key' : 'Show key'} />
                    <Button variant="outline" icon={Copy} onClick={() => copy(newKey, 'API key')} aria-label="Copy API key" />
                  </div>
                  <p className="mt-2 text-xs text-amber-700">Copy this key now — it won't be shown again. Send it in the <code>x-api-key</code> header.</p>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm text-muted">{apiKeyPrefix ? `${apiKeyPrefix}…` : 'No key yet'}</span>
                  <Button
                    size="sm"
                    variant={apiKeyPrefix ? 'outline' : 'primary'}
                    disabled={generating}
                    onClick={async () => {
                      if (apiKeyPrefix && !window.confirm('Create a new key? The old key stops working immediately.')) return
                      setGenerating(true)
                      try {
                        setNewKey(await regenerateApiKey())
                        setShowKey(true)
                      } catch {
                        /* error toast shown by the store */
                      } finally {
                        setGenerating(false)
                      }
                    }}
                  >
                    {generating ? 'Creating…' : apiKeyPrefix ? 'Create new key' : 'Create API key'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
