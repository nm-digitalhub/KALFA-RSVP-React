-- console_agent_secrets — the Voximplant SDK password of one console agent.
--
-- WHY PER AGENT, not one shared identity. VoxEngine brings a human into a live
-- call with `callUser({ username })` — it addresses ONE user. With a shared
-- identity there is no way to ring the agent who claimed a call: every device
-- registered under that identity is equally the target, and the coordination
-- columns already on console_call_feed (handled_by, takeover_claimed_at,
-- participation_state) exist precisely to stop two agents claiming one call.
-- They are meaningless without distinct identities. console_agents.vox_username
-- was already per-agent; this is its missing other half.
--
-- WHY ITS OWN TABLE rather than a column on console_agents: that table is read
-- through the console_me view, which is exposed to the app. A password column
-- there is one careless `select *` away from shipping the secret to a client.
-- Here the blast radius is a table no client role can touch at all.
--
-- WHY NOT app_settings: that is for PLATFORM-wide secrets (one SUMIT key, one
-- WhatsApp token). This is per-subject and keyed on a user.
create table if not exists public.console_agent_secrets (
  -- One secret per console agent. ON DELETE CASCADE: removing someone from the
  -- console must not leave their credential behind.
  user_id       uuid primary key
                  references public.console_agents (user_id) on delete cascade,
  -- Plaintext, and it must be: the one-time-key login hashes
  -- MD5(user:voximplant.com:password) server-side, so the password itself is the
  -- input. There is no hash we could store instead — the protocol needs the
  -- original. It never leaves the server; /api/agents/sdk-auth answers with a
  -- hash only.
  vox_password  text not null check (length(vox_password) between 8 and 200),
  created_at    timestamptz not null default now(),
  rotated_at    timestamptz
);

-- Closed to every client role. Only the service-role writer (provisioning) and
-- reader (the sdk-auth hash) ever touch it. RLS is belt to the grants' braces:
-- with no policy at all, even a future grant would still deny.
alter table public.console_agent_secrets enable row level security;
revoke all on public.console_agent_secrets from anon;
revoke all on public.console_agent_secrets from authenticated;

comment on table public.console_agent_secrets is
  'Voximplant SDK password per console agent. Service-role only; never exposed to a client. Input to the one-time-key hash — see docs/voice-agent/sdk-auth-implementation-plan.md.';
