// src/config/brand.ts
// White-label settings. Colours live in src/index.css (@theme).
// Values marked TODO are placeholders — confirm before going live.

export const brand = {
  appName: 'Local Octo',
  shortName: 'LO',
  logoUrl: `${import.meta.env.BASE_URL}logo.png`, // main logo (public/logo.png); favicons are in public/ too
  poweredBy: 'Local Octo',
  supportEmail: 'support@localocto.com', // TODO: confirm real support address
  bookCallUrl: '' as string, // optional Calendly/Cal.com link; empty = in-app form
  sendWindow: { start: '9 AM', end: '7 PM' },
  followUpGapDays: 3,
} as const
