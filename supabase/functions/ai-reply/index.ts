// supabase/functions/ai-reply/index.ts
// Drafts a reply to a Google review. Body: { reviewId }. Returns { text }.
// Provider: AI_PROVIDER=gemini (default) with GEMINI_API_KEY, or AI_PROVIDER=openai with OPENAI_API_KEY.
// Model names are env-configurable (GEMINI_MODEL / OPENAI_MODEL) so they can be updated without a redeploy.

import { adminClient, getUser, isMember } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'

function prompt(business: string, author: string, rating: number, text: string): string {
  return [
    `You write replies to Google reviews for a local business called "${business}".`,
    `Write a reply to this ${rating}-star review by ${author}.`,
    text ? `Review text: """${text.slice(0, 2000)}"""` : 'The review has a rating but no text.',
    'Rules: 2-3 sentences, warm and professional, use the reviewer\'s first name once, mention the business name once.',
    rating <= 3
      ? 'Apologise sincerely, do not argue or admit legal fault, and invite them to contact the business directly to make it right.'
      : 'Thank them specifically for what they mentioned.',
    'Do not use hashtags, emojis, placeholders or quotation marks. Reply with the text only.',
  ].join('\n')
}

async function gemini(p: string): Promise<string> {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash'
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: p }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 300 } }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error?.message ?? `Gemini HTTP ${res.status}`)
  return (body?.candidates?.[0]?.content?.parts ?? []).map((x: { text?: string }) => x.text ?? '').join('').trim()
}

async function openai(p: string): Promise<string> {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) throw new Error('OPENAI_API_KEY is not set')
  const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini'
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0.7, max_tokens: 300, messages: [{ role: 'user', content: p }] }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error?.message ?? `OpenAI HTTP ${res.status}`)
  return String(body?.choices?.[0]?.message?.content ?? '').trim()
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const admin = adminClient()
  const user = await getUser(req, admin)
  if (!user) return json({ error: 'Sign in required' }, 401)

  const { reviewId } = (await req.json().catch(() => ({}))) as { reviewId?: string }
  if (!reviewId) return json({ error: 'reviewId is required' }, 400)

  const { data: review } = await admin
    .from('reviews')
    .select('business_id, author, rating, text, businesses(name, ai)')
    .eq('id', reviewId)
    .maybeSingle()
  if (!review) return json({ error: 'Review not found' }, 404)
  if (!(await isMember(admin, user.id, review.business_id))) return json({ error: 'Not allowed' }, 403)

  const b = review.businesses as unknown as { name: string; ai: { nickname?: string } }
  const businessName = b?.ai?.nickname || b?.name || 'our business'

  try {
    const p = prompt(businessName, review.author, review.rating, review.text)
    const text = (Deno.env.get('AI_PROVIDER') ?? 'gemini').toLowerCase() === 'openai' ? await openai(p) : await gemini(p)
    if (!text) throw new Error('Empty reply from AI')
    return json({ text })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'AI request failed' }, 502)
  }
})
