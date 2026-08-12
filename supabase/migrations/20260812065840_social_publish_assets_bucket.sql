-- Private storage bucket for the SHORT-LIVED, hash-pinned marketing image
-- publish-social signs a URL for at Instagram publish time only (plan
-- social-publish-live-stage-plan.md §2.5 — Option A', supersedes the
-- public=true design in fleet-social-publishing-capability-plan.md §4.6).
--
-- public: false — same posture as event-media/id-documents/vox-call-logs
-- (ALL THREE existing buckets in this project are private; this is the
-- first, not an exception). No storage.objects RLS policy is created: only
-- service_role (used exclusively inside cmdPublishSocial) ever reads or
-- writes here — same "zero policies, service_role only" pattern as every
-- other bucket. image_url is resolved via a short-lived createSignedUrl()
-- call, never getPublicUrl().
--
-- Fallback documented, not applied: if the discriminating test (plan §2.7)
-- shows Meta's fetcher rejects a signed (query-string-token) URL, the
-- one-line fix is `update storage.buckets set public = true where id =
-- 'social-publish-assets';` — still no `create policy` needed even then
-- (Supabase's own docs: public buckets "are already publicly accessible"
-- without one) — and swap createSignedUrl(...) for getPublicUrl(...) at the
-- one call site (resolveInstagramImageUrl, scripts/fleet-agent-cli.ts).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'social-publish-assets',
  'social-publish-assets',
  false,
  10485760, -- 10MB — one post image, not a whole batch
  array['image/jpeg', 'image/png']
)
on conflict (id) do nothing;
