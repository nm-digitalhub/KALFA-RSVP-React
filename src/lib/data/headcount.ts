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

// Personalized variant: when the owner recorded an invited size, remind the
// guest of it — informational only, NEVER a cap (an answer above it is a
// legitimate business overage, flagged to the OWNER via over_invited).
export function headcountQuestionFor(expectedCount: number | null): string {
  if (expectedCount && expectedCount > 0) {
    return `תודה על האישור! 🎉\nלפי הרישום שלנו הוזמנתם כ־${expectedCount} אנשים. כמה תגיעו בסך הכול? השיבו במספר (1–10).`;
  }
  return HEADCOUNT_QUESTION;
}
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
    .select('headcount_answered_at, expected_count')
    .eq('id', guestId)
    .maybeSingle();
  if (g?.headcount_answered_at) return;
  const phone = await contactPhone(admin, contactId);
  if (!phone) return;
  const askOutcome = await sendWhatsAppText(config, {
    to: phone,
    body: headcountQuestionFor(g?.expected_count ?? null),
  });
  // fail-soft: no request marker unless the provider accepted the message.
  if (askOutcome.kind !== 'accepted') return;
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
  // PRODUCT DEBT (docs/product-debt.md): the global 1-10 answer range is
  // inconsistent with expected_count > 10 — a 12-person household cannot give
  // its true size over WhatsApp and must use the web link. Future: raise the
  // cap to max(10, expected_count) or offer the RSVP link in the question.
  if (!/^(10|[0-9])$/.test(text)) return false;
  const n = Number(text);

  const admin = createAdminClient();
  const { data: guests } = await admin
    .from('guests')
    .select('id, headcount_attempts, expected_count')
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
        const reAsk = await sendWhatsAppText(config, {
          to: phone,
          body: headcountQuestionFor(guest.expected_count),
        });
        // consumed either way; only count the attempt when the re-ask was sent.
        if (reAsk.kind !== 'accepted') return true;
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
      // answer already stored — the ack is best-effort (outcome ignored).
      await sendWhatsAppText(config, { to: phone, body: HEADCOUNT_ACK });
    }
  }
  return true;
}
