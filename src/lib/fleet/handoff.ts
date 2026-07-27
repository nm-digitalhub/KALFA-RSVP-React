// Handoff support for the fleet CLI: role-name validation against fleet.json
// and construction of the forwarded request row.
//
// Two rules close the "dead letter" hole (a request filed under a role name
// the scheduler does not know is shown to the owner, but its verdict is then
// skipped forever by the answer-watcher):
//   - `request` may only be filed under a role DEFINED in fleet.json (enabled
//     or not — a role disabled mid-run must still be able to file its report).
//   - `handoff` may only target a role that is defined AND enabled (a spawn
//     will actually happen when the owner answers), or the special target
//     `main`: handled by the main session — interactively (SessionStart
//     inbox), or by the reactive Tier-2 `main` fleet role the answer-watcher
//     spawns once the owner answers. Either way the executor closes the loop
//     with the `complete` verb. This is the route to work that needs the
//     domain agents or live-data execution.

import type { Json } from '@/lib/supabase/types';

export const MAIN_HANDOFF_TARGET = 'main';

// fleet.json's `roles` object → name → enabled. `$`-prefixed keys are inline
// comments, not roles. Throws on a shape that is not fleet.json — callers
// treat that as fail-closed (no validation source, no insert).
export function parseFleetRoles(raw: unknown): Map<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('fleet config is not an object');
  }
  const roles = (raw as { roles?: unknown }).roles;
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) {
    throw new Error('fleet config has no roles object');
  }
  const map = new Map<string, boolean>();
  for (const [name, config] of Object.entries(roles)) {
    if (name.startsWith('$')) continue;
    const enabled =
      !!config && typeof config === 'object' && (config as { enabled?: unknown }).enabled === true;
    map.set(name, enabled);
  }
  return map;
}

// null = valid; otherwise the error message for fail().
export function validateRequestRole(roles: Map<string, boolean>, role: string): string | null {
  if (roles.has(role)) return null;
  return `--role "${role}" is not a fleet role (defined in fleet.json: ${[...roles.keys()].join(', ')}). To forward work to the main session or another role, use the handoff verb.`;
}

export function validateHandoffTarget(roles: Map<string, boolean>, target: string): string | null {
  if (target === MAIN_HANDOFF_TARGET) return null;
  if (!roles.has(target)) {
    return `--to "${target}" is not a fleet role; use one of: ${[...roles.keys()].join(', ')}, or "${MAIN_HANDOFF_TARGET}" for the interactive main session (domain agents live there, not in the fleet).`;
  }
  if (!roles.get(target)) {
    return `--to "${target}" is disabled in fleet.json — its verdict would never be spawned. Hand off to "${MAIN_HANDOFF_TARGET}" instead, or enable the role first.`;
  }
  return null;
}

export interface HandoffOriginal {
  id: string;
  role: string;
  kind: string;
  tier: number;
  title: string;
  body: string;
  payload: unknown;
}

export interface HandoffRequestFields {
  role: string;
  kind: string;
  tier: number;
  title: string;
  body: string;
  payload: Record<string, Json | undefined>;
}

// The forwarded row: same kind/tier, provenance in title/body/payload, and the
// original's attachments carried over so drafts stay visible in /admin/fleet.
export function buildHandoffRequest(
  original: HandoffOriginal,
  target: string,
  note?: string,
): HandoffRequestFields {
  const payload: Record<string, Json | undefined> = {
    handoff_from: original.id,
    handoff_from_role: original.role,
  };
  if (note) payload.handoff_note = note;
  const attachments =
    original.payload && typeof original.payload === 'object' && !Array.isArray(original.payload)
      ? (original.payload as { attachments?: unknown }).attachments
      : undefined;
  if (Array.isArray(attachments) && attachments.length > 0) {
    payload.attachments = attachments as Json[];
  }

  const bodyParts: string[] = [];
  if (note) bodyParts.push(note);
  bodyParts.push(`--- הפנייה המקורית (${original.role}, ${original.id}) ---`, original.body);

  return {
    role: target,
    kind: original.kind,
    tier: original.tier,
    title: `[העברה מ-${original.role}] ${original.title}`,
    body: bodyParts.join('\n\n'),
    payload,
  };
}
