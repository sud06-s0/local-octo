// src/config/brand.ts
// White-label settings. Colours live in src/index.css (@theme).
// Values marked TODO are placeholders — confirm before going live.

export const brand = {
  appName: 'Local Octo',
  shortName: 'LO',
  poweredBy: 'Local Octo',
  supportEmail: 'support@localocto.com', // TODO: confirm real support address
  referralReward: '$100', // TODO: confirm reward + currency
  widgetScriptUrl: 'https://widgets.localocto.com/embed.js', // TODO: real embed host once backend exists
  webhookBaseUrl: 'https://api.localocto.com/hooks', // TODO: Supabase Edge Function URL
  websitesVideoUrl: '' as string, // optional YouTube/Vimeo embed URL for the Websites page
  bookCallUrl: '' as string, // optional Calendly/Cal.com link; empty = in-app form
  sendWindow: { start: '9 AM', end: '7 PM' },
  followUpGapDays: 3,
} as const
