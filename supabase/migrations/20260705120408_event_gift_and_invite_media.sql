-- Gift-reminder + media-invite event fields (owner decisions 2026-07-05;
-- templates kalfa_event_gift_v1 / kalfa_event_invite_media_v1, both PENDING
-- at Meta at authoring time).
--
-- gift_payment_url  — the owner's own PayBox/Bit link (per-event business
--                     data, never hardcoded); https-only here, Zod re-checks
--                     at the boundary.
-- gift_link_token   — opaque token behind the template's URL button
--                     (https://beta.kalfa.me/g/{token} → 302 to
--                     gift_payment_url); same default pattern as
--                     guests.rsvp_token. Server-generated only.
-- invite_image_path — PRIVATE storage path (bucket event-media) of the
--                     event's invitation image; delivered to Meta as a
--                     short-lived signed URL at send time.

alter table public.events
  add column if not exists gift_payment_url text
    constraint events_gift_payment_url_https check (
      gift_payment_url is null or gift_payment_url ~* '^https://'
    ),
  add column if not exists gift_link_token text not null
    default encode(gen_random_bytes(16), 'hex'),
  add column if not exists invite_image_path text;

create unique index if not exists events_gift_link_token_key
  on public.events (gift_link_token);

-- The phase-3 RLS migration (20260705115539) narrows UPDATE on events to an
-- explicit column list, and it sorts BEFORE this file — so the two new
-- owner-editable columns need their own column grant. gift_link_token stays
-- server-generated: deliberately NOT granted.
grant update (gift_payment_url, invite_image_path)
  on public.events to authenticated;

-- Private bucket for event media (invitation images). No storage RLS policies
-- on purpose: only the service-role client touches it (same discipline as the
-- id-documents bucket); guests never see a storage URL — Meta receives a
-- short-lived signed URL per send batch.
insert into storage.buckets (id, name, public)
values ('event-media', 'event-media', false)
on conflict (id) do nothing;
