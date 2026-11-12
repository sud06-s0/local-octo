<!-- README.md -->
# Local Octo — Web App (dashboard)

React 19 + Vite + TypeScript + Tailwind CSS v4, with a Supabase backend (Postgres + RLS, Edge Functions).
Without Supabase env vars it runs in demo mode on sample data. **Go-live steps: see [SETUP.md](SETUP.md).**

## Run
```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # production build in dist/ (upload to Hostinger, .htaccess included)
npm run build:preview  # hash-URL build that runs from any folder
```

## Where things live
- `src/config/brand.ts` — white-label settings (name, support email, referral reward, widget URL). TODO values need confirming.
- `src/index.css` — theme colours (`--color-brand-*`) and font
- `src/data/mockData.ts` — SAMPLE data (contacts, reviews, portfolio, plans). Replace with Supabase.
- `src/store/AppStore.tsx` — app state + actions; each action becomes a Supabase call later
- `src/lib/aiDraft.ts` — placeholder AI reply drafts; swap for an Edge Function (Gemini/OpenAI)
- `src/components/layout` — sidebar, mobile drawer, dropdowns
- `src/components/ui` — buttons, cards, toggles, modal, toast, phone mockup, colour picker
- `src/pages` — one file per screen

- `src/lib/supabase.ts` — Supabase client; live mode turns on when `.env.local` has the URL + publishable key
- `src/store/AuthProvider.tsx` — sign-in session; `src/pages/Login.tsx`, `src/pages/Onboarding.tsx`

## Backend (`supabase/`)
- `migrations/20261112000001_init.sql` — multi-business schema, RLS, RPCs (`create_business`, `add_contacts`, `regenerate_api_key`, `claim_due_contacts`), storage bucket
- `functions/dispatch` — cron-job.org calls it every minute; sends due requests + follow-ups (9 AM–7 PM per business timezone)
- `functions/r` — review-link redirect + click tracking (stops follow-ups)
- `functions/contacts-webhook` — add contacts from Zapier/Pabbly/CRMs with an API key
- `functions/whatsapp-webhook` — Meta delivery statuses + STOP opt-outs
- `functions/send-test`, `functions/ai-reply`, `functions/widget` (embed script for client websites)
- `functions/_shared/send.ts` — WhatsApp Cloud API + MSG91 SMS/email senders
