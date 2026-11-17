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

export type WaTemplateKind = 'initial' | 'initial_image' | 'followup' | 'followup_image'
export type WaTemplateStatus = 'not_created' | 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled' | 'failed'

/** A business's Custom Message submitted to Meta as a WhatsApp template */
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

export type IntegrationStatus = 'connected' | 'available' | 'coming_soon'

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
    /** WhatsApp template name for the Custom Message (photo version gets "_photo") */
    customTemplateName: string
    /** WhatsApp template name for the Custom Follow-up (photo version gets "_photo") */
    customFollowUpTemplateName: string
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
  integrations: Record<string, IntegrationStatus>
}

export interface AppState {
  contacts: Contact[]
  reviews: Review[]
  notifications: AppNotification[]
  settings: Settings
}
