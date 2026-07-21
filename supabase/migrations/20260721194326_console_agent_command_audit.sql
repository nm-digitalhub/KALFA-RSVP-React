-- console_agent_commands — who intervened in a live call, when, and how.
--
-- THE GAP THIS CLOSES. POST /api/calls/{id}/agent-command lets a console agent
-- inject text into a call that is in progress with a real guest — a whisper the
-- AI acts on ("tell them the venue changed"), a user turn, a barge-in, or a
-- close of the AI leg. It recorded NOTHING: no actor, no timestamp, no call, no
-- content. An intervention that can change what a guest is told left no trace.
--
-- That is a stronger case for auditing than listening is. A monitor watches; a
-- whisper CHANGES THE CALL.
--
-- WHY NOT human_agent_call_legs. That table models a LEG — an audio presence
-- with connected_at / disconnected_at / vox_sdk_call_id, and a CHECK pinning
-- mode to monitor|takeover. A command is not a leg: it is instantaneous, has no
-- duration and no SDK call id. Forcing it in would leave most columns
-- permanently null and blur what the row means. Two shapes, because these are
-- two different things: presence over time vs. a discrete act.
--
-- WHY THE TEXT IS STORED, unlike support_access_log which deliberately never
-- stores the data a staff member SAW. The distinction is what the content is:
-- there it is the CUSTOMER's data, and recording it would copy the exposure into
-- the audit trail. Here the content is the STAFF MEMBER'S OWN WORDS — what they
-- chose to say into someone else's conversation. An audit that cannot answer
-- "what did they say" does not answer "what did they do", and this is precisely
-- the action worth being able to reconstruct. Bounded to the same 1000 chars the
-- request schema already enforces.
--
-- `delivered` and `applied` keep the honest distinction the API makes: reaching
-- the live session is NOT evidence the model acted on it, and for
-- contextual_update / user_message no such evidence will ever arrive.
create table if not exists public.console_agent_commands (
  id               uuid primary key default gen_random_uuid(),
  -- The acting console agent (auth uid). Not nullable: a row without an actor is
  -- not an audit row.
  agent_id         uuid not null references auth.users (id) on delete restrict,
  call_attempt_id  uuid not null references public.call_attempts (id) on delete cascade,
  event_id         uuid references public.events (id) on delete set null,
  command          text not null check (
                     command in ('contextual_update','user_message','clear_buffer','close_agent')
                   ),
  -- Present only for the two text-bearing commands; null for clear_buffer and
  -- close_agent, which carry no payload.
  command_text     text check (command_text is null or length(command_text) <= 1000),
  request_id       uuid not null,
  delivered        boolean not null,
  -- 'pending' | 'confirmed' | 'rejected' — mirrors AppliedState in
  -- src/lib/validation/agent-console.ts. pending is the resting state for the
  -- text commands, permanently, and that is truthful rather than unfinished.
  applied          text not null default 'pending'
                     check (applied in ('pending','confirmed','rejected')),
  created_at       timestamptz not null default now()
);

create index if not exists console_agent_commands_call_idx
  on public.console_agent_commands (call_attempt_id, created_at desc);
create index if not exists console_agent_commands_agent_idx
  on public.console_agent_commands (agent_id, created_at desc);

-- Append-only from the application's side: the writer is the route, through the
-- service-role client. No client role may read or write it — the trail exists to
-- be read by an owner/admin surface later, never by the console that writes it.
alter table public.console_agent_commands enable row level security;
revoke all on public.console_agent_commands from anon;
revoke all on public.console_agent_commands from authenticated;

comment on table public.console_agent_commands is
  'Audit of console-agent interventions in live calls (whisper / inject / barge-in / close AI leg). Written by /api/calls/{id}/agent-command. See docs/voice-agent/sdk-auth-implementation-plan.md.';
