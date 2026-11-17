// src/components/FeedbackList.tsx
// "Negative Reviews" tab on the Reviews page: Bad / Worse reviews sent through the review form.
// The business can email (or call) the customer back.

import { useMemo } from 'react'
import { Mail, MessageSquareText, Phone } from 'lucide-react'
import { Badge, Button, Card, EmptyState } from './ui/primitives'
import { useStore } from '../store/AppStore'
import { cn, timeAgo } from '../lib/utils'
import type { CustomerFeedback } from '../types'

const FACE: Record<CustomerFeedback['rating'], { emoji: string; label: string }> = {
  5: { emoji: '😍', label: 'Happy' },
  4: { emoji: '🙂', label: 'Good' },
  2: { emoji: '🙁', label: 'Bad' },
  1: { emoji: '😠', label: 'Worse' },
}

export function FeedbackList() {
  const { feedback, state } = useStore()
  const business = state.settings.messaging.businessName || state.settings.business.name
  // Negative reviews = what Bad / Worse customers sent through the review form
  const list = useMemo(() => feedback.filter((f) => f.rating <= 2), [feedback])

  const mailto = (f: CustomerFeedback) => {
    const first = f.name.split(' ')[0] || 'there'
    const subject = `About your recent visit to ${business}`
    const body = `Hi ${first},\n\nThank you for telling us about your experience${f.text ? `:\n"${f.text}"` : '.'}\n\nWe're sorry it wasn't what you expected. Could you tell us a little more, so we can put it right?\n\nThank you,\n${business}`
    return `mailto:${encodeURIComponent(f.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  return (
    <div className="mt-6">
      <p className="text-[15px] text-muted">
        Bad and Worse reviews from your review form. They never go to Google; they come here so you can follow up and fix it.
      </p>

      {!list.length ? (
        <Card className="mt-5">
          <EmptyState icon={MessageSquareText} title="No negative reviews" body="When a customer picks Bad or Worse on your review page, their review shows up here." />
        </Card>
      ) : (
        <div className="mt-5 space-y-4">
          {list.map((f) => (
            <Card key={f.id} className={cn('p-5', f.rating <= 2 && 'border-brand-200')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl leading-none">{FACE[f.rating].emoji}</span>
                  <div>
                    <p className="font-semibold">{f.name || 'Customer (no name given)'}</p>
                    <p className="text-xs text-muted">
                      {timeAgo(f.createdAt)} · {f.fromContact ? 'From a review request' : 'From your shared link'}
                    </p>
                  </div>
                </div>
                <Badge tone={f.rating <= 2 ? 'red' : 'green'}>{FACE[f.rating].label}</Badge>
              </div>

              {f.text ? (
                <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed">{f.text}</p>
              ) : (
                <p className="mt-4 text-sm text-muted">No message left.</p>
              )}
              {f.photoUrl && <img src={f.photoUrl} alt="Customer's photo" className="mt-3 h-28 rounded-lg object-cover ring-1 ring-line" />}

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                {f.email && <span className="inline-flex items-center gap-1.5"><Mail className="size-4" /> {f.email}</span>}
                {f.phone && <span className="inline-flex items-center gap-1.5"><Phone className="size-4" /> {f.phone}</span>}
                {!f.email && !f.phone && <span>No contact details left.</span>}
              </div>

              {(f.email || f.phone) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {f.email && (
                    <a href={mailto(f)}>
                      <Button size="sm" icon={Mail}>Email customer</Button>
                    </a>
                  )}
                  {f.phone && (
                    <a href={`tel:${f.phone.replace(/[^\d+]/g, '')}`}>
                      <Button size="sm" variant="outline" icon={Phone}>Call</Button>
                    </a>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
