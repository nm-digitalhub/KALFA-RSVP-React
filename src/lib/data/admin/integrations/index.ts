import 'server-only';

import { hasPlatformPermission, isPlatformOwner, requirePlatformStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { getJobHealth } from '@/lib/ops/db-health';
import { getIntegrationsStatus, type IntegrationStatus } from '@/lib/ops/integrations';

// The /admin/integrations index: one card per provider, for whoever is looking.
//
// ⚠️ WHY THE PAGE IS ON THE STAFF FLOOR AND THE CARDS ARE NOT.
// The obvious gate is `manage_settings` — it opens six of the seven destinations. It
// is the wrong one, for a reason that took two wrong answers to reach:
//
//   * First attempt: staff floor, because "an ops person holding only manage_voice
//     would be ejected". MEASURED — no such role exists; ops_engineer holds both.
//   * Second attempt: manage_settings, because nobody is currently locked out by it.
//     Also wrong, and worse: a gate that is correct only for today's three staff
//     rows is not a gate, it is a coincidence. The roster changes; the resource does
//     not.
//
// So the gate describes the RESOURCE. This page is a navigation surface plus
// read-only status, and every staff member may see where things stand. The two
// WRITES that share the page (the outreach master switch and the channel catalog)
// carry `manage_settings` themselves, in their own actions, and the page renders
// them only for holders — hiding is convenience, the action is the gate.
//
// A card the viewer cannot use is shown as "no permission", NOT as a link. That
// distinction is the whole reason the floor is safe here: without it, a billing
// clerk clicks a tile and is redirected out of the admin area entirely, which is
// exactly the trap this consolidation exists to remove.

export type IntegrationKey =
  | 'meta-whatsapp'
  | 'voximplant'
  | 'extra-sms'
  | 'resend-email'
  | 'sumit'
  | 'slack'
  | 'microsoft'
  | 'elevenlabs'
  | 'owner-agent';

// Owner-only destinations. Not a key in platform_permission_definitions: the owner
// holds every permission by definition, and a page gated on requirePlatformOwner
// admits no one else, whatever they hold.
const OWNER = 'OWNER';
const OWNER_LABEL = 'הרשאת בעלים';

interface CardSpec {
  /** The key `getIntegrationsStatus()` uses, which is not always the route slug. */
  statusKey: string;
  key: IntegrationKey;
  /**
   * The permission its DESTINATION enforces — derived from the code that gates that
   * content today, not from the plan. Keep in step when a page moves. `OWNER` is the
   * sentinel for a page gated on requirePlatformOwner, the same one the sidebar uses
   * (admin-shell.tsx): it is not a catalogue key, so it is never asked for.
   */
  permission: string;
  /**
   * Where the settings live RIGHT NOW. The dedicated /admin/integrations/<provider>
   * pages arrive in later tasks; until then the index is a real hub rather than a
   * wall of dead tiles, and each href is repointed as its page lands.
   */
  href: string;
}

const CARDS: CardSpec[] = [
  { statusKey: 'whatsapp', key: 'meta-whatsapp', permission: 'manage_settings', href: '/admin/integrations/meta-whatsapp' },
  { statusKey: 'voximplant', key: 'voximplant', permission: 'manage_voice', href: '/admin/integrations/voximplant' },
  { statusKey: 'elevenlabs', key: 'elevenlabs', permission: 'manage_voice', href: '/admin/voice/platform' },
  { statusKey: 'extra-sms', key: 'extra-sms', permission: 'manage_settings', href: '/admin/integrations/extra-sms' },
  { statusKey: 'resend-email', key: 'resend-email', permission: 'manage_settings', href: '/admin/integrations/resend-email' },
  { statusKey: 'sumit', key: 'sumit', permission: 'manage_settings', href: '/admin/integrations/sumit' },
  { statusKey: 'slack', key: 'slack', permission: 'manage_settings', href: '/admin/integrations/slack' },
  { statusKey: 'microsoft', key: 'microsoft', permission: 'manage_settings', href: '/admin/integrations/microsoft' },
  { statusKey: 'owner-agent', key: 'owner-agent', permission: OWNER, href: '/admin/integrations/owner-agent' },
];

// GA4 is deliberately absent. getIntegrationsStatus() reports it because Debug Mode
// wants it, but nobody "connects" it from the panel — it is env-only and has no
// settings page to link to. It stays a diagnostics row.
//
// Microsoft/Exchange is absent for the opposite reason: it has a DEDICATED debug panel
// that shows every admin's connection, while listMyExchangeConnections() returns only
// the caller's own. A card built from the weaker source would quietly under-report, so
// it waits for its own page and reads the same source that panel does.

export interface IntegrationCard {
  key: IntegrationKey;
  label: string;
  configured: boolean;
  enabled: boolean;
  /** Only ever populated for a platform owner — see getIntegrationsIndex(). */
  lastCheckedAt: string | null;
  healthCheckAvailable: boolean;
  note?: string;
  permission: string;
  /**
   * The permission's own Hebrew label, read from platform_permission_definitions
   * rather than hardcoded — the owner can rename a permission in /admin/roles, and a
   * card that says "requires X" must not go on saying the old name.
   */
  permissionLabel: string;
  /** null when the viewer may not open it — the card renders as "no permission". */
  href: string | null;
  canOpen: boolean;
}

export interface IntegrationsIndex {
  cards: IntegrationCard[];
  /** The page's two write surfaces render only for holders. */
  canManageSettings: boolean;
  /** True when "last checked" could be resolved at all — see below. */
  showsLastChecked: boolean;
}

/**
 * The owner-agent card's status row. It cannot come from getIntegrationsStatus():
 * that is built on the integrations_configured_flags() RPC, which predates the agent
 * and has no owner_agent_* flag (extending it is a migration). So the two columns are
 * read here, with the COOKIE client — app_settings' staff policy admits every staff
 * member, which is exactly this page's floor — and nothing else: no allow-list, no
 * phone, no audit.
 *
 * NOT through the owner-agent module. Its readers call requirePlatformOwner, which
 * REDIRECTS: a non-owner opening this index would be ejected from the admin area by
 * the card that is supposed to tell them they may not open it.
 *
 * null on any failure, and the card is then omitted — the same rule as a provider
 * the shared status source stopped returning: never invent a status.
 */
async function getOwnerAgentStatus(): Promise<IntegrationStatus | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('app_settings')
      .select('owner_agent_enabled, owner_agent_phone_number_id')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return null;
    return {
      key: 'owner-agent',
      label: 'סוכן WhatsApp לבעלים',
      // "Configured" = a number is selected. Without one the webhook diverts nothing,
      // whatever the switch says.
      configured: data.owner_agent_phone_number_id !== null,
      enabled: data.owner_agent_enabled,
      lastCheckedAt: null,
      healthCheckAvailable: false,
      note: 'שאלות עסקיות בוואטסאפ מטלפונים ברשימת ההיתר. בעלים בלבד.',
    };
  } catch {
    return null;
  }
}

export async function getIntegrationsIndex(): Promise<IntegrationsIndex> {
  await requirePlatformStaff();

  // ⚠️ getJobHealth() IS OWNER-ONLY, AT THE DATABASE. `ops_job_health` raises
  // 'platform owner only' inside the function (VERIFIED live 2026-09-10: an
  // impersonated billing_clerk got exactly that error; an owner got 35 rows). It is
  // right that it stays owner-only — it returns queue names and infrastructure state
  // — so this asks for it ONLY for an owner and hands getIntegrationsStatus an empty
  // array otherwise. The consequence is honest and visible: a non-owner sees no
  // "last checked" column rather than a column full of dashes that look like faults.
  const owner = await isPlatformOwner();
  const jobHealth = owner ? await getJobHealth() : null;
  const [rows, ownerAgent]: [IntegrationStatus[], IntegrationStatus | null] = await Promise.all([
    getIntegrationsStatus(jobHealth?.ok ? jobHealth.data : []),
    getOwnerAgentStatus(),
  ]);

  const byKey = new Map([...rows, ...(ownerAgent ? [ownerAgent] : [])].map((r) => [r.key, r]));

  // Resolve each distinct permission once; cache() in the DAL collapses the repeats
  // into one RPC per key for the whole render pass. The OWNER sentinel is not a key —
  // asking has_platform_permission('OWNER') would answer false for everyone, owners
  // included, and spend an RPC to do it.
  const distinct = [...new Set(CARDS.map((c) => c.permission))].filter((p) => p !== OWNER);
  const held = new Map(
    await Promise.all(
      distinct.map(async (key) => [key, await hasPlatformPermission(key)] as const),
    ),
  );

  // One query for the two distinct keys' display names. Falls back to the raw key: a
  // missing label should degrade the hint, never blank the card.
  const supabase = await createClient();
  const { data: defs } = await supabase
    .from('platform_permission_definitions')
    .select('key, label')
    .in('key', distinct);
  const labels = new Map((defs ?? []).map((d) => [d.key, d.label]));

  const cards: IntegrationCard[] = [];
  for (const spec of CARDS) {
    const status = byKey.get(spec.statusKey);
    if (!status) continue; // a provider dropped from the shared source — never invent one
    const canOpen = owner || (spec.permission !== OWNER && held.get(spec.permission) === true);
    cards.push({
      key: spec.key,
      label: status.label,
      configured: status.configured,
      enabled: status.enabled,
      lastCheckedAt: status.lastCheckedAt,
      healthCheckAvailable: status.healthCheckAvailable,
      note: status.note,
      permission: spec.permission,
      permissionLabel:
        spec.permission === OWNER ? OWNER_LABEL : (labels.get(spec.permission) ?? spec.permission),
      href: canOpen ? spec.href : null,
      canOpen,
    });
  }

  return {
    cards,
    canManageSettings: owner || held.get('manage_settings') === true,
    showsLastChecked: owner && jobHealth?.ok === true,
  };
}
