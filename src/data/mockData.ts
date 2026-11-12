// src/data/mockData.ts
// SAMPLE DATA ONLY — every name, review and project below is invented for the UI.
// Replace with Supabase queries when the backend is connected.

import type { AppState, Contact, Review, AppNotification, SocialPost } from '../types'
import { daysAgo } from '../lib/utils'

const contacts: Contact[] = [
  { id: 'c1', firstName: 'Priya', lastName: 'Raman', email: 'priya.raman@example.com', phone: '+91 98450 11223', status: 'reviewed', doNotContact: false, requestsSent: 1, addedAt: daysAgo(12), lastSentAt: daysAgo(12) },
  { id: 'c2', firstName: 'Arjun', lastName: 'Mehta', email: 'arjun.m@example.com', phone: '+91 99000 44556', status: 'clicked', doNotContact: false, requestsSent: 2, addedAt: daysAgo(9), lastSentAt: daysAgo(6) },
  { id: 'c3', firstName: 'Kavya', lastName: 'Iyer', email: '', phone: '+91 97411 78901', status: 'sent', doNotContact: false, requestsSent: 1, addedAt: daysAgo(3), lastSentAt: daysAgo(3) },
  { id: 'c4', firstName: 'Rohit', lastName: 'Sharma', email: 'rohit.s@example.com', phone: '', status: 'stopped', doNotContact: false, requestsSent: 3, addedAt: daysAgo(21), lastSentAt: daysAgo(15) },
  { id: 'c5', firstName: 'Neha', lastName: 'Kulkarni', email: 'neha.k@example.com', phone: '+91 98861 22334', status: 'pending', doNotContact: true, requestsSent: 0, addedAt: daysAgo(1), lastSentAt: null },
  { id: 'c6', firstName: 'Vikram', lastName: 'Nair', email: 'vikram.nair@example.com', phone: '+91 90080 55667', status: 'sent', doNotContact: false, requestsSent: 2, addedAt: daysAgo(5), lastSentAt: daysAgo(2) },
]

const reviews: Review[] = [
  {
    id: 'r1', author: 'Meera Joshi', avatarColor: '#2f8c4a', rating: 5,
    text: '',
    createdAt: daysAgo(1460), url: '#',
    reply: { source: 'google', at: daysAgo(29), text: 'Thank you, Meera, for the 5-star rating and for choosing Local Octo. We really appreciate your support and look forward to helping your business grow online.' },
  },
  {
    id: 'r2', author: 'Karan Malhotra', avatarColor: '#c2410c', rating: 5,
    text: '',
    createdAt: daysAgo(2190), url: '#',
    reply: { source: 'google', at: daysAgo(29), text: 'Thank you, Karan, for the 5-star rating! We truly appreciate your support and look forward to helping you again with your marketing needs.' },
  },
  {
    id: 'r3', author: 'Sana Qureshi', avatarColor: '#7c3aed', rating: 5,
    text: '',
    createdAt: daysAgo(2555), url: '#',
    reply: { source: 'google', at: daysAgo(29), text: 'Thank you, Sana, for the 5-star rating! We are glad you had a great experience with Local Octo.' },
  },
  {
    id: 'r4', author: 'Deepak Rao', avatarColor: '#0369a1', rating: 5,
    text: 'I wanted to grow my business online and Local Octo made it simple. The team explained everything clearly, set up our Google profile and helped us collect reviews from happy customers. Very practical approach. Highly recommended!',
    createdAt: daysAgo(2920), url: '#',
    reply: { source: 'google', at: daysAgo(29), text: 'Deepak, thank you for the wonderful feedback. We are glad the setup was simple and the results were practical. Wishing your business continued growth!' },
  },
]

const notifications: AppNotification[] = [
  { id: 'n1', type: 'link_clicked', title: 'Review link clicked', body: 'Arjun Mehta opened your review link.', at: daysAgo(0, 3), read: false },
  { id: 'n2', type: 'new_review', title: 'New 5-star review', body: 'Priya Raman left a 5-star review on Google.', at: daysAgo(2), read: false },
  { id: 'n3', type: 'system', title: 'Follow-ups resumed', body: 'Review requests are being sent as scheduled again.', at: daysAgo(6), read: true },
  { id: 'n4', type: 'system', title: 'Google profile connected', body: 'Your Google Business Profile is synced. 4 reviews imported.', at: daysAgo(29), read: true },
]

const socialPosts: SocialPost[] = [
  { id: 's1', reviewId: 'r4', network: 'facebook', format: 'feed', status: 'posted', at: daysAgo(4) },
  { id: 's2', reviewId: 'r4', network: 'instagram', format: 'story', status: 'posted', at: daysAgo(4) },
]

export const initialState: AppState = {
  contacts,
  reviews,
  notifications,
  socialPosts,
  settings: {
    business: {
      name: 'Local Octo',
      address: '2nd Floor, 1109-2/1, 25th Main Road, 1st Phase, J. P. Nagar',
      mapsUrl: 'https://maps.google.com/?q=Local+Octo+J.P.+Nagar',
      reviewLink: 'https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID',
    },
    messaging: {
      mode: 'smart',
      ownerFirstName: 'Adarsh',
      businessName: 'Local Octo',
      personalizedImage: true,
      imageDataUrl: null,
      customMessage:
        "Hey {first_name}, we hope you enjoyed your experience with {business_name}! Would you mind taking a moment to leave a review? Here's the link: {review_link}",
      customFollowUp: 'Hi {first_name}, just a quick reminder — your feedback means a lot to us! {review_link}',
      followUpsEnabled: true,
    },
    scheduling: { active: true, initialDelayIndex: 0, followUps: 2 },
    ai: { autoPostPositive: true, nickname: '' },
    widgets: {
      popup: { position: 'left', star: '#FFC107', background: '#FFFFFF', text: '#000000' },
      carousel: { star: '#FFC107', background: '#FFFFFF', text: '#333333' },
    },
    social: {
      facebookConnected: true,
      instagramConnected: false,
      autoPost: true,
      feed: true,
      story: true,
      template: 'green',
      minRating: 5,
    },
    notifications: {
      emailNewReview: true,
      emailLowRating: true,
      whatsappLowRating: true,
      weeklySummary: true,
      lowRatingThreshold: 3,
    },
    integrations: {
      google: 'connected',
      whatsapp: 'available',
      email: 'connected',
      sms: 'available',
      zapier: 'available',
      pabbly: 'available',
      webhooks: 'connected',
      jobber: 'available',
      housecall: 'available',
      quickbooks: 'coming_soon',
      square: 'coming_soon',
      facebook: 'connected',
      instagram: 'available',
    },
  },
}

/** Placeholder portfolio for the Websites page — replace with real Local Octo projects. */
export const portfolio = [
  { name: 'BrightNest Cleaning', category: 'House cleaning', city: 'Bengaluru', headline: 'Your home, spotless. Your weekends back.', accent: '#1e3a8a', result: 'Sample result — add real stats' },
  { name: 'Summit Roofing Co.', category: 'Roofing', city: 'Mysuru', headline: 'Roofs built to last 20+ monsoons', accent: '#0f766e', result: '' },
  { name: 'PawPatrol Yard Care', category: 'Pet waste removal', city: 'Pune', headline: 'A cleaner yard with a single click.', accent: '#14532d', result: '' },
  { name: 'Oakline Flooring', category: 'Flooring', city: 'Chennai', headline: 'Top-rated hardwood flooring', accent: '#44403c', result: '' },
  { name: 'CoolAir Services', category: 'HVAC', city: 'Hyderabad', headline: 'AC repair in 60 minutes or less', accent: '#0369a1', result: '' },
  { name: 'Haul Away Junk', category: 'Junk removal', city: 'Mumbai', headline: 'Quit staring at that junk.', accent: '#3f6212', result: '' },
]

export const websitePlans = [
  { name: 'Starter', pages: 15, upfront: '$2,995', monthly: '$149', features: ['15 pages', 'First draft in 14 days', 'Lead forms & click-to-call', 'SEO page per service & city', 'Hosting, SSL & security', 'Review widget included'] },
  { name: 'Standard', pages: 20, upfront: '$3,500', monthly: '$179', popular: true, features: ['20 pages', 'First draft in 7 days', 'CRM lead delivery', 'SMS lead alerts', 'Everything in Starter'] },
  { name: 'Scale', pages: 40, upfront: '$4,995', monthly: '$299', features: ['40 pages', 'Keyword-targeted local content', 'Priority support', 'Everything in Standard'] },
]
