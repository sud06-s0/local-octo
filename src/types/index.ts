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

export interface SocialPost {
  id: string
  reviewId: string
  network: 'facebook' | 'instagram'
  format: 'feed' | 'story'
  status: 'scheduled' | 'posted' | 'failed'
  at: string
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

export type IntegrationStatus = 'connected' | 'available' | 'coming_soon'

export interface WidgetColors {
  star: string
  background: string
  text: string
}

export type CaptionSource = 'review' | 'reply' | 'custom'
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

/** Background design for review posts: a preset (CSS background) or an uploaded image URL */
export interface PostTemplate {
  id: string
  name: string
  kind: 'preset' | 'upload'
  background: string
  textColor: string
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
  widgets: {
    popup: WidgetColors & { position: 'left' | 'right' }
    carousel: WidgetColors
  }
  social: {
    facebookConnected: boolean
    instagramConnected: boolean
    autoPost: boolean
    captionSource: CaptionSource
    customCaption: string
    schedule: Record<DayKey, { story: boolean; feed: boolean }>
    templates: PostTemplate[]
    activeTemplateId: string | null
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
  socialPosts: SocialPost[]
  settings: Settings
}
