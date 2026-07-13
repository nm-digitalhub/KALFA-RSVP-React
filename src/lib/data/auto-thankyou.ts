import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendCampaignWhatsApp } from '@/lib/data/outreach';
import { sendSlackAlert } from '@/lib/alerts/slack';
import type { Database } from '@/lib/supabase/types';

// The auto-thankyou periodic sweep (docs/plans auto-thankyou-post-event,
// decisions confirmed 2026-07-12): a pg-boss cron job (worker/main.ts) calls
// runThankyouSweep() every 5 minutes — the SAME idiom as the existing
// arm/sweeper (§handleArm), not a per-campaign delayed job. That means an
// owner toggling thankyou_auto_enabled or editing thankyou_send_at is just a
// DB write; there is nothing to register/cancel/reschedule on the pg-boss
// side, and the next tick always reads fresh state (fail-closed by
// construction).
//
// campaigns.thankyou_auto_enabled / thankyou_send_at / thankyou_sent_at and
// contact_interactions.message_key land with a pending migration
// (supabase/migrations/20260712205030_auto_thankyou_schema.sql) — every read
// below goes through select('*') + runtime narrowing (forward-compat, same
// stance as outreach-config.ts / payments.ts) until `gen types` runs post-
// deploy; writes use a documented `as unknown as` cast for the same reason.

type AdminClient = ReturnType<typeof createAdminClient>;

type DueCampaignRow = { id: string; event_id: string };

// Eligibility: opted in, due, not yet processed, campaign AND event both
// still active. Every condition is read fresh on each call — no cached
// decision from when the job was (never was) enqueued.
export async function listDueThankyouCampaigns(
  admin: AdminClient,
  nowMs: number = Date.now(),
): Promise<string[]> {
  const { data: rows } = await admin.from('campaigns').select('*').eq('status', 'active');
  const due: DueCampaignRow[] = [];
  for (const row of rows ?? []) {
    const raw = row as Record<string, unknown>;
    if (raw.thankyou_auto_enabled !== true) continue;
    if (raw.thankyou_sent_at != null) continue;
    const sendAt = typeof raw.thankyou_send_at === 'string' ? raw.thankyou_send_at : null;
    if (!sendAt) continue;
    const sendAtMs = Date.parse(sendAt);
    if (Number.isNaN(sendAtMs) || sendAtMs > nowMs) continue;
    const id = typeof raw.id === 'string' ? raw.id : null;
    const eventId = typeof raw.event_id === 'string' ? raw.event_id : null;
    if (!id || !eventId) continue;
    due.push({ id, event_id: eventId });
  }
  if (due.length === 0) return [];

  // R9-style defense-in-depth: sendCampaignWhatsApp re-checks event.status
  // itself, but a non-active event should never even be attempted here.
  const eventIds = Array.from(new Set(due.map((r) => r.event_id)));
  const { data: activeEvents } = await admin
    .from('events')
    .select('id')
    .eq('status', 'active')
    .in('id', eventIds);
  const activeEventIds = new Set((activeEvents ?? []).map((e) => e.id));
  return due.filter((r) => activeEventIds.has(r.event_id)).map((r) => r.id);
}

// Mark a campaign as swept — a cheap filter for the NEXT tick's query, not
// the dedup guarantee itself (that is contact_interactions.message_key, which
// survives a partial-batch failure). Only called after a successful
// sendCampaignWhatsApp call (see runThankyouSweep) — a thrown error leaves
// this null so the next tick retries, which is safe because the per-guest
// dedup makes a retry idempotent even if the prior attempt partially sent.
async function markThankyouProcessed(admin: AdminClient, campaignId: string): Promise<void> {
  const { error } = await admin
    .from('campaigns')
    .update({
      thankyou_sent_at: new Date().toISOString(),
    } as unknown as Database['public']['Tables']['campaigns']['Update'])
    .eq('id', campaignId);
  if (error) {
    console.error('[auto-thankyou] failed to mark campaign processed', campaignId, error.code);
  }
}

// The sweep's entry point (called by worker/main.ts on its own schedule).
// Each due campaign is independent — one failing must not block the rest.
//
// Bug fix (thankyou-review, high): sendCampaignWhatsApp does NOT throw for a
// transient config/state gate (outreach kill-switch off, WhatsApp not
// configured, template not yet approved, campaign/event not active) — it
// returns `{sent:0, skipped:0, blocked:true}` instead. Marking
// thankyou_sent_at on a BLOCKED result would permanently stop this campaign
// from ever being retried once the blocker clears (and would wrongly close
// the owner's UI edit window) — silently dropping the thank-you forever.
// Only a non-blocked result (contacts were actually resolved and attempted,
// whether or not any were eligible) counts as "processed".
export async function runThankyouSweep(): Promise<{ processed: number; blocked: number; failed: number }> {
  const admin = createAdminClient();
  const dueIds = await listDueThankyouCampaigns(admin);
  let blocked = 0;
  let failed = 0;
  let totalSent = 0;
  for (const campaignId of dueIds) {
    try {
      const result = await sendCampaignWhatsApp(campaignId, 'thankyou');
      if (result.blocked) {
        blocked++;
        // Visible (not silent) — this is the ONLY signal an operator gets
        // for "auto-thankyou keeps failing to even start" (kill-switch off,
        // missing config, unapproved template). No PII.
        console.error(
          '[auto-thankyou] sweep blocked (transient config/state gate) — will retry next tick',
          campaignId,
        );
        continue;
      }
      // `result.sent` counts messages ACCEPTED by Meta at send time; final
      // delivery / 131049 drops are async (surfaced later via webhooks) and are
      // NOT reflected in this send-time summary.
      totalSent += result.sent;
      await markThankyouProcessed(admin, campaignId);
    } catch (err) {
      failed++;
      console.error(
        '[auto-thankyou] sweep failed for campaign',
        campaignId,
        err instanceof Error ? err.message : 'unknown error',
      );
    }
  }

  // Emit ONE aggregated ops summary — but only when there was real activity or
  // a hard failure. A blocked-only tick stays the per-campaign console.error
  // above; alerting on it would Slack-spam every 5-minute tick for a
  // persistently-blocked campaign. `blocked` is still surfaced in the alert's
  // fields whenever the alert does fire. Fire-and-forget: sendSlackAlert is
  // already fail-safe (never throws, bounded timeout) and must never gate the
  // sweep's control flow.
  if (totalSent > 0 || failed > 0) {
    void sendSlackAlert({
      level: failed > 0 ? 'error' : 'info',
      category: 'send_health',
      source: 'thankyou-sweep',
      title: 'סיכום שליחת תודות',
      // ids/counts only — NO PII (no guest names/phones).
      detail: `נשלחו ${totalSent} · חסומות ${blocked} · כשלים ${failed} · קמפיינים ${dueIds.length}`,
      fields: { sent: totalSent, blocked, failed, campaigns: dueIds.length },
    });
  }

  return { processed: dueIds.length - blocked - failed, blocked, failed };
}
