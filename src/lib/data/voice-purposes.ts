import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// The registry of what each configured voice agent is FOR.
//
// ⚠️ WHY THIS TABLE EXISTS. Before it, adding a fourth voice agent cost nine
// pieces — measured on 2026-09-14: two dedicated columns in `app_settings`
// (already 102 wide), a dedicated attempt table, a ~370-line dispatcher, a
// pg-boss queue and worker handler, a ctx/cb route pair, an admin form section
// and a routing rule. Exactly one of the nine, the rule id, was data. That is
// why KALFA has three voice agents and not four.
//
// ⚠️ AND WHAT A ROW DOES *NOT* DO. It does not create an agent. The ElevenLabs
// agent and the Voximplant scenario are built on those platforms, and that is
// correct rather than a gap: KALFA never calls the ElevenLabs API on this path
// — it starts a Voximplant RULE, and the scenario bridges. That boundary is what
// keeps every dial behind the live-calls switch, the dialling window, the
// Shabbat block, DNC and consent. A row records WHICH rule to start; it grants
// no reach that the account did not already have.

export type VoicePurpose = {
  key: string;
  displayName: string;
  description: string | null;
  ruleId: string | null;
  enabled: boolean;
  /**
   * TRUE for RSVP / meeting-confirm / sales, which predate this table.
   *
   * Their dialling lives in their own modules and their rule ids stay in
   * `app_settings`. The row exists so the admin and the workflow editor can SEE
   * them; `dispatchVoicePurposeCall` refuses them by name rather than dialling a
   * second way into a path that already works.
   */
  isBuiltin: boolean;
  leadMs: number;
  minDelayMs: number;
  tokenTtlSec: number;
  active: boolean;
};

function fromRow(r: {
  key: string;
  display_name: string;
  description: string | null;
  rule_id: string | null;
  enabled: boolean;
  is_builtin: boolean;
  lead_ms: number;
  min_delay_ms: number;
  token_ttl_sec: number;
  active: boolean;
}): VoicePurpose {
  return {
    key: r.key,
    displayName: r.display_name,
    description: r.description,
    ruleId: r.rule_id,
    enabled: r.enabled,
    isBuiltin: r.is_builtin,
    leadMs: Number(r.lead_ms),
    minDelayMs: Number(r.min_delay_ms),
    tokenTtlSec: r.token_ttl_sec,
    active: r.active,
  };
}

const COLUMNS =
  'key, display_name, description, rule_id, enabled, is_builtin, lead_ms, min_delay_ms, token_ttl_sec, active';

/** Every active purpose, in display order. Read by the admin and the editor. */
export async function listVoicePurposes(): Promise<VoicePurpose[]> {
  const { data, error } = await createAdminClient()
    .from('voice_purposes')
    .select(COLUMNS)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`listVoicePurposes failed: ${error.message}`);
  return (data ?? []).map(fromRow);
}

/**
 * One purpose by key, or null.
 *
 * Deliberately does NOT filter on `enabled` or `active`: the caller decides what
 * an off purpose means, and the dispatcher reports "off" differently from
 * "never existed" — an owner who disabled something should read that, not a
 * missing-row error.
 */
export async function getVoicePurpose(key: string): Promise<VoicePurpose | null> {
  const { data, error } = await createAdminClient()
    .from('voice_purposes')
    .select(COLUMNS)
    .eq('key', key)
    .maybeSingle();

  if (error) throw new Error(`getVoicePurpose failed: ${error.message}`);
  return data ? fromRow(data) : null;
}
