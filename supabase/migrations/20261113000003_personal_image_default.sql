-- supabase/migrations/20261113000003_personal_image_default.sql
-- New businesses start with Personalized Image ON (customer's name on the business photo, or the demo photo).
-- Existing businesses keep their current setting; turn it on from the Messaging page.

alter table public.businesses alter column messaging set default jsonb_build_object(
  'mode', 'smart',
  'ownerFirstName', '',
  'businessName', '',
  'personalizedImage', true,
  'imageDataUrl', null,
  'customMessage', 'Hey {first_name}, we hope you enjoyed your experience with {business_name}! Would you mind taking a moment to leave a review? Here''s the link: {review_link}',
  'customFollowUp', 'Hi {first_name}, just a quick reminder — your feedback means a lot to us! {review_link}',
  'followUpsEnabled', true
);
