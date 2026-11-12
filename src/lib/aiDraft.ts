// src/lib/aiDraft.ts
// PLACEHOLDER: template-based reply drafts so the UI works offline.
// Replace with a call to your Supabase Edge Function (Gemini / OpenAI) later.

import type { Review } from '../types'

export function draftReply(review: Review, businessName: string): string {
  const first = review.author.split(' ')[0]
  if (review.rating >= 4) {
    const variants = [
      `Thank you, ${first}, for the ${review.rating}-star rating and for choosing ${businessName}! We really appreciate your support and look forward to working with you again.`,
      `${first}, thanks so much for the kind words! It means a lot to the whole ${businessName} team. See you again soon!`,
      `We're thrilled you had a great experience, ${first}. Thank you for taking the time to leave a review for ${businessName}!`,
    ]
    return variants[Math.floor(Math.random() * variants.length)]
  }
  if (review.rating === 3) {
    return `Thank you for your feedback, ${first}. We're glad parts of your experience went well, and we'd love to hear how ${businessName} can do better. Please reach out to us directly so we can make it right.`
  }
  return `${first}, we're sorry your experience with ${businessName} didn't meet expectations. This isn't the standard we aim for. Please contact us directly so we can understand what happened and fix it.`
}
