import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { INVITE_IMAGE_MAX_BYTES } from '@/lib/constants';

export { INVITE_IMAGE_MAX_BYTES };

// PRIVATE event-media storage (invitation images). Same discipline as
// id-documents (legal-docs.ts): no storage RLS policies — only the
// service-role client touches the bucket, and callers MUST verify event
// authorization first. Guests never see a permanent storage URL — the public
// pages sign a 10-minute one only after the token resolved; Meta receives a
// short-lived signed URL per send batch.
const BUCKET = 'event-media';

export const INVITE_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Upload (replace) the event's invitation image; returns the storage path to
// persist on events.invite_image_path. upsert — re-uploading a new invitation
// for the same event is the normal flow, not a conflict.
export async function uploadInviteImage(
  eventId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const ext = INVITE_IMAGE_TYPES[contentType];
  if (!ext) throw new Error('סוג הקובץ אינו נתמך');
  const path = `${eventId}/invite.${ext}`;
  const admin = createAdminClient();
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error('העלאת תמונת ההזמנה נכשלה');
  return path;
}

// Best-effort cleanup for a file uploaded AHEAD of a row that then failed to
// insert (the create flow uploads first, so a failed upload creates nothing;
// this covers the opposite order of failure). Never throws — an orphaned file
// is a storage cost, not a correctness issue. The path carries only the event
// id, no PII.
export async function removeInviteImage(path: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(BUCKET).remove([path]);
  if (error) {
    console.error('[event-media] orphan invite image cleanup failed', {
      path,
      error: error.message,
    });
  }
}

// Short-lived signed URL. At send time Meta fetches the header image once per
// message, and the one-hour default comfortably covers a full send batch; the
// pages that render the image pass a shorter TTL.
export async function signedInviteImageUrl(
  path: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) throw new Error('יצירת קישור לתמונה נכשלה');
  return data.signedUrl;
}
