-- Route an inquiry to a real queue instead of leaving it as a free-text topic.
--
-- `topic` is what the CUSTOMER picked, in their words, and it stays. `queue_id`
-- is where the inquiry ROUTES. They are not the same fact, and conflating them
-- is what the code did before: `console_queues` already carries priority and
-- agent assignment and is managed at /admin/voice/queues, so linking to it gives
-- real triage without building anything.
--
-- ⚠️ The one-time mapping below is keyed on `key`, NOT on `name_he`. The plan
-- originally prescribed `q.name_he = c.topic`, which reads as obviously correct
-- and is not: measured 16.08, the billing queue's name_he is 'גבייה' while the
-- public form offers 'חיוב ותשלום'. That join would have silently dropped every
-- billing inquiry — no error, no log, queue_id null forever, on the category
-- least affordable to lose. It looked fine only because no customer had yet
-- chosen that option, so a count of existing rows could not reveal it.
--
-- Keying on `key` also means renaming a queue for display can never re-route
-- anything, which is the whole reason the two vocabularies are kept separate.
alter table public.contact_messages
  add column if not exists queue_id uuid references public.console_queues(id);

create index if not exists contact_messages_queue_idx
  on public.contact_messages (queue_id) where queue_id is not null;

-- Backfill by the same explicit map the application uses. 'אחר' is absent on
-- purpose: it is not a queue, and an unrouted inquiry is visible and triageable
-- while a wrongly-routed one is not. Mail intake leaves `topic` null, so those
-- rows stay unrouted until someone classifies them — which is honest.
update public.contact_messages c
set queue_id = q.id
from public.console_queues q
where c.queue_id is null
  and q.is_active
  and q.key = case c.topic
    when 'מכירות' then 'sales'
    when 'תמיכה' then 'support'
    when 'חיוב ותשלום' then 'billing'
  end;
