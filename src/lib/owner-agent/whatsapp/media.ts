import 'server-only';

import type { OwnerAgentWhatsApp } from './adapter';

// Inbound media for the owner agent (plan §4.2, §9.2): scoped lookup first,
// the adapter's hardened download second.
//
//   1. lookupMediaScoped — `retrieveMedia(id, phoneNumberId)` with a timeout.
//      Meta refuses a media id that was not received on our number; we then
//      refuse a reported `file_size` above the cap and a mime outside the
//      allowlist. Nothing is downloaded until all three pass.
//   2. adapter.downloadMedia — host allowlist (fbcdn.net / fbsbx.com / Graph),
//      the token never follows a redirect to another host, DNS-level SSRF guard,
//      a 25MB hard limit of its own (@chat-adapter/shared downloadAttachment).
//      The received length is checked again: a lying or absent file_size must
//      not get past the cap.
//
// Known gaps of step 2 (dist line numbers of @chat-adapter/whatsapp 4.41.0):
// it re-fetches the metadata UNSCOPED and with no timeout (dist:1300 via
// graphFetchJson dist:2134), and its limit is a fixed 25MB with no mime check.
// Step 1 covers the scope and the mime; the deadline below covers the timeout
// (it cannot abort the adapter's fetch — the request may finish in the
// background, and its bytes are dropped).
//
// Meta documents NO distinct error for "expired" vs "received on another
// number" (media reference, fetched 27.9): both come back as an error body on
// the scoped lookup, so both are `media_unavailable`. Splitting them would need
// a live probe, not a guess.
//
// Never logged: bytes, the media id, the URL, the phone.

export const OWNER_AGENT_MEDIA_HARD_LIMIT = 25 * 1024 * 1024; // the adapter's own cap
const DEFAULT_LOOKUP_TIMEOUT_MS = 10_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;

const MEDIA_ID_RE = /^[0-9]{1,32}$/;

export type OwnerAgentMediaFailure =
  | 'media_invalid_id'
  | 'media_wrong_number'
  | 'media_unavailable'
  | 'media_lookup_failed'
  | 'media_too_large'
  | 'media_unsupported'
  | 'media_download_failed';

export type OwnerAgentMediaResult =
  | { kind: 'ok'; bytes: Buffer; mime: string; filename?: string }
  | { kind: 'failed'; code: OwnerAgentMediaFailure };

type DownloadTransport = Parameters<OwnerAgentWhatsApp['downloadMedia']>[1];

export interface DownloadOwnerAgentMediaInput {
  mediaId: string;
  // The number the intake arrived on. Must be the adapter's own number.
  phoneNumberId: string;
  maxBytes: number;
  // Base types, e.g. 'image/jpeg', 'audio/ogg'. Parameters (`; codecs=opus`)
  // on Meta's side are ignored when comparing.
  allowedMime: readonly string[];
  // From the inbound message (documents only); passed through, never trusted
  // for anything but display.
  filename?: string;
  lookupTimeoutMs?: number;
  downloadTimeoutMs?: number;
  // Test seam: the adapter's binary fetch goes through node https, not fetch.
  transport?: DownloadTransport;
}

export function normalizeMime(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase();
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('deadline')), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export async function downloadOwnerAgentMedia(
  wa: OwnerAgentWhatsApp,
  input: DownloadOwnerAgentMediaInput,
): Promise<OwnerAgentMediaResult> {
  if (!MEDIA_ID_RE.test(input.mediaId)) return { kind: 'failed', code: 'media_invalid_id' };
  if (input.phoneNumberId !== wa.businessPhoneNumberId) {
    return { kind: 'failed', code: 'media_wrong_number' };
  }
  const cap = Math.min(Math.max(0, Math.floor(input.maxBytes)), OWNER_AGENT_MEDIA_HARD_LIMIT);
  const allowed = new Set(input.allowedMime.map(normalizeMime));

  let meta: Awaited<ReturnType<OwnerAgentWhatsApp['lookupMediaScoped']>>;
  try {
    meta = await wa.lookupMediaScoped(input.mediaId, input.lookupTimeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS);
  } catch {
    return { kind: 'failed', code: 'media_lookup_failed' };
  }
  // whatsapp-api-js resolves a Meta error as a body ({ error }), not a throw;
  // `url` exists only on the success branch.
  if (!('url' in meta) || typeof meta.url !== 'string') {
    return { kind: 'failed', code: 'media_unavailable' };
  }
  const reported = Number(meta.file_size);
  if (Number.isFinite(reported) && reported > cap) return { kind: 'failed', code: 'media_too_large' };
  const mime = normalizeMime(typeof meta.mime_type === 'string' ? meta.mime_type : '');
  if (!mime || !allowed.has(mime)) return { kind: 'failed', code: 'media_unsupported' };

  let bytes: Buffer;
  try {
    bytes = await withDeadline(
      wa.downloadMedia(input.mediaId, input.transport),
      input.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS,
    );
  } catch (e) {
    // The shared downloader's constant message for its 25MB cap (a lying
    // file_size gets here); every other failure is a plain download failure.
    const overCap = e instanceof Error && e.message === 'Attachment exceeds the download limit';
    return { kind: 'failed', code: overCap ? 'media_too_large' : 'media_download_failed' };
  }
  if (bytes.byteLength > cap) return { kind: 'failed', code: 'media_too_large' };

  return {
    kind: 'ok',
    bytes,
    mime,
    ...(input.filename ? { filename: input.filename } : {}),
  };
}
