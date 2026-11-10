import { signedInviteImageUrl } from '@/lib/storage/event-media';

// The invitation-image hero of a guest token page (/r /g /ty): a short-lived
// signed URL (the bucket is private), or null. Call it only AFTER the token has
// resolved to a valid view — the token holder is who the image may be shown to.
// Fail-open: on any signing hiccup the page renders without the image; the
// failure is logged with the event id only. `surface` names the page in the log.
export async function inviteImageUrlOrNull(
  invitePath: string | null,
  eventId: string,
  surface: 'rsvp' | 'gift' | 'thankyou',
): Promise<string | null> {
  if (!invitePath) return null;
  try {
    return await signedInviteImageUrl(invitePath, 600);
  } catch (err) {
    console.error(
      `[event-media] ${surface} invite image signing failed (event=${eventId}): ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    );
    return null;
  }
}
