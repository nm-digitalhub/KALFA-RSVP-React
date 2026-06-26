import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Private legal-document storage (signed agreement PDF, signature image, ID
// photo). The bucket has NO RLS policies → only the service-role client may
// touch it. Never build public URLs; admin review uses short-lived signed URLs
// generated here. Never log the bytes or the signed URL.
const BUCKET = 'id-documents';

export async function uploadLegalDoc(
  path: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(BUCKET).upload(path, body, {
    contentType,
    upsert: false, // never silently overwrite a signed artifact
  });
  if (error) throw new Error('העלאת המסמך נכשלה');
}

// Download a stored legal doc (service-role). Callers MUST verify authorization
// (ownership) before calling — this bypasses RLS.
export async function downloadLegalDoc(path: string): Promise<Uint8Array> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error('הורדת המסמך נכשלה');
  return new Uint8Array(await data.arrayBuffer());
}

// Short-lived signed URL for admin review. Keep the TTL small (minutes) — a
// long-lived signed URL is a long-lived leak of sensitive PII.
export async function signedLegalDocUrl(
  path: string,
  expiresInSeconds = 120,
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) throw new Error('יצירת קישור מאובטח נכשלה');
  return data.signedUrl;
}
