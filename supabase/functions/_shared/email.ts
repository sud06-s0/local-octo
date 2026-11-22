// supabase/functions/_shared/email.ts
// Review-request emails through Google Workspace (Gmail SMTP, port 465 — Edge Functions block ports 25 and 587).
// Secrets: GMAIL_USER + GMAIL_APP_PASSWORD = the account that signs in (Google Account → Security → App passwords).
// Optional GMAIL_FROM = a different address customers see (e.g. reviews@localocto.com). It must be added to that
// account in Gmail → Settings → Accounts → "Send mail as" (or as a Workspace alias), otherwise Gmail uses GMAIL_USER.
// The sender name shown to the customer is the business name.

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

export interface GmailConfig {
  user: string
  pass: string
  /** address shown as the sender; defaults to user */
  from?: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Email body: optional photo, the message (its link shown as "Leave a review"), and a big button. */
export function reviewEmailHtml(opts: { businessName: string; message: string; link: string; imageUrl?: string }): string {
  const { businessName, message, link, imageUrl } = opts
  const linkHtml = `<a href="${esc(link)}" style="color:#7c3aed;font-weight:600">Leave a review</a>`
  const body = message
    .split(link)
    .map((part) => esc(part).replace(/\n/g, '<br>'))
    .join(linkHtml)
  return `<!DOCTYPE html><html><body style="margin:0;background:#f6f5fa;font-family:Arial,Helvetica,sans-serif;color:#1f1b2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5fa;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
${imageUrl ? `<tr><td><img src="${esc(imageUrl)}" alt="" width="520" style="display:block;width:100%;height:auto;border:0"></td></tr>` : ''}
<tr><td style="padding:28px 28px 8px;font-size:16px;line-height:1.6">${body}</td></tr>
<tr><td align="center" style="padding:16px 28px 32px">
<a href="${esc(link)}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 32px;border-radius:10px">Leave a review</a>
</td></tr>
<tr><td style="padding:0 28px 24px;font-size:12px;color:#8a8597;text-align:center">${esc(businessName)}</td></tr>
</table></td></tr></table></body></html>`
}

export async function sendGmail(
  cfg: GmailConfig,
  msg: { to: string; fromName: string; subject: string; text: string; html: string },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const client = new SMTPClient({
    connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: cfg.user, password: cfg.pass } },
  })
  try {
    // Quotes keep commas etc. in the business name from breaking the From header
    const name = msg.fromName.replace(/["\r\n]/g, '').trim() || 'Reviews'
    await client.send({ from: `"${name}" <${cfg.from || cfg.user}>`, to: msg.to, subject: msg.subject, content: msg.text, html: msg.html })
    return { ok: true, id: '' }
  } catch (e) {
    return { ok: false, error: `Gmail: ${e instanceof Error ? e.message : String(e)}` }
  } finally {
    try {
      await client.close()
    } catch {
      /* already closed */
    }
  }
}
