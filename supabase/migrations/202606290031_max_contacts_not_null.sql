-- H1: campaigns.max_contacts NOT NULL — defense-in-depth for the billing count cap.
--
-- The SET membership is the PRIMARY cap on `reached` (0029), but a NULL
-- max_contacts disables the SECONDARY count guard (`v_count >= v_max` is NULL ⇒
-- falsy ⇒ no cap) — the Phase-2 verify panel flagged this. createCampaign and
-- prepareCampaignHold already set max_contacts non-null; live introspection shows
-- ZERO null rows, so this is a clean constraint tighten (the UPDATE is a safe
-- no-op kept for idempotency).

update public.campaigns set max_contacts = 0 where max_contacts is null;
alter table public.campaigns alter column max_contacts set not null;
