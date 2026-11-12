// src/pages/Notifications.tsx
import { useState } from 'react'
import { Bell, CheckCheck, Info, MousePointerClick, Star, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Button, Card, EmptyState, PageHeader, Toggle } from '../components/ui/primitives'
import { useStore } from '../store/AppStore'
import { useToast } from '../components/ui/Toast'
import { cn, timeAgo } from '../lib/utils'
import type { NotificationType, Settings } from '../types'

const typeMeta: Record<NotificationType, { icon: LucideIcon; tile: string }> = {
  new_review: { icon: Star, tile: 'bg-amber-50 text-amber-600' },
  low_rating: { icon: TriangleAlert, tile: 'bg-red-50 text-red-600' },
  link_clicked: { icon: MousePointerClick, tile: 'bg-brand-50 text-brand-700' },
  system: { icon: Info, tile: 'bg-canvas text-muted' },
}

export default function Notifications() {
  const { state, markNotificationRead, markAllNotificationsRead, updateSettings } = useStore()
  const toast = useToast()
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const prefs = state.settings.notifications
  const unread = state.notifications.filter((n) => !n.read).length
  const list = state.notifications.filter((n) => (tab === 'unread' ? !n.read : true)).sort((a, b) => +new Date(b.at) - +new Date(a.at))

  const pref = (key: keyof Settings['notifications'], label: string, desc: string) => (
    <div className="flex items-center justify-between gap-4 py-4">
      <div>
        <p className="text-[15px] font-medium">{label}</p>
        <p className="text-sm text-muted">{desc}</p>
      </div>
      <Toggle checked={!!prefs[key]} onChange={(v) => updateSettings('notifications', { [key]: v })} label={label} />
    </div>
  )

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Notifications"
        subtitle="New reviews, alerts and activity on your account"
        actions={
          <Button variant="outline" icon={CheckCheck} disabled={unread === 0} onClick={() => { markAllNotificationsRead(); toast('All notifications marked as read') }}>
            Mark all as read
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="flex gap-1 border-b border-line px-4 pt-3">
            {(['all', 'unread'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn('-mb-px border-b-2 px-3 pb-2.5 text-[15px] capitalize', tab === t ? 'border-brand-700 font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}
              >
                {t}
                {t === 'unread' && unread > 0 && <span className="ml-1.5 rounded bg-brand-700 px-1.5 text-xs text-white">{unread}</span>}
              </button>
            ))}
          </div>
          {list.length === 0 ? (
            <EmptyState icon={Bell} title="You're all caught up" body="New notifications will show up here." />
          ) : (
            <ul className="divide-y divide-line">
              {list.map((n) => {
                const meta = typeMeta[n.type]
                const Icon = meta.icon
                return (
                  <li key={n.id}>
                    <button onClick={() => markNotificationRead(n.id)} className={cn('flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-canvas/60', !n.read && 'bg-brand-50/40')}>
                      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', meta.tile)}>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-[15px] font-medium">{n.title}</span>
                          {!n.read && <span className="size-2 rounded-full bg-brand-600" />}
                        </span>
                        <span className="block text-sm text-muted">{n.body}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{timeAgo(n.at)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card className="h-fit p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Alert Preferences</h2>
          <div className="mt-2 divide-y divide-line">
            {pref('emailNewReview', 'New review emails', 'Get an email for every new Google review')}
            {pref('emailLowRating', 'Low-rating email alerts', 'Know right away when a review needs attention')}
            {pref('whatsappLowRating', 'Low-rating WhatsApp alerts', 'Instant WhatsApp message for low ratings')}
            {pref('weeklySummary', 'Weekly summary', 'Requests, clicks and reviews every Monday')}
          </div>
          <label htmlFor="thr" className="mt-4 block text-[15px] font-medium">Treat as low rating</label>
          <select
            id="thr"
            value={prefs.lowRatingThreshold}
            onChange={(e) => updateSettings('notifications', { lowRatingThreshold: Number(e.target.value) as 1 | 2 | 3 })}
            className="mt-2 h-10 w-full rounded-lg border border-line bg-white px-3 text-[15px] outline-none"
          >
            <option value={3}>3 stars or fewer</option>
            <option value={2}>2 stars or fewer</option>
            <option value={1}>1 star only</option>
          </select>
        </Card>
      </div>
    </div>
  )
}
