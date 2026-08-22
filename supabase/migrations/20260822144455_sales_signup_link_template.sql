-- Sales-closing agent's send_signup_link WhatsApp leg. Seeds the message_key
-- row (active=false -> INERT until Meta approves the template) — same
-- pattern as event_day_pay (20260712124239_event_day_pay_template.sql).
-- Submitted to Meta 2026-08-22 (Graph v23.0, POST /{waba_id}/message_templates):
-- name=kalfa_sales_signup_link_v1, id=1773127337066249, category=MARKETING,
-- allow_category_change=false, status at submission=PENDING. No variants/
-- param_contract needed (this template is event-type-independent — a
-- prospect has no event yet).
insert into public.message_templates (message_key, channel, label, name, language)
values ('sales_signup_link', 'whatsapp', 'קישור הרשמה — סוכן מכירות', 'kalfa_sales_signup_link_v1', 'he')
on conflict (message_key) do nothing;
