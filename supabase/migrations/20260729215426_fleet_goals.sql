-- Persistent goal + self-scheduling for the autonomous fleet.
-- Plan: .claude/plans/agile-juggling-hollerith.md, Part 1.

create table public.fleet_goals (
  id                   uuid        primary key default gen_random_uuid(),
  role                 text        not null,
  title                text        not null,
  body                 text        not null,
  status               text        not null default 'active',

  -- הזיכרון המובנה בין ריצות. הסוכן קורא בתחילת ריצה, כותב בסופה.
  -- מפתחות מוסכמים: done[] · remaining[] · next_action · findings — מוסכמת
  -- פרומפט, לא נאכפת כאן (רק jsonb_typeof=object, ראה 1.1 למטה). החוזה
  -- המלא, כולל דוגמת append-vs-rewrite, מוזרק לסוכן ב-run-context.sh §3.3.
  state                jsonb       not null default '{}'::jsonb,

  -- מנוע התזמון העצמי. null = לא מתוזמן (ממתין לסלוט או לבעלים).
  next_wake_at         timestamptz,

  -- ההגדר (CAS). integer ולא smallint: מטרה ארוכת-טווח יכולה לצבור צעדים,
  -- ו-32767 הוא גבול שאין סיבה להתקרב אליו.
  step_count           integer     not null default 0,

  consecutive_failures smallint    not null default 0,
  last_error           text,
  created_by           uuid        references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  closed_at            timestamptz,

  constraint fleet_goals_status_check
    check (status in ('active','paused','completed','failed')),

  -- שם התפקיד נכנס לשאילתת הטריגר בתזמן ע"י החלפת מחרוזת. האילוץ הזה הוא
  -- שכבת ההגנה השנייה מול הזרקה (הראשונה היא ROLE_NAME_RE ב-scheduler.mjs).
  constraint fleet_goals_role_shape   check (role ~ '^[a-z0-9][a-z0-9-]*$'),

  constraint fleet_goals_title_len    check (char_length(title) between 3 and 200),
  constraint fleet_goals_body_len     check (char_length(body) between 10 and 8000),
  constraint fleet_goals_counters     check (step_count >= 0 and consecutive_failures >= 0),

  -- '{}' תקין; '"null"', '[]' או מספר — לא. מונע ריצה שנשברת על קריאת state.
  constraint fleet_goals_state_object check (jsonb_typeof(state) = 'object'),

  -- מניעת לולאה #1: מטרה סגורה לא מחזיקה שעון מעורר. בלי זה מטרה שהושלמה
  -- ממשיכה להעיר את הסוכן לנצח.
  --
  -- שלושה ענפים, לא שניים: 'active' ו-'paused' נפרדו כי הם דורשים ניגוד.
  -- מטרה מושהית *חייבת* next_wake_at ריק (fleet_goal_pause מאפס אותו
  -- בכוונה — זו הדרך שהיא יוצאת מ-fleet_goals_due_idx), אבל מטרה active
  -- עם next_wake_at ריק היא קורבן יתום: לא due אצל התזמן (NULL <= now()
  -- אינו אמת), ולא נראית ל-goal-poll. בלי הענף הזה, סוכן שקורא ל-
  -- fleet_goal_progress עם --next-wake-at ריק בזמן שהמטרה עדיין active
  -- (באג, לא נטישה מכוונת) היה משאיר שורה "פעילה" לנצח שאיש לא יתעורר
  -- עבורה שוב.
  constraint fleet_goals_terminal_coherent check (
    (status = 'active' and closed_at is null and next_wake_at is not null)
    or
    (status = 'paused' and closed_at is null)
    or
    (status in ('completed','failed') and closed_at is not null and next_wake_at is null)
  )
);

-- מה שהופך את שאילתת הטיק (כל 60 שניות, פר תפקיד ריאקטיבי) לחיפוש אינדקס.
-- חלקי בכוונה: מטרות סגורות או מושהות לא נכנסות כלל, כך שהוא לא גדל עם ההיסטוריה.
create index fleet_goals_due_idx
  on public.fleet_goals (role, next_wake_at)
  where status = 'active' and next_wake_at is not null;

-- לטבלת ה-UI ב-/admin/fleet
create index fleet_goals_role_created_idx
  on public.fleet_goals (role, created_at desc);

create or replace function public.fleet_goals_guard()
returns trigger language plpgsql set search_path to '' as $$
begin
  -- CHECK רואה גרסת שורה אחת; זהו כלל על המעבר בין שתיים.
  -- בלי זה, קריאה שגויה יכולה להוריד את ההגדר ולפתוח מחדש חלון לכתיבה כפולה.
  if new.step_count < old.step_count then
    raise exception using errcode = '23514',
      message = format('fleet_goals: step_count may not decrease (%s -> %s)',
                       old.step_count, new.step_count);
  end if;

  -- מצב סופי הוא סופי. אין חזרה ל-active אלא דרך הבעלים ב-UI (שמריץ RPC ייעודי).
  if old.status in ('completed','failed') and new.status <> old.status then
    raise exception using errcode = '23514',
      message = format('fleet_goals: %s is terminal', old.status);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger fleet_goals_guard
  before update on public.fleet_goals
  for each row execute function public.fleet_goals_guard();

alter table public.fleet_goals enable row level security;

-- זהה ל-fleet_requests: קריאה לאדמין בלבד, אפס כתיבה מהדפדפן.
create policy fleet_goals_admin_select on public.fleet_goals
  for select using (public.has_role(auth.uid(), 'admin'::public.app_role));

revoke all on public.fleet_goals from anon, authenticated;
grant select on public.fleet_goals to authenticated;

-- RPC א׳ — יצירה. רק הבעלים.
create or replace function public.fleet_goal_create(
  p_role  text,
  p_title text,
  p_body  text
) returns public.fleet_goals
language plpgsql security definer set search_path to '' as $$
declare v_row public.fleet_goals%rowtype;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'fleet_goal_create: admin only';
  end if;

  -- next_wake_at = now(), לא ברירת המחדל (null). שאילתת goal_due בתזמן
  -- ו-goal-poll ב-CLI שתיהן מסננות next_wake_at <= now(); NULL אינו ≤ שום
  -- דבר, אז בלי השורה הזו מטרה טרייה הייתה יושבת ב-active לנצח, בלתי-
  -- נראית לשני הצדדים. עם השורה הזו, הטיק הבא של התזמן (≤60ש') מרים אותה
  -- בלי שום התערבות.
  insert into public.fleet_goals (role, title, body, created_by, next_wake_at)
  values (p_role, btrim(p_title), btrim(p_body), auth.uid(), now())
  returning * into v_row;

  return v_row;
end;
$$;

-- RPC ב׳ — התקדמות. CAS + טווח + תקרת כשלים.
create or replace function public.fleet_goal_progress(
  p_id           uuid,
  p_step         integer,        -- הצעד שהסוכן קיבל. זהו ההגדר.
  p_state        jsonb,
  p_next_wake_at timestamptz,
  p_error        text default null
) returns text
language plpgsql security definer set search_path to '' as $$
declare
  v_updated int;
  v_status  text;
  -- קבועים ולא פרמטרים: על SECDEF, פרמטר הוא קלט לא-אמין —
  -- fleet_goal_progress(..., max_failures => 9999) היה מבטל את הבלם.
  max_failures constant smallint := 3;
  max_horizon  constant interval := interval '30 days';
begin
  if p_id is null or p_step is null then
    raise exception 'fleet_goal_progress: id and step are required';
  end if;

  if jsonb_typeof(coalesce(p_state, '{}'::jsonb)) <> 'object' then
    raise exception 'fleet_goal_progress: state must be a JSON object';
  end if;

  -- מניעת לולאה #2 — אכיפת טווח.
  -- <= now() : הסוכן היה מעיר את עצמו מיד, בלולאה שמוגבלת רק ע"י התקרה היומית.
  -- > 30d    : מטרה שנשכחת בלי שאיש ישים לב.
  if p_next_wake_at is not null
     and (p_next_wake_at <= now() or p_next_wake_at > now() + max_horizon) then
    raise exception
      'fleet_goal_progress: next_wake_at must be within (now, now + 30 days]';
  end if;

  update public.fleet_goals
     set state                = coalesce(p_state, state),
         next_wake_at         = p_next_wake_at,
         last_error           = p_error,
         step_count           = step_count + 1,
         consecutive_failures = case when p_error is null
                                     then 0
                                     else consecutive_failures + 1 end,
         -- מניעת לולאה #3 — תקרת כשלים.
         -- 'paused' מוציא את השורה מ-fleet_goals_due_idx, כך שהטריגר בתזמן
         -- מפסיק לספור אותה פיזית. רק הבעלים משחרר.
         status               = case when p_error is not null
                                      and consecutive_failures + 1 >= max_failures
                                     then 'paused'
                                     else status end
   where id = p_id
     and status = 'active'
     and step_count = p_step;          -- ← ה-CAS

  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    select status into v_status from public.fleet_goals where id = p_id;
    return case when v_status = 'paused' then 'paused_on_failures' else 'advanced' end;
  end if;

  -- לא נכתב כלום — לסווג למה, כמו finish_callback_triage.
  -- "לא קרה כלום" חייב להיות מובחן מ"נכשל", אחרת הסוכן מדווח הצלחה שקרית.
  if not exists (select 1 from public.fleet_goals where id = p_id) then
    return 'not_found';
  end if;
  select status into v_status from public.fleet_goals where id = p_id;
  if v_status <> 'active' then
    return 'not_active';
  end if;
  return 'stale_step';                 -- מישהו אחר התקדם. אל תפעל.
end;
$$;

-- RPC ג׳ — סגירה.
create or replace function public.fleet_goal_close(
  p_id     uuid,
  p_step   integer,
  p_status text,                       -- completed | failed
  p_note   text default null
) returns text
language plpgsql security definer set search_path to '' as $$
declare v_updated int;
begin
  if p_status not in ('completed','failed') then
    raise exception 'fleet_goal_close: status must be completed or failed';
  end if;

  update public.fleet_goals
     set status       = p_status,
         closed_at    = now(),
         next_wake_at = null,          -- ה-CHECK אוכף זאת ממילא; מפורש לקריאוּת
         last_error   = coalesce(p_note, last_error),
         step_count   = step_count + 1
   where id = p_id
     and status in ('active','paused')
     and step_count = p_step;

  get diagnostics v_updated = row_count;
  if v_updated = 1 then return 'closed'; end if;

  -- שלוש סיבות נפרדות, ולא מחרוזת אחת ממוזגת. finish_callback_triage מבחינה
  -- בין claim_lost ל-already_finalized מאותו טעם: הן אומרות לסוכן "עצור",
  -- אבל הן אומרות לבעלים דברים שונים לגמרי כשמתחקרים למה מטרה לא נסגרה.
  if not exists (select 1 from public.fleet_goals where id = p_id) then
    return 'not_found';
  end if;
  if exists (select 1 from public.fleet_goals
              where id = p_id and status in ('completed','failed')) then
    return 'already_closed';
  end if;
  return 'stale_step';
end;
$$;

-- RPC ד׳ — שחרור מטרה מושהית. הבעלים בלבד.
-- הדרך היחידה לצאת מ-'paused'. מאפס את מונה הכשלים, אחרת הכשל הבא
-- מחזיר אותה להשהיה מיד.
create or replace function public.fleet_goal_resume(
  p_id uuid, p_next_wake_at timestamptz default null
) returns text
language plpgsql security definer set search_path to '' as $$
declare v_updated int;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'fleet_goal_resume: admin only';
  end if;
  if p_next_wake_at is not null
     and (p_next_wake_at <= now() or p_next_wake_at > now() + interval '30 days') then
    raise exception 'fleet_goal_resume: next_wake_at must be within (now, now + 30 days]';
  end if;

  update public.fleet_goals
     set status = 'active', consecutive_failures = 0, last_error = null,
         next_wake_at = coalesce(p_next_wake_at, now() + interval '1 hour')
   where id = p_id and status = 'paused';

  get diagnostics v_updated = row_count;
  return case when v_updated = 1 then 'resumed' else 'not_paused' end;
end;
$$;

-- RPCs ה׳+ו׳ — השהיה ונטישה. הבעלים בלבד.
-- fleet_goal_close הוא service_role בלבד: הוא ההצהרה של הסוכן על תוצאה.
-- לבעלים דרושות שתי פעולות נפרדות משלו, אחרת ה-UI מבטיח כפתורים שאין להם נתיב.

-- עצירה זמנית. שומר את המונים ואת state — חידוש ממשיך מאותה נקודה.
create or replace function public.fleet_goal_pause(
  p_id uuid, p_note text default null
) returns text
language plpgsql security definer set search_path to '' as $$
declare v_updated int;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'fleet_goal_pause: admin only';
  end if;

  update public.fleet_goals
     set status = 'paused',
         next_wake_at = null,          -- מוציא מיידית מ-fleet_goals_due_idx
         last_error = coalesce(p_note, last_error)
   where id = p_id and status = 'active';

  get diagnostics v_updated = row_count;
  return case when v_updated = 1 then 'paused' else 'not_active' end;
end;
$$;

-- סגירה יזומת-בעלים של מטרה שאינה רלוונטית עוד. 'failed' ולא 'completed':
-- 'completed' היא קביעה עובדתית שרק הסוכן שביצע רשאי להצהיר עליה.
create or replace function public.fleet_goal_abandon(
  p_id uuid, p_note text
) returns text
language plpgsql security definer set search_path to '' as $$
declare v_updated int;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'fleet_goal_abandon: admin only';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'fleet_goal_abandon: a note is required';
  end if;

  update public.fleet_goals
     set status = 'failed', closed_at = now(), next_wake_at = null,
         last_error = p_note, step_count = step_count + 1
   where id = p_id and status in ('active','paused');

  get diagnostics v_updated = row_count;
  return case when v_updated = 1 then 'abandoned' else 'already_closed' end;
end;
$$;

-- אין CAS בשתי אלה במכוון. הבעלים גובר על ריצה בתנועה — זו כל מטרתו של
-- כפתור עצירה. הסוכן יגלה זאת בקריאת ה-goal-progress הבאה שלו, שתחזיר
-- not_active.

-- הרשאות ההרצה. ברירות המחדל של Supabase מעניקות EXECUTE ל-
-- anon/authenticated/service_role על כל פונקציה חדשה בסכמת public, ו-
-- `revoke from public` אינו נוגע בהענקה שמית. אומת על fleet_owner_request:
-- אחרי revoke from public, anon עדיין החזיק EXECUTE. שתי שכבות, לא אחת.

revoke all on function public.fleet_goal_create(text,text,text)
  from public, anon;
grant execute on function public.fleet_goal_create(text,text,text)
  to authenticated;

revoke all on function public.fleet_goal_resume(uuid,timestamptz)
  from public, anon;
grant execute on function public.fleet_goal_resume(uuid,timestamptz)
  to authenticated;

revoke all on function public.fleet_goal_pause(uuid,text)   from public, anon;
grant execute on function public.fleet_goal_pause(uuid,text) to authenticated;

revoke all on function public.fleet_goal_abandon(uuid,text)   from public, anon;
grant execute on function public.fleet_goal_abandon(uuid,text) to authenticated;

-- שתי אלה נקראות אך ורק ע"י ה-CLI, שרץ כ-service_role.
-- אין להן שום נתיב מהדפדפן, גם לא לאדמין.
revoke all on function public.fleet_goal_progress(uuid,integer,jsonb,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.fleet_goal_progress(uuid,integer,jsonb,timestamptz,text)
  to service_role;

revoke all on function public.fleet_goal_close(uuid,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.fleet_goal_close(uuid,integer,text,text)
  to service_role;

comment on table  public.fleet_goals is
  'Persistent goal + state for the autonomous fleet. The owner creates; the role advances itself between runs via next_wake_at.';
comment on column public.fleet_goals.step_count is
  'CAS fence. Monotonic (enforced by fleet_goals_guard). A writer must present the step it read.';
comment on column public.fleet_goals.next_wake_at is
  'Self-scheduling. Counted by the scheduler goal_due trigger every 60s. Range enforced in fleet_goal_progress.';
comment on column public.fleet_goals.consecutive_failures is
  'Hallucination brake: 3 consecutive errors move status to paused, dropping the row out of fleet_goals_due_idx.';
