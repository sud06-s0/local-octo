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

export type IntegrationStatus = 'connected' | 'available' | 'coming_soon'

export interface WidgetColors {
  star: string
  background: string
  text: string
}

export interface Settings {
  business: {
    name: string
    address: string
    mapsUrl: string
    reviewLink: string
  }
  messaging: {
    mode: 'smart' | 'custom'
    ownerFirstName: string
    businessName: string
    personalizedImage: boolean
    imageDataUrl: string | null
    customMessage: string
    customFollowUp: string
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
    feed: boolean
    story: boolean
    template: 'green' | 'white' | 'quote'
    minRating: 4 | 5
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
