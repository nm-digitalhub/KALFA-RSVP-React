// `trigger.whatsapp_inbound` — its own pure matching predicates. Server side and
// SDK-free.
//
// Only the predicates live here. The loop that applies them — `planRuns` in
// `trigger.ts`, which also builds the payload and the dedupe key — stays where
// it is: it is orchestration, and `inbound.ts` and the admin data layer read the
// predicates through `trigger.ts`, which re-exports them for existing readers.
//
// `triggerKeywordCanNeverMatch` lives here too: a predicate over this node's own
// two filters, read by `arm-check.ts` straight from this file.
//
// Imports only its own definition.
import { DEFAULT_WHATSAPP_MESSAGE_KINDS, TEXT_BEARING_WHATSAPP_MESSAGE_KINDS, type } from './definition';

/**
 * The keyword filter, applied at enqueue time (`planRuns` in `trigger.ts`)
 * rather than inside the trigger node's handler. A workflow whose keyword does not match must not produce a run at
 * all: a run row that started and immediately stopped reads, in the admin UI and
 * in any later audit, as "the automation ran" — which is exactly the wrong
 * thing to record about a message it was configured to ignore.
 *
 * Empty or absent keyword means every inbound message matches, which is the
 * documented default in the node's own property description.
 */
export function matchesKeyword(keyword: unknown, messageText: string): boolean {
  if (typeof keyword !== 'string' || keyword.trim() === '') return true;
  return messageText.toLowerCase().includes(keyword.trim().toLowerCase());
}

/**
 * The MESSAGE-KIND filter — text, a button tap, a file, contact cards.
 *
 * ⚠️ THE GATE THAT USED TO LIVE IN THE BILLING CLASSIFIER.
 *
 * `createRunsForInboundMessage` opened with `if (!billable) return []`, reusing
 * `BILLABLE_MESSAGE_TYPES` — a BILLING concept — to decide what an owner is
 * allowed to automate. The two happen to agree for a guest replying, and
 * disagree completely for the case that matters: an owner sending a guest list
 * is not a billable reach, so a file or a contact card could never start a
 * workflow, and importing guests had to live as a separate hard-coded mechanism.
 *
 * Billing is untouched. This is the automation half, and it is per-workflow.
 *
 * ABSENT OR EMPTY MEANS `DEFAULT_WHATSAPP_MESSAGE_KINDS` — exactly the old
 * billable set — so every diagram saved before this field keeps its behaviour
 * with no migration. An owner who wants files says so on the node.
 *
 * An UNKNOWN kind (`''` — a payload with no `type`) matches nothing, including
 * an explicit list: we cannot say what it is, and guessing would start a run on
 * a message nobody chose.
 */
export function matchesKind(configured: unknown, kind: string): boolean {
  if (kind === '') return false;

  // TWO STORED SHAPES, both accepted.
  //
  // `[{ value: 'document' }]` is what the control writes today — the SDK's
  // `ArrayFieldSchema` can only describe arrays of OBJECTS, and declaring one
  // shape while storing another put a validation error on every saved trigger.
  //
  // `['document']` is what the first version wrote. Diagrams saved that way are
  // in the database right now, and reading only the new shape would silently
  // stop them matching — the exact class of failure this field exists to avoid.
  const names = Array.isArray(configured)
    ? configured.flatMap((k) =>
        typeof k === 'string'
          ? [k]
          : k !== null && typeof k === 'object' && typeof (k as { value?: unknown }).value === 'string'
            ? [(k as { value: string }).value]
            : [],
      )
    : [];

  const allowed = names.length > 0 ? names : DEFAULT_WHATSAPP_MESSAGE_KINDS;
  return allowed.includes(kind);
}

/**
 * The RECEIVING-NUMBER filter — which of our WhatsApp lines the message came in on.
 *
 * Applied at enqueue time for the same reason as the keyword: a workflow armed
 * on the RSVP line must not produce a run row for a message someone sent to the
 * import line, because a run that started and immediately stopped reads as "the
 * automation ran".
 *
 * THE GAP THIS CLOSES. `startWorkflowRuns` is called beside `processWebhookEvent`
 * in the drain loop, not behind it, so the inbound router's decision — import
 * traffic goes to stageWhatsAppImport and returns — never applied to workflows.
 * Since the second number went live on 2026-09-10 every armed workflow has been
 * firing on both lines with nothing able to distinguish them.
 *
 * EMPTY OR ABSENT MATCHES ANYTHING, deliberately, and it is the owner's call
 * (2026-09-13): every diagram saved before this field existed keeps its current
 * behaviour rather than silently narrowing to one line. The editor warns on the
 * node when no number is chosen.
 *
 * A configured number against an UNKNOWN arrival (`null` — an older inbox row
 * written before the column was populated) does NOT match. Fail closed: "we do
 * not know which line this came in on" is not evidence it came in on the one the
 * owner named, and the cost of the wrong answer is an automated message to a
 * guest.
 */
export function matchesNumber(configured: unknown, arrivedOn: string | null): boolean {
  if (typeof configured !== 'string' || configured.trim() === '') return true;
  if (arrivedOn === null) return false;
  return configured.trim() === arrivedOn;
}

/**
 * Has this trigger been narrowed until nothing can ever match it?
 *
 * ⚠️ THE TWO FILTERS ARE ANDed, AND THAT IS WHY THIS CAN HAPPEN. `planRuns`
 * applies `matchesKind` and then `matchesKeyword` to the same message. A keyword
 * is only ever tested against `text.body`, so a trigger that accepts NO
 * text-bearing kind and still carries a keyword has asked for a message that
 * does not exist: every candidate either fails the kind filter or arrives with
 * an empty body and fails the keyword.
 *
 * ⚠️ AND THIS IS NOT EXPRESSIBLE IN THE NODE'S SCHEMA. Both halves live in one
 * node, so a JsonForms rule could see them — but the only honest UI response is
 * to HIDE or DISABLE the keyword box, and neither CLEARS the stored value. A
 * trigger that already carries `keyword: 'שיחה'` with kinds excluding `text`
 * would stay just as dead while losing the one visible clue why. So the refusal
 * belongs at arming, where it can name the fix.
 *
 * Absent or empty `messageKinds` is NEVER dead: it means
 * `DEFAULT_WHATSAPP_MESSAGE_KINDS`, which includes `text`.
 *
 * Both persisted shapes are accepted, the same tolerance `matchesKind` has.
 */
export function triggerKeywordCanNeverMatch(
  triggerType: string,
  properties: Record<string, unknown>,
): boolean {
  if (triggerType !== type) return false;

  const keyword = properties.keyword;
  if (typeof keyword !== 'string' || keyword.trim() === '') return false;

  const kinds = properties.messageKinds;
  if (!Array.isArray(kinds) || kinds.length === 0) return false;

  return !kinds.some((entry) => {
    const value =
      typeof entry === 'string' ? entry : (entry as { value?: unknown } | null)?.value;
    return (
      typeof value === 'string' &&
      TEXT_BEARING_WHATSAPP_MESSAGE_KINDS.includes(value)
    );
  });
}
