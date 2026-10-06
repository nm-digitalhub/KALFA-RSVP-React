-- One Voximplant routing rule serves one calling purpose — enforced in the
-- database, not only in the admin form.
--
-- WHY THIS IS WORTH A CONSTRAINT. A rule id decides WHICH SCENARIO a call runs.
-- Give one rule to two purposes and the wrong scenario answers, silently: the
-- meeting-confirm dispatcher sends {to, from, tok, u} and the legacy DTMF RSVP
-- scenario reads exactly {to, from, tok, u}, so nothing rejects the payload. Its
-- ctx lookup 404s (different table), but VoxEngine.callPSTN sits outside that
-- check — so a real person is dialed and hears the event-RSVP flow with an empty
-- guest name, StartScenarios returns result:1, and the attempt is recorded as a
-- successful dial that then never closes.
--
-- The admin action validates this already (ruleIdAssignmentError). This is the
-- layer under it: the app-side check cannot see a direct DB write, a future code
-- path, or a hand-run SQL fix at 2am.

-- app_settings is a single-row table (id = true), so "distinct across columns"
-- is a row-level CHECK rather than a unique index. NULLs are unconstrained: an
-- unset rule id is the normal fail-closed state and two unset fields are not a
-- clash. Current values are 1520915 / 1523903 / 1523906 / 1523124 — already
-- pairwise distinct, so this validates without touching data.
alter table public.app_settings
  add constraint app_settings_voximplant_rule_ids_distinct check (
    (
      voximplant_rule_id is null
      or voximplant_rule_id <> coalesce(voximplant_meeting_confirm_rule_id, '')
    )
    and (
      voximplant_rule_id is null
      or voximplant_rule_id <> coalesce(voximplant_sales_call_rule_id, '')
    )
    and (
      voximplant_rule_id is null
      or voximplant_rule_id <> coalesce(voximplant_call_me_now_rule_id, '')
    )
    and (
      voximplant_meeting_confirm_rule_id is null
      or voximplant_meeting_confirm_rule_id
         <> coalesce(voximplant_sales_call_rule_id, '')
    )
    and (
      voximplant_meeting_confirm_rule_id is null
      or voximplant_meeting_confirm_rule_id
         <> coalesce(voximplant_call_me_now_rule_id, '')
    )
    and (
      voximplant_sales_call_rule_id is null
      or voximplant_sales_call_rule_id
         <> coalesce(voximplant_call_me_now_rule_id, '')
    )
  );

comment on constraint app_settings_voximplant_rule_ids_distinct on public.app_settings is
  'One Voximplant rule serves one purpose. Two purposes sharing a rule dial a real person with the wrong scenario and record it as success.';

-- Rule 1494311 is `OutCall`, the legacy DTMF RSVP scenario. It is stored in no
-- column, so the distinctness check above cannot see it — it needs naming.
-- CLAUDE.md: never point the AI bridge at it.
alter table public.app_settings
  add constraint app_settings_voximplant_rule_ids_not_dtmf check (
    coalesce(voximplant_rule_id, '') <> '1494311'
    and coalesce(voximplant_meeting_confirm_rule_id, '') <> '1494311'
    and coalesce(voximplant_sales_call_rule_id, '') <> '1494311'
    and coalesce(voximplant_call_me_now_rule_id, '') <> '1494311'
  );

comment on constraint app_settings_voximplant_rule_ids_not_dtmf on public.app_settings is
  'Rule 1494311 is the legacy DTMF OutCall flow and must never be given to an agent persona.';

-- Two voice purposes may not share a rule either. Partial, because:
--   * rule_id NULL is the normal state of a purpose that has not been wired yet;
--   * a built-in purpose never dials from this column (voice-purpose-dispatch
--     blocks it) and the DAL never writes it, so its row must not reserve an id.
create unique index if not exists voice_purposes_rule_id_unique
  on public.voice_purposes (rule_id)
  where rule_id is not null and is_builtin = false;

comment on index public.voice_purposes_rule_id_unique is
  'One rule, one purpose — partial so unwired (NULL) and built-in purposes are exempt.';

alter table public.voice_purposes
  add constraint voice_purposes_rule_id_not_dtmf check (
    coalesce(rule_id, '') <> '1494311'
  );

-- NOT DONE HERE, deliberately: a rule claimed in app_settings is not blocked
-- from voice_purposes, and vice versa. Enforcing across two tables needs a
-- trigger on both, and a trigger that raises inside an unrelated settings save
-- is a worse failure than the one it prevents. The admin action checks both
-- directions in one place (readRuleIdClaims), which is where a human can read
-- the error and fix it.
