// src/pages/Widgets.tsx
import { useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Code, Copy, Mail, SquarePen } from 'lucide-react'
import { Avatar, Button, Card, Stars } from '../components/ui/primitives'
import { ColorField } from '../components/ui/ColorField'
import { GoogleG } from '../components/ui/BrandIcons'
import { Modal } from '../components/ui/Modal'
import { useStore } from '../store/AppStore'
import { useToast } from '../components/ui/Toast'
import { brand } from '../config/brand'
import { cn, copyText, isEmail } from '../lib/utils'
import type { WidgetColors } from '../types'
import { initialState } from '../data/mockData'
import { widgetScriptUrl } from '../lib/supabase'

function monthsAgo(iso: string) {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 2_592_000_000))
  return `${m} month${m > 1 ? 's' : ''} ago`
}

function PoweredBy() {
  return (
    <span className="text-[11px] text-ink/70">
      Powered by <b className="font-semibold text-ink">{brand.poweredBy}</b>
    </span>
  )
}

function ColorSettings({ value, onChange }: { value: WidgetColors; onChange: (v: WidgetColors) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <ColorField label="Star Color" value={value.star} onChange={(star) => onChange({ ...value, star })} />
      <ColorField label="Background" value={value.background} onChange={(background) => onChange({ ...value, background })} />
      <ColorField label="Text Color" value={value.text} onChange={(text) => onChange({ ...value, text })} />
    </div>
  )
}

function EditorShell({ title, desc, preview, footer }: { title: string; desc: string; preview: ReactNode; footer?: ReactNode }) {
  return (
    <div className="h-full bg-gradient-to-br from-brand-700 via-brand-500 to-brand-300 p-6 text-white sm:p-10">
      <h2 className="text-[26px] font-semibold tracking-tight sm:text-[32px]">{title}</h2>
      <p className="mt-2 max-w-md text-[16px] text-white/90">{desc}</p>
      <div className="mt-8">{preview}</div>
      {footer && <div className="mt-6">{footer}</div>}
    </div>
  )
}

export default function Widgets() {
  const { state, updateSettings, publicKey } = useStore()
  const toast = useToast()
  const saved = state.settings.widgets
  const [popup, setPopup] = useState(saved.popup)
  const [carousel, setCarousel] = useState(saved.carousel)
  const [techEmail, setTechEmail] = useState('')
  const [guide, setGuide] = useState<null | 'popup' | 'carousel'>(null)
  const [slide, setSlide] = useState(0)

  const reviews = [...state.reviews].filter((r) => r.text).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  const latest = [...state.reviews].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]
  const total = state.reviews.length
  const carouselItems = [...reviews, ...state.reviews.filter((r) => !r.text)]
  const popupDirty = JSON.stringify(popup) !== JSON.stringify(saved.popup)
  const carouselDirty = JSON.stringify(carousel) !== JSON.stringify(saved.carousel)

  const snippet = (type: 'popup' | 'carousel') =>
    `<!-- ${brand.appName} ${type === 'popup' ? 'Review Popup' : 'Review Carousel'} -->\n${
      type === 'carousel' ? '<div id="lo-reviews"></div>\n' : ''
    }<script src="${widgetScriptUrl}" data-business="${publicKey}" data-widget="${type}" async></script>`

  return (
    <div className="mx-auto max-w-[1030px] space-y-8">
      {/* Send instructions */}
      <Card className="overflow-hidden rounded-2xl">
        <div className="bg-gradient-to-r from-brand-700 via-brand-500 to-brand-300 px-6 py-6 text-white sm:px-8">
          <h2 className="text-[24px] font-semibold tracking-tight">Send Installation Instructions</h2>
          <p className="mt-1 text-[15px] text-white/90">Email widget installation instructions to whoever manages your website</p>
        </div>
        <form
          className="px-6 py-6 sm:px-8"
          onSubmit={(e) => {
            e.preventDefault()
            if (!isEmail(techEmail)) return
            toast(`Instructions sent to ${techEmail}`)
            setTechEmail('')
          }}
        >
          <label htmlFor="tech" className="mb-2 block text-[15px] font-medium">Tech Support Email Address</label>
          <input
            id="tech"
            type="email"
            value={techEmail}
            onChange={(e) => setTechEmail(e.target.value)}
            placeholder="tech@yourcompany.com"
            className="h-12 w-full rounded-lg border border-line px-4 text-[16px] outline-none focus:border-brand-500 focus:ring-3 focus:ring-brand-100"
          />
          <Button type="submit" size="lg" icon={Mail} disabled={!isEmail(techEmail)} className="mt-4 h-12 w-full disabled:bg-gray-400/80">
            Send Installation Instructions
          </Button>
        </form>
      </Card>

      {/* Popup editor */}
      <Card className="grid overflow-hidden rounded-2xl lg:grid-cols-[410px_1fr]">
        <div>
          <EditorShell
            title="Review Popup Editor"
            desc="This widget pops up at the bottom right or left corner of the screen."
            preview={
              <div className="rounded-2xl bg-white/15 p-6">
                <div className="mx-auto max-w-[270px] rounded-xl p-4 shadow-lg" style={{ background: popup.background, color: popup.text }}>
                  <div className="flex items-start gap-3">
                    <GoogleG className="size-7 shrink-0" />
                    <div>
                      <p className="text-[14px] font-semibold">{latest?.author.split(' ')[0] ?? 'A customer'} left a review</p>
                      <p className="text-[13px] opacity-80">Read our {total} reviews</p>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-center">
                    <Stars rating={5} size={26} color={popup.star} />
                  </div>
                  <div className="mt-2 text-center"><PoweredBy /></div>
                </div>
              </div>
            }
            footer={
              <button onClick={() => setGuide('popup')} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-white font-semibold text-brand-700 hover:bg-brand-50">
                <Code className="size-4" /> Installation Guide
              </button>
            }
          />
        </div>
        <div className="p-6 sm:p-10">
          <h3 className="flex items-center gap-2 text-[20px] font-semibold"><SquarePen className="size-5 text-brand-700" /> Customization Options</h3>
          <p className="mt-6 text-sm font-medium uppercase tracking-wide text-muted">Position Settings</p>
          <div className="mt-3 rounded-xl border border-line p-5">
            <p className="text-[15px]">Popup on which side of screen?</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(['left', 'right'] as const).map((side) => (
                <button
                  key={side}
                  onClick={() => setPopup({ ...popup, position: side })}
                  className={cn(
                    'flex h-12 items-center justify-center gap-2 rounded-lg border text-[16px] font-medium capitalize transition',
                    popup.position === side ? 'border-brand-700 bg-brand-700 text-white' : 'border-line bg-white hover:bg-canvas',
                  )}
                >
                  {side === 'left' && <ArrowLeft className="size-4" />}
                  {side}
                  {side === 'right' && <ArrowRight className="size-4" />}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-8 text-sm font-medium uppercase tracking-wide text-muted">Color Settings</p>
          <div className="mt-3">
            <ColorSettings value={popup} onChange={(c) => setPopup({ ...popup, ...c })} />
          </div>
          <div className="mt-8 flex justify-end gap-3 border-t border-line pt-6">
            <Button variant="ghost" className="bg-canvas" onClick={() => setPopup(initialState.settings.widgets.popup)}>Reset</Button>
            <Button
              disabled={!popupDirty}
              className="disabled:bg-gray-400/80"
              onClick={() => { updateSettings('widgets', { popup }); toast('Popup widget saved') }}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </Card>

      {/* Carousel editor */}
      <Card className="overflow-hidden rounded-2xl">
        <EditorShell
          title="Review Carousel Editor"
          desc="This widget displays your reviews in a customizable carousel."
          preview={
            <div className="rounded-2xl bg-white/25 p-4 sm:p-8">
              <div className="mx-auto max-w-[790px]">
                <div className="flex flex-col gap-3 rounded-xl p-4 shadow-sm sm:flex-row sm:items-center" style={{ background: carousel.background, color: carousel.text }}>
                  <GoogleG className="size-9 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[18px] font-semibold">What our customers are saying on Google!</p>
                    <p className="text-sm opacity-80">Just a few of our <b>{total}</b> reviews</p>
                  </div>
                  <a href={state.settings.business.mapsUrl} target="_blank" rel="noreferrer" className="rounded-full bg-[#1a73e8] px-4 py-2 text-center text-sm font-medium text-white">
                    View on Google Maps
                  </a>
                </div>

                <div className="relative mt-5 flex items-center gap-2 sm:gap-4">
                  <button
                    onClick={() => setSlide((s) => (s - 1 + carouselItems.length) % carouselItems.length)}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-ink shadow"
                    aria-label="Previous review"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <div className="grid flex-1 gap-4 md:grid-cols-2">
                    {[0, 1].map((offset) => {
                      const r = carouselItems[(slide + offset) % carouselItems.length]
                      if (!r || (offset === 1 && carouselItems.length < 2)) return null
                      return (
                        <div
                          key={r.id + offset}
                          className={cn('rounded-xl p-5 shadow-sm', offset === 1 && 'hidden md:block')}
                          style={{ background: carousel.background, color: carousel.text }}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar name={r.author} color={r.avatarColor} size={34} />
                            <div>
                              <p className="text-[16px] font-semibold">{r.author}</p>
                              <p className="text-xs opacity-70">{monthsAgo(r.createdAt)}</p>
                            </div>
                          </div>
                          <Stars rating={r.rating} size={26} color={carousel.star} className="mt-3" />
                          <p className="mt-3 line-clamp-3 text-[15px] leading-relaxed">{r.text || 'Rated 5 stars on Google'}</p>
                        </div>
                      )
                    })}
                  </div>
                  <button
                    onClick={() => setSlide((s) => (s + 1) % carouselItems.length)}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-ink shadow"
                    aria-label="Next review"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
                <div className="mt-4 flex justify-center gap-1.5">
                  {carouselItems.map((r, i) => (
                    <button
                      key={r.id}
                      onClick={() => setSlide(i)}
                      aria-label={`Show review ${i + 1}`}
                      className={cn('h-1.5 rounded-full transition-all', i === slide ? 'w-5 bg-ink/70' : 'w-1.5 bg-ink/25')}
                    />
                  ))}
                </div>
                <div className="mt-5 flex justify-center">
                  <span className="rounded-full bg-white px-3 py-1"><PoweredBy /></span>
                </div>
              </div>
            </div>
          }
        />
        <div className="p-6 sm:p-10">
          <h3 className="flex items-center gap-2 text-[20px] font-semibold"><SquarePen className="size-5 text-brand-700" /> Customization Options</h3>
          <p className="mt-6 text-sm font-medium uppercase tracking-wide text-muted">Color Settings</p>
          <div className="mt-3">
            <ColorSettings value={carousel} onChange={setCarousel} />
          </div>
          <div className="mt-8 flex flex-wrap justify-end gap-3 border-t border-line pt-6">
            <Button variant="outline" icon={Code} onClick={() => setGuide('carousel')} className="mr-auto">Installation Guide</Button>
            <Button variant="ghost" className="bg-canvas" onClick={() => setCarousel(initialState.settings.widgets.carousel)}>Reset</Button>
            <Button
              disabled={!carouselDirty}
              className="disabled:bg-gray-400/80"
              onClick={() => { updateSettings('widgets', { carousel }); toast('Carousel widget saved') }}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </Card>

      <Modal open={guide !== null} onClose={() => setGuide(null)} title="Installation Guide" size="lg">
        {guide && (
          <div className="space-y-4 text-[15px]">
            <ol className="list-decimal space-y-2 pl-5 text-ink/85">
              <li>Copy the code below.</li>
              <li>
                {guide === 'popup'
                  ? 'Paste it just before the closing </body> tag on every page of your website.'
                  : 'Paste it where you want the carousel to appear (for example, your home page).'}
              </li>
              <li>Save and publish. Reviews update automatically.</li>
            </ol>
            <pre className="overflow-x-auto rounded-xl bg-[#10241a] p-4 text-[13px] leading-relaxed text-brand-100">{snippet(guide)}</pre>
            <Button icon={Copy} onClick={async () => toast((await copyText(snippet(guide))) ? 'Code copied' : 'Could not copy', 'success')}>
              Copy Code
            </Button>
            <p className="text-sm text-muted">WordPress: paste into a Custom HTML block. Wix / Squarespace: use an Embed Code element.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
