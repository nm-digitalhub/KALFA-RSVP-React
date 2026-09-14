import { editorDiagramSchema } from '../adapter/editor-schema';
import { isKnownNodeType } from './nodes';
import {
  LEGACY_PROPERTY_ALIASES,
  NODE_STATUSES,
  NODE_NUMBER_RANGES,
  NODE_REQUIRED_FIELDS,
  SALES_CALLBACK_TOPIC,
  type KalfaNodeType,
} from './types';

// Is this workflow CONFIGURED, as opposed to merely well-formed?
//
// ⚠️ WHY THIS IS NOT PART OF `toWorkflowDefinition`. The two answer different
// questions, and collapsing them breaks something real:
//
//   CONVERSION asks "can this graph run at all" — one start node, no dead ends,
//     known node types. A starter template must pass it, because a template is a
//     valid DRAFT the owner has not filled in yet.
//
//   THIS asks "is every step actually set up" — and a template deliberately
//     ships with blanks (`targetWorkflowId` is empty because only the owner
//     knows which workflow to fan out to).
//
// So a template still loads, saves and converts; it just cannot be ARMED until
// the blanks are filled. Putting this rule in the converter instead would make
// the templates themselves invalid.
//
// ⚠️ THE FAILURE THIS REPLACES. `action.start_for_each_guest` throws at RUN time
// when it has no target — so a workflow armed on Sunday morning fired at 10:00,
// failed, and the owner found out from a run log. Every field checked here is
// one a handler already refuses; the only thing that changes is WHEN the owner
// is told, and that the message names the field.
//
// The rules come from `NODE_REQUIRED_FIELDS` and `NODE_NUMBER_RANGES`, which are
// the SAME declarations the editor form is built from — so a field required in
// the form is required to arm, by construction rather than by discipline.
//
// ⚠️ AND THEY ARE IMPORTED FROM `./types`, NEVER FROM `./schemas`. This module
// runs on the SERVER. `schemas.ts` pulls runtime values out of
// `@workflowbuilder/sdk` and is reached from a `'use client'` editor, so Next
// compiles it into the CLIENT graph; a server import of it yields a client
// REFERENCE, not the values. The first version of this file imported
// `PALETTE_ITEMS` from there and every arm attempt in production died with
// `PALETTE_ITEMS.find is not a function`. `types.ts` and `nodes.ts` import
// nothing from the SDK and are safe on both sides — the same rule `nodes.ts`
// states for the pg-boss worker.

/** A required field that is absent, blank, or outside its declared range. */
export function findArmBlockers(
  storedDefinition: unknown,
  /**
   * The workflow being armed.
   *
   * Optional so every existing caller compiles, but WITHOUT it the self-fan-out
   * check cannot run — a node pointing at its own workflow is only recognisable
   * against that id. `setWorkflowActive` always passes it.
   */
  workflowId?: string,
): string[] {
  const parsed = editorDiagramSchema.safeParse(storedDefinition);
  if (!parsed.success) return [];

  const blockers: string[] = [];

  for (const node of parsed.data.nodes) {
    // An unknown type is the converter's error to report, not ours — saying it
    // twice in two different wordings helps nobody.
    if (!isKnownNodeType(node.data.type)) continue;
    const nodeType = node.data.type as KalfaNodeType;

    const required = NODE_REQUIRED_FIELDS[nodeType] ?? [];
    const ranges = NODE_NUMBER_RANGES[nodeType] ?? {};

    const properties = (node.data.properties ?? {}) as Record<string, unknown>;
    // What the owner calls this step. The id is a last resort — it is the only
    // thing guaranteed to exist, and a message with no subject is unusable.
    const where = `הצעד "${typeof properties.label === 'string' && properties.label.trim() !== '' ? properties.label : node.id}"`;

    // ⚠️ A STEP LEFT IN DRAFT BLOCKS ARMING — the rule `NODE_STATUSES` states and
    // nothing implemented until now, so a half-written step armed silently and
    // was skipped at run time with no one told.
    //
    // `disabled` deliberately does NOT block. The two skip identically at run
    // time, and the difference is entirely intent: "I have not finished this" is
    // a mistake to catch before a guest is involved, "I switched this off" is the
    // owner's decision and arming must respect it.
    //
    // Reported INSTEAD of this node's field checks, not alongside them: a step
    // nobody finished is expected to have blanks, and listing them too would bury
    // the one line that matters.
    if (readNodeStatus(properties.status) === 'draft') {
      blockers.push(`${where}: הצעד בטיוטה. סיימו אותו, או העבירו אותו ל"מושבת" כדי לדלג עליו במכוון.`);
      continue;
    }

    // ⚠️ A FAN-OUT POINTING AT ITS OWN WORKFLOW, refused before it can run once.
    //
    // The handler refuses it too, and deliberately: arming is not required to be
    // a fan-out TARGET, and the id lives in a jsonb row that arming does not
    // re-read afterwards. But a workflow that starts ITSELF per guest is a static
    // property of the diagram, and the cheapest place to catch a static property
    // is before anything runs — the alternative is discovering it from a run log
    // after a chain has already started.
    if (
      nodeType === 'action.start_for_each_guest' &&
      workflowId !== undefined &&
      typeof properties.targetWorkflowId === 'string' &&
      properties.targetWorkflowId.trim() === workflowId
    ) {
      blockers.push(
        `${where}: הצעד מצביע על התהליך הזה עצמו. תהליך שמפעיל את עצמו לכל אורח אינו נעצר — בחרו תהליך אחר.`,
      );
      continue;
    }

    // ⚠️ AND NOT A GUEST CALLBACK ROUTED TO THE SALES AGENT. Static property of
    // the diagram, so it is refused before a single guest is dialled rather than
    // from a run log afterwards. The handler refuses it again at run time,
    // because the value is a jsonb field the form does not re-validate.
    if (
      nodeType === 'action.create_callback_request' &&
      typeof properties.topic === 'string' &&
      properties.topic.trim() === SALES_CALLBACK_TOPIC
    ) {
      blockers.push(
        `${where}: הנושא "${SALES_CALLBACK_TOPIC}" מנתב לסוכן המכירות, והצעד הזה פונה לאורח באירוע. בחרו נושא אחר.`,
      );
      continue;
    }

    for (const key of required) {
      // The pre-rename key counts. A diagram saved before `status` became
      // `rsvpStatus` still RUNS — the handler reads both — so refusing to arm it
      // would be this check inventing a rule the engine does not have.
      const alias = LEGACY_PROPERTY_ALIASES[key];
      const value = properties[key] ?? (alias ? properties[alias] : undefined);
      const range = ranges[key];

      if (value === undefined || value === null) {
        blockers.push(`${where}: חסר ערך בשדה "${key}".`);
        continue;
      }

      // A blank string is the case that matters and the one JSON Schema's own
      // `required` does NOT catch: the key is present, so the form is satisfied,
      // and the handler still refuses it.
      //
      // An empty ARRAY is deliberately NOT treated the same way. Emptiness is two
      // different ideas: a blank string is an unfilled field, an empty list is
      // usually a deliberate "no filter" (empty `days` on a schedule means every
      // day). No schema declares a required array today — measured — so this is
      // a decision made in advance for the first one that does.
      if (typeof value === 'string' && value.trim() === '') {
        blockers.push(`${where}: ${blankMessage(nodeType, key)}`);
        continue;
      }

      // Only fields that DECLARE a bound are range-checked. Everything else is
      // satisfied by being present and non-blank.
      if (range) {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) {
          blockers.push(`${where}: השדה "${key}" אינו מספר.`);
        } else if (range.minimum !== undefined && n < range.minimum) {
          blockers.push(`${where}: "${key}" חייב להיות ${range.minimum} לפחות.`);
        } else if (range.maximum !== undefined && n > range.maximum) {
          blockers.push(`${where}: "${key}" חייב להיות ${range.maximum} לכל היותר.`);
        }
      }
    }
  }

  return blockers;
}

/**
 * What to say about a blank field.
 *
 * ⚠️ A FIELD NAME IS NOT ALWAYS AN INSTRUCTION. For most fields "the field is
 * empty" is the whole story — the owner opens the node and types. For the
 * fan-out it is not: `targetWorkflowId` is blank because the workflow it points
 * at DOES NOT EXIST YET, and an owner who loaded the starter template has no way
 * to know that from the field name alone.
 *
 * Only nodes where the fix is not obvious get a sentence of their own.
 */
function blankMessage(nodeType: string, key: string): string {
  if (nodeType === 'action.start_for_each_guest' && key === 'targetWorkflowId') {
    return 'לא נבחר תהליך להרצה. צרו את תהליך-הבן (למשל מהתבנית "תזכורת לאורח אחד") והדביקו את המזהה שלו כאן.';
  }
  return `השדה "${key}" ריק.`;
}

/**
 * The node's own lifecycle, or undefined when the value is not one of ours.
 *
 * ⚠️ AN UNRECOGNISED VALUE IS `active`, NEVER A BLOCK — and this is not
 * theoretical. MEASURED in production on 2026-09-14: two stored nodes carry
 * `status: 'attending'` / `'declined'`, the RSVP value from before that field was
 * renamed to `rsvpStatus`. Treating an unknown string as "not active" would
 * refuse to arm a workflow that runs correctly; the adapter's `readNodeStatus`
 * makes the same choice for the same reason.
 */
function readNodeStatus(value: unknown): string | undefined {
  return typeof value === 'string' && (NODE_STATUSES as readonly string[]).includes(value)
    ? value
    : undefined;
}
