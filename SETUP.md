<!-- SETUP.md -->
# Local Octo — Backend setup (Supabase + MSG91 + WhatsApp + cron-job.org)

Follow the steps in order. Commands run from the project folder (`local-octo-app/`).
`REF` below = your Supabase project ref (the part before `.supabase.co`).

---

## 1. Create the Supabase project
1. supabase.com → **New project**. Region: **Mumbai (ap-south-1)** for Indian customers.
2. **Project Settings → API Keys**. If you see *Create new API keys*, click it. Copy:
   - Project URL → `https://REF.supabase.co`
   - **Publishable key** (`sb_publishable_…`) → goes in the frontend
   - Secret key (`sb_secret_…`) → never put this in the frontend. Edge Functions get it automatically.

## 2. Create the database
**Option A, no CLI:** open **SQL Editor → New query**, paste all of
`supabase/migrations/20261112000001_init.sql`, and click **Run**. Then do the same with
`supabase/migrations/20261113000001_whatsapp_templates.sql` and `supabase/migrations/20261113000002_wa_manual_templates.sql`, which add custom WhatsApp templates.

**Option B, CLI:**
```bash
npx supabase login
npx supabase link --project-ref REF
npx supabase db push
```

This creates the tables, Row Level Security (each business sees only its own data), the RPCs and the `business-assets` storage bucket.

## 3. Auth settings
**Authentication → URL Configuration**
- Site URL: `https://app.localocto.com` (or wherever the app is hosted)
- Redirect URLs: add the same URL, plus `http://localhost:5173` for local work.

**Authentication → Emails:** Supabase's built-in mailer is rate-limited. For real users, set **Custom SMTP** (MSG91 SMTP or Google Workspace) so sign-up and reset emails arrive reliably.

## 4. Deploy the Edge Functions
```bash
npx supabase login
npx supabase link --project-ref REF
npx supabase functions deploy
```
This deploys all 9 functions. `supabase/config.toml` turns the gateway JWT check off because each function checks auth itself.

| Function | Who calls it | Auth |
|---|---|---|
| `dispatch` | cron-job.org, every minute | `x-cron-secret` header |
| `r` | customers clicking the review link | public (token in URL) |
| `contacts-webhook` | Zapier / Pabbly / CRMs | `x-api-key` (create on Integrations page) |
| `whatsapp-webhook` | Meta | verify token + app-secret signature |
| `send-test` | app "Send Test Message" | signed-in user |
| `ai-reply` | app "Draft with AI" | signed-in user |
| `widget` | client websites | public key in URL |
| `review-image` | WhatsApp / email (downloads the personalised photo) | contact token or signed URL |
| `wa-template` | app: submits Custom Messages to Meta, "Check WhatsApp" status | signed-in user |

## 5. Set secrets
Fill in what you have now and add the rest later. Missing channels are skipped.
```bash
npx supabase secrets set \
  CRON_SECRET="$(openssl rand -hex 24)" \
  MSG91_AUTH_KEY="your-msg91-authkey" \
  MSG91_EMAIL_DOMAIN="mail.localocto.com" \
  MSG91_EMAIL_FROM="reviews@mail.localocto.com" \
  MSG91_EMAIL_FROM_NAME="Local Octo" \
  MSG91_EMAIL_TEMPLATE_ID="review_request" \
  MSG91_SMS_TEMPLATE_INITIAL="msg91-flow-template-id" \
  MSG91_SMS_TEMPLATE_FOLLOWUP="msg91-flow-template-id" \
  WHATSAPP_PHONE_NUMBER_ID="1234567890" \
  WHATSAPP_ACCESS_TOKEN="EAAG..." \
  WHATSAPP_TEMPLATE_INITIAL="review_request" \
  WHATSAPP_TEMPLATE_INITIAL_IMAGE="review_request_image" \
  WHATSAPP_TEMPLATE_FOLLOWUP="review_followup" \
  WHATSAPP_TEMPLATE_LANG="en" \
  WHATSAPP_VERIFY_TOKEN="$(openssl rand -hex 16)" \
  WHATSAPP_WABA_ID="your-whatsapp-business-account-id" \
  WHATSAPP_APP_SECRET="meta-app-secret" \
  AI_PROVIDER="gemini" \
  GEMINI_API_KEY="..."
```
Optional: `WHATSAPP_API_VERSION` (default `v23.0`), `GEMINI_MODEL`, `OPENAI_API_KEY` + `OPENAI_MODEL` (with `AI_PROVIDER=openai`),
`IMAGE_SIGNING_SECRET` (signs test-image links; defaults to CRON_SECRET), `FOLLOW_UP_GAP_DAYS` (default 3), `DISPATCH_PER_BUSINESS` (default 20 per minute, which paces reactivation lists), `LINK_BASE_URL` (custom short domain for review links), `WIDGET_POWERED_BY`.

Run `npx supabase secrets list` to check. Run `echo` on CRON_SECRET before setting it, or set your own value, because cron-job.org needs the same string.

**Sending order per contact:** WhatsApp if a phone number exists → SMS if WhatsApp fails or isn't set up → email if there's no phone or both fail.

**Per-business sender (optional, for resold accounts):** insert a row into `business_channels` from the SQL Editor to give one business its own WhatsApp number or email sender. Empty columns fall back to the secrets above. The browser can never read this table.

## 6. cron-job.org
Create a cron job:
- URL: `https://REF.supabase.co/functions/v1/dispatch`
- Schedule: **every 1 minute**
- Request method: POST
- Header: `x-cron-secret` = your CRON_SECRET
- Turn on failure notifications.

Each run sends what is due, only between **9 AM and 7 PM in each business's timezone** (default Asia/Kolkata). Each response shows `claimed / sent / failed`, so you can check the run history in cron-job.org.

## 7. MSG91
**Email**
1. MSG91 → Email → **Domains**: add `mail.localocto.com` and add the DNS records it gives you in Hostinger. Wait for it to verify.
2. Email → **Templates** → create `review_request`. Subject: `How was your experience with {{business_name}}?`
   Body (variables must match exactly):
   ```
   {{message}}
   [Leave a review]({{review_link}})
   ```
   To show the personalised photo, add this at the top of the body (HTML editor): `<img src="{{image_url}}" width="400" style="border-radius:12px">`.
   The app fills `{{message}}` with the Smart or Custom message from the Messaging page. Also available: `{{first_name}}`, `{{business_name}}`, `{{image_url}}`. `image_url` is empty for follow-ups.

**SMS (India: DLT is mandatory)**
1. Register your sender ID (header) and templates on a DLT portal (Jio, Airtel, Vi and others). Example template:
   `Hi {#var#}, thanks for choosing {#var#}! Please share a quick Google review: {#var#} - LOCTO`
2. MSG91 → SMS → **Templates**: add it with the DLT template ID. Use the variables `##name##`, `##business##`, `##link##` in that order.
3. Put the MSG91 template IDs in `MSG91_SMS_TEMPLATE_INITIAL` and `_FOLLOWUP`.

## 8. WhatsApp (Meta Cloud API)
1. developers.facebook.com → create a **Business** app → add **WhatsApp**. Add and verify your business phone number.
2. Business Settings → **System users** → create one, give it the app and WhatsApp account, and generate a **permanent token** with `whatsapp_business_messaging` and `whatsapp_business_management`. Use it as `WHATSAPP_ACCESS_TOKEN`.
3. Copy the **Phone number ID**, not the number itself, into `WHATSAPP_PHONE_NUMBER_ID`.
4. WhatsApp Manager → **Message templates**: create two templates, language English (`en`):
   Meta rejects a template whose body **starts or ends with a variable**, so each body ends with fixed text after `{{3}}`.
   - `review_request`: `Hi {{1}}, thanks for choosing {{2}}! Would you mind taking a moment to leave us a Google review? {{3}} Thank you!`
   - `review_request_image`: **Header = Image** (upload any sample photo when creating it), body the same as `review_request`. This one is used when the business has uploaded a photo and turned on **Personalized Image**. The customer then gets the photo with their name on it, with the text underneath, in one message.
   - `review_followup`: `Hi {{1}}, just a quick reminder from {{2}} — your feedback means a lot to us! {{3}} Thank you!`
   Meta usually puts these in the **Marketing** category, which is charged per message.
5. App → WhatsApp → **Configuration → Webhook**:
   - Callback URL: `https://REF.supabase.co/functions/v1/whatsapp-webhook`
   - Verify token: your `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to the **messages** field. Delivery ticks then update the `messages` table, and a customer replying **STOP** goes onto Do Not Contact.
   - Also subscribe to **message_template_status_update**, so Custom Message approvals show up in the app straight away.
6. App Settings → Basic → **App secret**: use it as `WHATSAPP_APP_SECRET`, so fake webhook calls are rejected.

## 9. Frontend
```bash
cp .env.example .env.local   # fill VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
npm install
npm run dev                  # http://localhost:5173 → sign up → create your business
npm run build                # upload dist/ (includes .htaccess) to e.g. app.localocto.com on Hostinger
```
Without the two env vars, the app runs in **demo mode** on sample data.

**Make yourself Local Octo admin** (you'll see every client business): sign up once, then run this in the SQL Editor:
```sql
update public.profiles set is_platform_admin = true where email = 'you@localocto.com';
```

## 10. Test it end to end
1. Dashboard → pencil icon → paste the business's **Google review link**. Nothing is sent without it.
2. Messaging → **Send Test Message** to your own phone or email.
3. Add Contacts → add yourself → within a minute (between 9 AM and 7 PM) cron-job.org runs `dispatch` and you get the request.
4. Tap the link → you land on Google → Contacts shows **Clicked** and follow-ups stop.
5. Integrations → **Create API key** → test the webhook:
   ```bash
   curl -X POST https://REF.supabase.co/functions/v1/contacts-webhook \
     -H "x-api-key: lo_live_..." -H "Content-Type: application/json" \
     -d '{"first_name":"Priya","phone":"9845011223"}'
   ```

---

## Custom Messages on WhatsApp
WhatsApp only lets a business start a chat with a template Meta has approved. **Approval happens in WhatsApp Manager. The app only checks the status.** Only `WHATSAPP_WABA_ID` and the access token are needed; no App ID.

When a client saves a **Custom Message** or **Custom Follow-up** (Messaging page):
- **Text versions** (first message, follow-up) are submitted to Meta automatically. `{first_name}` and `{review_link}` become `{{1}}`, `{{2}}`; `{business_name}` and `{owner_name}` are written in as fixed text. "Hi" or "Thank you!" is added if the text would start or end with a variable, because Meta rejects that.
- **Photo version** (first message with photo): the app shows an exact **template name** and **body** with copy buttons. Create it once in **WhatsApp Manager → Message templates → Create** with category Marketing, the same language, Header = **Image** (any sample photo), and that name and body.
- **Check WhatsApp** looks every template up by name in your WhatsApp account and shows **Approved · ready to send**, **Waiting for approval** or **Rejected (reason)**. With the webhook subscribed to `message_template_status_update`, this also updates by itself.
- Only approved templates are used. Until then the standard templates are sent, so nothing stops.

## Personalised image: how it works
Messaging page → **Personalized Image** on → upload a photo of the owner or team. For every initial request, the `review-image` function builds an 800×600 JPEG: the photo with **"Priya!"** on a white label, the same look as the phone preview.
- **WhatsApp:** sent as the image header of `review_request_image`, with the text below.
- **Email:** shown through `{{image_url}}`.
- **SMS:** text only. Indian SMS (DLT) can't carry images and carriers don't support MMS.
- Follow-ups are text only.
- Names in non-Latin scripts (for example Bengali or Hindi) show **"Thank you!"** instead, because the embedded font covers Latin letters only.

## Not built yet (needs outside approval or a next phase)
- **Pulling Google reviews and posting replies to Google** needs Google Business Profile API access. Apply at the Google Business Profile API page; approval takes a few weeks. Until then:
  - The `reviews` table stays empty unless you insert rows by hand.
  - Replies written in the app are saved but not posted to Google.
  - Example insert to test the Reviews page and widgets:
    `insert into reviews (business_id, author, rating, text) values ('BUSINESS_ID', 'Test Customer', 5, 'Great service!');`
- **Auto-posting to Facebook and Instagram:** posts are recorded as *scheduled*, but publishing needs Meta app review for `pages_manage_posts` and `instagram_content_publish`.
- **Integrations page Connect buttons** for Jobber, Housecall Pro and the rest only save a status flag. The webhook and API key are real.
- **Billing and plan limits** (Cashfree, 50/100/300 requests a month) and **team invites** are not built.
