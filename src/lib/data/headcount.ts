import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { sendWhatsAppText } from '@/lib/whatsapp/client';

// Headcount-after-RSVP flow (plans/rsvp-headcount-flow-plan.md, owner
// decisions 2026-07-05): right after a guest presses "מגיע/ה" we ask, inside
// the 24h service window, how many people are coming (1-10).
//   confirmed_headcount 0  = not answered yet (the owner's chosen default).
//   A "0" reply re-asks the question, capped at HEADCOUNT_MAX_ATTEMPTS.
//   Anything non-numeric is ignored (stays 0) — never nag on free text.
// Every send here is fail-soft: a WhatsApp hiccup must never fail the webhook.

export const HEADCOUNT_MAX_ATTEMPTS = 3;
export const HEADCOUNT_QUESTION =
  'תודה על האישור! 🎉\nכמה תגיעו בסך הכול? השיבו במספר (1–10).';
export const HEADCOUNT_ACK = 'נרשם! מחכים לכם בשמחה 🎉';

type AdminClient = ReturnType<typeof createAdminClient>;

async function contactPhone(
  admin: AdminClient,
  contactId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('contacts')
    .select('normalized_phone')
    .eq('id', contactId)
    .maybeSingle();
  return data?.normalized_phone ?? null;
}

// Ask the headcount question for ONE guest (the single-guest-per-contact rule
// is the caller's concern, same as the RSVP-from-button block).
export async function requestHeadcount(
  guestId: string,
  contactId: string,
): Promise<void> {
  const config = await getWhatsAppConfig();
  if (!config) return;
  const admin = createAdminClient();
  // Already answered (web RSVP page or a previous WhatsApp round) → no ask.
  const { data: g } = await admin
    .from('guests')
    .select('headcount_answered_at')
    .eq('id', guestId)
    .maybeSingle();
  if (g?.headcount_answered_at) return;
  const phone = await contactPhone(admin, contactId);
  if (!phone) return;
  try {
    await sendWhatsAppText(config, { to: phone, body: HEADCOUNT_QUESTION });
  } catch {
    return; // fail-soft: no request marker when nothing was sent
  }
  await admin
    .from('guests')
    .update({
      headcount_requested_at: new Date().toISOString(),
      headcount_attempts: 1,
    })
    .eq('id', guestId);
}

// Handle a possible headcount reply. Returns true when the text was consumed
// as a headcount answer/re-ask (callers may skip further free-text handling).
export async function handleHeadcountReply(
  eventId: string,
  contactId: string,
  rawText: string,
): Promise<boolean> {
  const text = rawText.trim();
  if (!/^(10|[0-9])$/.test(text)) return false;
  const n = Number(text);

  const admin = createAdminClient();
  const { data: guests } = await admin
    .from('guests')
    .select('id, headcount_attempts')
    .eq('event_id', eventId)
    .eq('contact_id', contactId)
    .not('headcount_requested_at', 'is', null)
    .is('headcount_answered_at', null)
    .order('created_at', { ascending: true })
    .limit(2);
  // Exactly one guest awaiting — same no-guessing rule as RSVP-from-button.
  if (!guests || guests.length !== 1) return false;
  const guest = guests[0];

  const config = await getWhatsAppConfig();

  if (n === 0) {
    // "0" → re-ask, capped so a stubborn 0 can never loop forever.
    if (guest.headcount_attempts >= HEADCOUNT_MAX_ATTEMPTS) return true;
    if (config) {
      const phone = await contactPhone(admin, contactId);
      if (phone) {
        try {
          await sendWhatsAppText(config, { to: phone, body: HEADCOUNT_QUESTION });
        } catch {
          return true; // consumed; count the attempt anyway
        }
      }
    }
    await admin
      .from('guests')
      .update({ headcount_attempts: guest.headcount_attempts + 1 })
      .eq('id', guest.id);
    return true;
  }

  // Single source of truth for totals: the canonical confirmed pair the web
  // RSVP page and every report read. The WhatsApp answer carries no
  // adults/kids breakdown — it lands as adults=n (kids 0), total identical.
  await admin
    .from('guests')
    .update({
      confirmed_headcount: n,
      confirmed_adults: n,
      confirmed_kids: 0,
      headcount_answered_at: new Date().toISOString(),
    })
    .eq('id', guest.id);
  if (config) {
    const phone = await contactPhone(admin, contactId);
    if (phone) {
      try {
        await sendWhatsAppText(config, { to: phone, body: HEADCOUNT_ACK });
      } catch {
        /* answer already stored — ack is best-effort */
      }
    }
  }
  return true;
}
