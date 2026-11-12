// src/pages/RequestScheduling.tsx
import { Info, Pause, Play } from 'lucide-react'
import { Button, Card, RangeSlider, UnderlineHeading } from '../components/ui/primitives'
import { useStore } from '../store/AppStore'
import { useToast } from '../components/ui/Toast'
import { brand } from '../config/brand'
import { cn } from '../lib/utils'

const DELAYS = ['Right Away', '1 Hour Later', '3 Hours Later', '6 Hours Later', '1 Day Later', '2 Days Later', '3 Days Later', '7 Days Later']
const MAX_FOLLOW_UPS = 3

export default function RequestScheduling() {
  const { state, updateSettings } = useStore()
  const toast = useToast()
  const s = state.settings.scheduling

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <Card className={cn('flex flex-wrap items-center gap-4 px-5 py-4', !s.active && 'border-amber-200 bg-amber-50/60')}>
        <span className={cn('flex size-9 items-center justify-center rounded-full', s.active ? 'bg-brand-50' : 'bg-amber-100')}>
          {s.active ? <Play className="size-4 text-brand-700" /> : <Pause className="size-4 text-amber-700" />}
        </span>
        <div className="flex-1">
          <p className="text-[16px] font-medium">{s.active ? 'Review requests active' : 'Review requests paused'}</p>
          <p className="text-sm text-muted">{s.active ? 'Messages are being sent as scheduled' : 'No messages will be sent until you resume'}</p>
        </div>
        <Button
          variant="outline"
          icon={s.active ? Pause : Play}
          onClick={() => {
            updateSettings('scheduling', { active: !s.active })
            toast(s.active ? 'Review requests paused' : 'Review requests resumed')
          }}
        >
          {s.active ? 'Pause' : 'Resume'}
        </Button>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5 sm:p-7">
          <h2 className="text-[24px] font-semibold tracking-tight sm:text-[28px]">
            <UnderlineHeading>Initial Request Scheduling</UnderlineHeading>
          </h2>
          <p className="mt-3 text-[16px] text-muted">Choose when to send review requests to your contacts after receiving their information.</p>

          <p className="mt-10 text-center text-[30px] font-semibold text-brand-700 sm:text-[36px]">{DELAYS[s.initialDelayIndex]}</p>
          <div className="mt-6">
            <RangeSlider
              label="Initial request delay"
              min={0}
              max={DELAYS.length - 1}
              value={s.initialDelayIndex}
              onChange={(v) => updateSettings('scheduling', { initialDelayIndex: v })}
            />
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>Right away</span>
              <span>7 days</span>
            </div>
          </div>

          <div className="mt-6 rounded-xl bg-canvas p-5">
            <p className="flex items-center gap-2 text-[16px] font-semibold"><Info className="size-5" /> Important Notes:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-ink/85 marker:text-ink/60">
              <li>Review requests are only sent between {brand.sendWindow.start} - {brand.sendWindow.end} local time</li>
              <li>If scheduled outside these hours, the request will be sent the next day</li>
              <li>
                If you need to schedule review requests at specific times in the future, please contact{' '}
                <a href={`mailto:${brand.supportEmail}`} className="font-semibold text-brand-700 hover:underline">{brand.supportEmail}</a>
              </li>
            </ul>
          </div>
        </Card>

        <Card className="p-5 sm:p-7">
          <h2 className="text-[24px] font-semibold tracking-tight sm:text-[28px]">
            <UnderlineHeading>Follow-Up Messages</UnderlineHeading>
          </h2>
          <p className="mt-3 text-[16px] text-muted">Choose how many follow-up messages to send if a contact doesn't respond to the initial review request.</p>

          <p className="mt-10 text-center text-[30px] font-semibold text-brand-700 sm:text-[36px]">
            {s.followUps === 0 ? 'No follow-ups' : `${s.followUps} follow-up${s.followUps > 1 ? 's' : ''}`}
          </p>
          <div className="mt-6">
            <RangeSlider
              label="Number of follow-ups"
              min={0}
              max={MAX_FOLLOW_UPS}
              value={s.followUps}
              onChange={(v) => updateSettings('scheduling', { followUps: v })}
            />
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>0</span>
              <span>{MAX_FOLLOW_UPS}</span>
            </div>
          </div>

          <div className="mt-6 rounded-xl bg-canvas p-5">
            <p className="flex items-center gap-2 text-[16px] font-semibold"><Info className="size-5" /> About Follow-Ups:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-ink/85 marker:text-ink/60">
              <li>Follow-ups are sent {brand.followUpGapDays} days after the previous message</li>
              <li>Contacts who click your review link won't receive follow-ups</li>
              <li>You can stop follow-ups for individual contacts from the contacts page</li>
            </ul>
          </div>
        </Card>
      </div>
    </div>
  )
}
