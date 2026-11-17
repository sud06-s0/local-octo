-- supabase/migrations/20261117000003_remove_widgets_social.sql
-- Optional clean-up after removing Widgets, Social Posting and Websites from the app.
drop table if exists public.social_posts;
alter table public.businesses drop column if exists widgets;
alter table public.businesses drop column if exists social;
