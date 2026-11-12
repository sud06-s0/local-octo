// src/pages/Websites.tsx
import { useState } from 'react'
import { ArrowDown, Calendar, CircleCheck, ExternalLink, Play, Star } from 'lucide-react'
import { Badge, Button, Card, Input, Label, UnderlineHeading } from '../components/ui/primitives'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { portfolio, websitePlans } from '../data/mockData'
import { brand } from '../config/brand'
import { cn, isPhone } from '../lib/utils'

/** CSS-only mini website thumbnail so the portfolio grid works without screenshots. */
function SiteThumb({ name, headline, accent }: { name: string; headline: string; accent: string }) {
  return (
    <div className="aspect-[16/10] overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="size-3 rounded-sm" style={{ background: accent }} />
        <span className="text-[9px] font-semibold text-ink/80">{name}</span>
        <span className="ml-auto flex gap-1.5">
          {[1, 2, 3].map((i) => <span key={i} className="h-1 w-5 rounded bg-black/10" />)}
          <span className="h-1.5 w-8 rounded bg-brand-500" />
        </span>
      </div>
      <div className="flex h-[calc(100%-29px)] gap-3 p-4" style={{ background: `linear-gradient(120deg, ${accent} 0%, ${accent}cc 60%, ${accent}88 100%)` }}>
        <div className="flex-1">
          <span className="mb-2 inline-block h-1.5 w-16 rounded bg-brand-300/80" />
          <p className="text-[15px] font-bold leading-tight text-white">{headline}</p>
          <span className="mt-2 block h-1 w-24 rounded bg-white/40" />
          <span className="mt-1 block h-1 w-20 rounded bg-white/30" />
          <span className="mt-3 inline-block h-4 w-16 rounded bg-brand-500" />
        </div>
        <div className="hidden w-[38%] rounded-lg bg-white/95 p-2 sm:block">
          <p className="text-center text-[9px] font-bold" style={{ color: accent }}>Get A Free Quote</p>
          {[1, 2, 3].map((i) => <span key={i} className="mt-1.5 block h-2.5 rounded border border-black/10" />)}
          <span className="mt-2 block h-3 rounded bg-brand-500" />
        </div>
      </div>
    </div>
  )
}

export default function Websites() {
  const toast = useToast()
  const [callOpen, setCallOpen] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', time: 'Morning (10–12)' })

  const bookCall = () => {
    if (brand.bookCallUrl) window.open(brand.bookCallUrl, '_blank', 'noopener')
    else setCallOpen(true)
  }

  return (
    <div className="mx-auto max-w-[960px]">
      <h1 className="text-[28px] font-semibold tracking-tight">
        <UnderlineHeading>Websites</UnderlineHeading>
      </h1>

      <h2 className="mt-8 text-[26px] font-bold leading-tight tracking-tight sm:text-[32px]">Your website should book jobs. Not just sit there.</h2>
      <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-muted">
        High-converting websites for local service businesses — from the team already running your reviews.
      </p>

      {/* Hero video / visual */}
      <div className="relative mt-8 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 shadow-sm">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #fff 0, transparent 40%), radial-gradient(circle at 80% 70%, #b9dfc3 0, transparent 35%)' }} />
        <div className="relative grid gap-6 p-6 sm:p-10 md:grid-cols-[1.1fr_1fr] md:items-center">
          <div>
            <p className="text-[22px] font-semibold text-white sm:text-[26px]">Websites Built to Rank and Convert Reviews</p>
            <ul className="mt-5 space-y-2.5 text-[15px] text-white/90">
              {['A quote button on every page', 'One page per service and city you serve', 'Your Google reviews built right in', 'Leads sent to your phone and CRM'].map((t) => (
                <li key={t} className="flex items-center gap-2"><CircleCheck className="size-4 text-brand-200" /> {t}</li>
              ))}
            </ul>
          </div>
          <div className="relative">
            <SiteThumb name="Your Business" headline="Top-rated service in your city" accent="#10431f" />
            {brand.websitesVideoUrl && (
              <button
                onClick={() => setVideoOpen(true)}
                className="absolute left-1/2 top-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand-600 text-white shadow-xl ring-4 ring-white/30 hover:bg-brand-700"
                aria-label="Play video"
              >
                <Play className="ml-1 size-7" fill="currentColor" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={() => document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' })}>
          See plans <ArrowDown className="size-4" />
        </Button>
        <Button size="lg" variant="outline" icon={Calendar} onClick={bookCall} className="border-brand-200 text-brand-700">
          Book a call
        </Button>
      </div>

      <div className="my-12 h-px bg-line" />

      {/* Portfolio */}
      <h2 className="text-[26px] font-bold tracking-tight sm:text-[30px]">
        Sites we've built. <span className="font-normal text-muted">All live. Click any one.</span>
      </h2>
      <div className="mt-8 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {portfolio.map((p) => (
          <a key={p.name} href="#" onClick={(e) => e.preventDefault()} className="group block">
            <div className="transition group-hover:-translate-y-0.5 group-hover:shadow-md">
              <SiteThumb name={p.name} headline={p.headline} accent={p.accent} />
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[16px] font-semibold group-hover:text-brand-700">
              {p.name} <ExternalLink className="size-3.5 opacity-0 transition group-hover:opacity-100" />
            </p>
            <p className="text-sm text-muted">{p.category} · {p.city}</p>
            {p.result && <p className="mt-1.5 text-sm text-brand-700">{p.result}</p>}
          </a>
        ))}
      </div>

      <div className="my-12 h-px bg-line" />

      {/* Plans */}
      <div id="plans" className="scroll-mt-20">
        <h2 className="text-[26px] font-bold tracking-tight sm:text-[30px]">Plans</h2>
        <p className="mt-2 text-[16px] text-muted">Pay monthly for 24 months and the website is yours. No setup fee, no contract, no cancellation fee.</p>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {websitePlans.map((plan) => (
            <Card key={plan.name} className={cn('relative flex flex-col p-6', plan.popular && 'border-2 border-brand-600 shadow-md')}>
              {plan.popular && (
                <Badge className="absolute -top-3 left-6 bg-brand-700 text-white ring-brand-700"><Star className="size-3" fill="currentColor" /> Most popular</Badge>
              )}
              <p className="text-lg font-semibold">{plan.name}</p>
              <p className="mt-3">
                <span className="text-[34px] font-bold">{plan.monthly}</span>
                <span className="text-muted">/mo</span>
              </p>
              <p className="text-sm text-muted">for 24 months · or {plan.upfront} upfront</p>
              <ul className="mt-5 flex-1 space-y-2.5 text-[15px]">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2"><CircleCheck className="mt-0.5 size-4 shrink-0 text-brand-600" /> {f}</li>
                ))}
              </ul>
              <Button className="mt-6 w-full" variant={plan.popular ? 'primary' : 'outline'} onClick={bookCall}>
                Get started
              </Button>
            </Card>
          ))}
        </div>
        <p className="mt-5 text-center text-sm text-muted">30-day money-back guarantee · Unlimited revisions within 48 business hours</p>
      </div>

      <Modal
        open={callOpen}
        onClose={() => setCallOpen(false)}
        title="Book a call"
        footer={
          <>
            <Button variant="outline" onClick={() => setCallOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.name.trim() || !isPhone(form.phone)}
              onClick={() => {
                setCallOpen(false)
                toast("Thanks! We'll call you to plan your website.")
                setForm({ name: '', phone: '', time: 'Morning (10–12)' })
              }}
            >
              Request call
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="cn">Your name</Label>
            <Input id="cn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="cp">Phone</Label>
            <Input id="cp" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91" />
          </div>
          <div>
            <Label htmlFor="ct">Best time to call</Label>
            <select id="ct" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="h-10 w-full rounded-lg border border-line bg-white px-3 text-[15px] outline-none">
              <option>Morning (10–12)</option>
              <option>Afternoon (12–4)</option>
              <option>Evening (4–7)</option>
            </select>
          </div>
        </div>
      </Modal>

      <Modal open={videoOpen} onClose={() => setVideoOpen(false)} title="Websites built to rank" size="lg">
        {brand.websitesVideoUrl && (
          <div className="aspect-video overflow-hidden rounded-xl bg-black">
            <iframe src={brand.websitesVideoUrl} title="Websites video" className="size-full" allow="autoplay; encrypted-media; fullscreen" />
          </div>
        )}
      </Modal>
    </div>
  )
}
