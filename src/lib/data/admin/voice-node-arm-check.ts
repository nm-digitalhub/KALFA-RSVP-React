import 'server-only';

import { editorDiagramSchema } from '@/lib/workflow/adapter/editor-schema';
import * as startVoiceCallDefinition from '@/lib/workflow/nodes/action-start-voice-call/definition';
import { listVoicePurposes } from '@/lib/data/voice-purposes';

// Can every call node in this workflow actually place its call?
//
// ⚠️ WHY THIS IS SEPARATE FROM `findArmBlockers`. That one is a PURE function
// over the stored definition — it runs in the browser bundle's tests, imports
// only `./types`, and touches no database. The question here cannot be answered
// from the definition alone: whether a purpose still exists, is still enabled,
// and still carries a rule is a fact about `voice_purposes`, not about the
// diagram. Reaching for that from inside a pure module would drag a Supabase
// client into every caller of the catalogue.
//
// ⚠️ AND WHY IT EXISTS AT ALL, when `dispatchVoicePurposeCall` already refuses.
// It does refuse — with `purpose_rule_missing`, `purpose_disabled`,
// `purpose_not_found` — but at RUN time, which is to say on the guest's
// schedule. An owner who armed a workflow on Sunday learns from a run log on
// Tuesday that the step never dialled. This is the same rule, asked at the
// moment the owner is looking at the screen. The dispatcher stays authoritative:
// a purpose can be disabled between arming and running, and only the dispatcher
// is there when it matters.
//
// ⚠️ THE NODE'S OWN RULE COUNTS. A purpose with no rule used to be
// unconditionally undialable; it no longer is, because the node can name one.
// Checking only the purpose here would refuse to arm a workflow that dials
// perfectly well — the exact inversion of what a gate is for.

const CALL_NODE = startVoiceCallDefinition.type;

function readText(properties: Record<string, unknown>, key: string): string {
  const value = properties[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The reasons this workflow's call nodes cannot dial, in the owner's language.
 *
 * Empty means every call node is dialable as far as the registry can say. A
 * definition that does not parse returns empty too — that is the converter's
 * error to report, and saying it twice in two wordings helps nobody.
 */
export async function findVoiceDialBlockers(storedDefinition: unknown): Promise<string[]> {
  const parsed = editorDiagramSchema.safeParse(storedDefinition);
  if (!parsed.success) return [];

  const callNodes = parsed.data.nodes.filter((n) => n.data.type === CALL_NODE);
  // The common case, and it must cost nothing: most workflows never dial.
  if (callNodes.length === 0) return [];

  const purposes = await listVoicePurposes();
  const byKey = new Map(purposes.map((p) => [p.key, p]));

  const blockers: string[] = [];

  for (const node of callNodes) {
    const properties = (node.data.properties ?? {}) as Record<string, unknown>;

    // A draft step is skipped at run time by design, so its configuration is not
    // yet a promise about anything. `findArmBlockers` already reports the draft
    // itself; adding a second complaint about the same node would bury it.
    if (properties.status === 'draft' || properties.status === 'disabled') continue;

    const label = readText(properties, 'label');
    const where = `הצעד "${label !== '' ? label : node.id}"`;

    const purposeKey = readText(properties, 'purposeKey');
    // Empty is `findArmBlockers`' report, with a message that names the field and
    // says where to create a purpose. Not repeated here.
    if (purposeKey === '') continue;

    const purpose = byKey.get(purposeKey);
    if (!purpose) {
      blockers.push(
        `${where}: הייעוד "${purposeKey}" לא קיים יותר. בחרו ייעוד אחר, או צרו אותו מחדש ב-/admin/integrations/voximplant.`,
      );
      continue;
    }
    if (purpose.isBuiltin) {
      blockers.push(
        `${where}: "${purpose.displayName}" הוא ייעוד מובנה, והחייגן מסרב לחייג בו. צרו ייעוד משלכם.`,
      );
      continue;
    }
    if (!purpose.active || !purpose.enabled) {
      blockers.push(
        `${where}: הייעוד "${purpose.displayName}" כבוי. הפעילו אותו ב-/admin/integrations/voximplant או בחרו אחר.`,
      );
      continue;
    }

    // THE RULE, from either place. This is the check the node's own fields
    // changed: before them, a rule-less purpose could not be chosen at all.
    if (!purpose.ruleId && readText(properties, 'ruleId') === '') {
      blockers.push(
        `${where}: אין כלל ניתוב. בחרו כלל בשדה "כלל הניתוב" בצעד, או קשרו כלל לייעוד "${purpose.displayName}".`,
      );
    }
  }

  return blockers;
}
