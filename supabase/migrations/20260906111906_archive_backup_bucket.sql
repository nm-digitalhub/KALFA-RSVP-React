-- 2026-09-06 — independent backup of the contracts archive
-- (docs/sharepoint-contracts-archive-plan-2026-09-06.md §11, owner-approved
-- improvement #10, scope widened by the owner: "גיבוי מעכשיו וישמור קבצים
-- שכבר נמצאים ב-supabase").
--
-- WHY: SharePoint's only safety net is a 93-day recycle bin, and the plan is
-- deliberately not licensed for Purview retention. Supplier contracts exist
-- ONLY in SharePoint, so an accidental library deletion past 93 days is
-- unrecoverable. The signed customer agreements exist in the id-documents
-- bucket, which has no second copy either. This bucket is that second copy —
-- one content-addressed store covering BOTH sources.
--
-- Layout written by src/lib/data/archive-backup.ts:
--   objects/<sha256[0:2]>/<sha256>          the bytes, stored once ever
--   manifests/<YYYY-MM-DD>.json             one snapshot: every source path,
--                                           its size and its sha256
-- A restore reads a manifest and fetches each object by hash. Because the
-- store is content-addressed, a monthly run only uploads what actually
-- changed, and no snapshot can ever overwrite another's bytes.
--
-- PRIVATE, and deliberately NO storage.objects policies — the same posture as
-- id-documents / event-media / vox-call-logs: only the service-role client
-- (the worker) ever reads or writes here. It holds signed contracts and
-- customer PII; never expose it publicly or through NEXT_PUBLIC.
--
-- Rollback (manual): delete the objects, then
--   delete from storage.buckets where id = 'archive-backup';
insert into storage.buckets (id, name, public)
values ('archive-backup', 'archive-backup', false)
on conflict (id) do nothing;
