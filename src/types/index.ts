// src/types/index.ts

export type ContactStatus = 'pending' | 'sent' | 'clicked' | 'reviewed' | 'stopped'

export interface Contact {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  status: ContactStatus
  doNotContact: boolean
  requestsSent: number
  addedAt: string // ISO
  lastSentAt: string | null
  nextSendAt?: string | null // live mode: when the next request/follow-up is due
}

export type NewContact = Pick<Contact, 'firstName' | 'lastName' | 'email' | 'phone' | 'doNotContact'>

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

/** An answer from the review page (local-octo.vercel.app/review). Bad / Worse ones carry what to improve. */
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
export interface GooglePlaceResult {
  placeId: string
  name: string
  address: string
  rating: number | null
  reviewCount: number
}

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
    followUpsEnabled: boolean
  }
  scheduling: {
    active: boolean
    initialDelayIndex: number
    followUps: number
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
