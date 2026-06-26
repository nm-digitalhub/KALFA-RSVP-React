-- Private Storage bucket for ID-document photos captured at campaign approval
-- (legal protection). Highest-sensitivity PII: the bucket is PRIVATE and gets
-- NO RLS policies on storage.objects, so no end-user (not even an admin role via
-- the anon/authenticated key) can read or write objects directly. All access is
-- server-side through the service-role client, which is RLS-exempt: uploads via
-- a validated server route, admin review via short-lived signed URLs generated
-- server-side. Never expose these objects publicly or via NEXT_PUBLIC.
insert into storage.buckets (id, name, public)
values ('id-documents', 'id-documents', false)
on conflict (id) do nothing;
