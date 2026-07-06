import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { INVITE_IMAGE_MAX_BYTES } from '@/lib/constants';

export { INVITE_IMAGE_MAX_BYTES };

// PRIVATE event-media storage (invitation images). Same discipline as
// id-documents (legal-docs.ts): no storage RLS policies — only the
// service-role client touches the bucket, and callers MUST verify event
// authorization first. Guests never see a storage URL; Meta receives a
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

// Short-lived signed URL for SEND time only (Meta fetches the header image
// once per message). One hour comfortably covers a full send batch.
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
