// src/types/index.ts

export type ContactStatus = 'pending' | 'sent' | 'clicked' | 'reviewed' | 'stopped'

export type Gender = 'male' | 'female' | ''

export interface Contact {
  id: string
  firstName: string
  lastName: string
  /** WhatsApp adds "Sir" (male) or "Ma'am" (female) after the first name */
  gender?: Gender
  email: string
  phone: string
  status: ContactStatus
  doNotContact: boolean
  requestsSent: number
  addedAt: string // ISO
  lastSentAt: string | null
  nextSendAt?: string | null // live mode: when the next request/follow-up is due
  /** manual send waiting: 'initial' (first message with photo) | 'follow_up' | '' */
  sendKind?: 'initial' | 'follow_up' | ''
}

export type NewContact = Pick<Contact, 'firstName' | 'lastName' | 'email' | 'phone' | 'gender' | 'doNotContact'>

export type ReplySource = 'google' | 'app' | 'draft'

export interface ReviewReply {
  text: string
  source: ReplySource // google = replied directly on Google, app = sent from here, draft = waiting for approval
  at: string
}

export interface Review {
  id: string
  author: string
  avatarColor: string
  rating: 1 | 2 | 3 | 4 | 5
  text: string
  createdAt: string
  url: string
  reply?: ReviewReply
}

export type NotificationType = 'new_review' | 'low_rating' | 'link_clicked' | 'system'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  body: string
  at: string
  read: boolean
}

/** An answer from the review page (review.localocto.com/review). Bad / Worse ones carry what to improve. */
export interface CustomerFeedback {
  id: string
  rating: 1 | 2 | 4 | 5
  text: string
  photoUrl: string | null
  createdAt: string
  name: string
  email: string
  phone: string
  /** Came from a review-request link (a known contact) rather than the shared link */
  fromContact: boolean
}

export interface WaTemplate {
  id: string
  kind: WaTemplateKind
  name: string
  language: string
  body: string
  status: WaTemplateStatus
  reason: string | null
  /** Category Meta gave it: marketing, utility or authentication */
  category: string | null
  createdAt: string
  /** Business it was made in (templates are a shared library for the agency) */
  businessId?: string
  businessName?: string
  /** The follow-up every business uses by default */
  isDefault?: boolean
}

export type WaTemplateKind = 'initial' | 'initial_image' | 'followup' | 'followup_image'
export type WaTemplateStatus = 'not_created' | 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled' | 'failed'

/** A business's Custom Message submitted to Meta as a WhatsApp template */
/** Approval status of one of the 4 standard templates in WhatsApp Manager */
export interface WaStandardTemplate {
  kind: WaTemplateKind
  name: string
  status: WaTemplateStatus
  reason: string | null
  category: string | null
}

/** A Google search result for "Find your business on Google" */
/** Google Business Profile connection (OAuth) for the active business. */
export interface GoogleConnection {
  connected: boolean
  email: string
  locationTitle: string
  needsLocation: boolean
  lastSyncAt: string | null
}

export interface GbpLocation {
  accountName: string
  locationName: string
  title: string
  address: string
  placeId: string | null
  reviewUrl: string | null
  mapsUrl: string | null
}

export interface Settings {
  business: {
    name: string
    address: string
    mapsUrl: string
    reviewLink: string
    /** short link code (5–6 letters/digits): links become review.localocto.com/r?t=<code>-<contact code> */
    shortCode?: string
    /** first download of the review-link QR code PDF (clients get one download, agency any number) */
    qrDownloadedAt?: string | null
    placeId: string
    phone: string
    website: string
    googleRating: number | null
    googleReviewCount: number | null
    googleSyncedAt: string | null
  }
  messaging: {
    mode: 'smart' | 'custom'
    ownerFirstName: string
    businessName: string
    personalizedImage: boolean
    /** add Sir / Ma'am after the first name (by contact gender) on WhatsApp and the image; default on */
    useTitle?: boolean
    imageDataUrl: string | null
    customMessage: string
    customFollowUp: string
    /** WhatsApp: the standard templates, or the agency's own approved custom templates */
    waMode: 'standard' | 'custom'
    /** WhatsApp custom templates (agency writes and submits them for approval) */
    waMessage: string
    waFollowUp: string
    waTemplateName: string
    waFollowUpTemplateName: string
    /** WhatsApp category requested for the custom templates (default marketing) */
    waCategory?: 'marketing' | 'utility'
    /** Templates this business sends with, picked from the shared library (row ids). Empty = its own latest approved */
    waTemplateId?: string | null
    waFollowUpTemplateId?: string | null
    waFollowUpCategory?: 'marketing' | 'utility'
    /** WhatsApp second message: photo + text, sent one follow-up gap after the first (text-only) message */
    waSecondMessage?: string
    waSecondTemplateName?: string
    waSecondCategory?: 'marketing' | 'utility'
    waSecondTemplateId?: string | null
    followUpsEnabled: boolean
    /** channels each review request goes out on; not saved yet = WhatsApp only */
    channels?: { whatsapp: boolean; sms: boolean; email: boolean }
    /** SMS: 'window' = only 10 AM–9 PM (default), 'now' = send straight away */
    smsTiming?: 'now' | 'window'
    /** Custom email template subjects ({first_name}, {business_name}); empty = default subject */
    emailSubject?: string
    emailFollowUpSubject?: string
  }
  scheduling: {
    active: boolean
    initialDelayIndex: number
    followUps: number
    /** false = only 9 AM–7 PM (default), true = send any time, straight away */
    sendAnytime?: boolean
  }
  ai: {
    autoPostPositive: boolean
    nickname: string
  }
  notifications: {
    emailNewReview: boolean
    emailLowRating: boolean
    whatsappLowRating: boolean
    weeklySummary: boolean
    lowRatingThreshold: 1 | 2 | 3
  }
}

export interface AppState {
  contacts: Contact[]
  reviews: Review[]
  notifications: AppNotification[]
  settings: Settings
}
