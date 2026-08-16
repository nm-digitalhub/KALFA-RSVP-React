-- Inquiries become conversations.
--
-- WHY THIS IS ONE MIGRATION AND WHY IT COMES BEFORE THE `reopened` STATUS.
-- The plan originally deferred a messages table to "phase two" and shipped the
-- status change first. Reading the admin UI invalidated that: `sent_reply` is a
-- single column, so a second reply OVERWRITES the first, and the reply composer
-- is gated on `replied_at` being null, so a re-drafted reply is never displayed.
-- Reopening a thread without this table loses history and stalls silently — the
-- same silent stall the fleet trigger is carefully written to avoid one layer
-- up. So the conversation structure lands first, and the status change rides
-- along with it.

-- ── I5 · one inquiry, many messages ──────────────────────────────────────────
-- `contact_messages` keeps identity and workflow (who, status, routing); the
-- conversation itself moves here.
create table if not exists public.inquiry_messages (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.contact_messages(id) on delete cascade,
  -- inbound  = the customer wrote to us
  -- outbound = we sent (a human pressed send; drafts are NOT messages)
  -- draft    = the support-drafter proposed; never delivered, never customer-visible
  direction text not null check (direction in ('inbound', 'outbound', 'draft')),
  body text not null check (length(btrim(body)) > 0),
  -- RFC 5322 Message-ID of THIS message, when it has one. Lets an incoming
  -- reply attach by In-Reply-To without re-reading the mailbox.
  message_id text,
  author_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- The thread view reads one inquiry in order; this is the only access path.
create index if not exists inquiry_messages_thread_idx
  on public.inquiry_messages (inquiry_id, created_at);

create index if not exists inquiry_messages_message_id_idx
  on public.inquiry_messages (message_id) where message_id is not null;

alter table public.inquiry_messages enable row level security;

-- No policy for anon/authenticated ON PURPOSE, matching contact_messages: every
-- read goes through the server DAL behind requirePlatformPermission
-- ('view_customer_data'), and RLS here is the deny-by-default backstop rather
-- than the gate.

-- Backfill, so the thread view is correct for history and not only for new
-- inquiries. Preconditions were re-measured immediately before this ran — no
-- null created_at, no sent_reply without replied_at (which would have placed a
-- reply BEFORE the message it answers), no blank bodies to trip the CHECK.
insert into public.inquiry_messages (inquiry_id, direction, body, created_at)
select id, 'inbound', message, created_at
from public.contact_messages
where length(btrim(message)) > 0;

insert into public.inquiry_messages (inquiry_id, direction, body, created_at)
select id, 'outbound', sent_reply, coalesce(replied_at, created_at)
from public.contact_messages
where sent_reply is not null and length(btrim(sent_reply)) > 0;

-- Drafts carry over ONLY when they were never sent — a draft already superseded
-- by a sent reply is noise in a conversation view, not history.
insert into public.inquiry_messages (inquiry_id, direction, body, created_at)
select id, 'draft', draft_reply, coalesce(draft_created_at, created_at)
from public.contact_messages
where draft_reply is not null and length(btrim(draft_reply)) > 0
  and sent_reply is null;

-- The old single-valued columns STAY for now: distill-corrections reads the
-- draft_reply↔sent_reply pair, and the fleet trigger reads draft_reply. Dropping
-- them is a separate step once those consumers move. Writes go to both until
-- then — there is no dual source of truth, only a dual write.

-- ── I6 · ordering: a reopened inquiry must rise ──────────────────────────────
-- Ordering by created_at buried it at its original date, so a July thread the
-- customer answered today sank below everything. Maintained on write rather
-- than computed, so the admin list stays one indexed query.
alter table public.contact_messages
  add column if not exists last_activity_at timestamptz;

update public.contact_messages
set last_activity_at = greatest(created_at, coalesce(replied_at, created_at))
where last_activity_at is null;

alter table public.contact_messages
  alter column last_activity_at set default now();

alter table public.contact_messages
  alter column last_activity_at set not null;

create index if not exists contact_messages_activity_idx
  on public.contact_messages (last_activity_at desc);

-- ── D2 · the thread identity ─────────────────────────────────────────────────
-- Graph's conversationId groups a mail thread natively and stays stable across
-- replies, so storing it on first intake is what lets a later message in the
-- same thread attach to the existing inquiry instead of opening a second one.
-- Nullable: a web-form inquiry has no thread, and that is not a defect.
alter table public.contact_messages
  add column if not exists thread_id text;

create index if not exists contact_messages_thread_idx
  on public.contact_messages (thread_id) where thread_id is not null;

-- ── D3 · when the customer last wrote back ───────────────────────────────────
-- Compared against draft_created_at rather than tested for null, so a stale
-- draft from the previous round cannot make the row look handled. That
-- comparison is what keeps the fleet trigger firing on a reopened thread.
alter table public.contact_messages
  add column if not exists reply_needed_at timestamptz;
