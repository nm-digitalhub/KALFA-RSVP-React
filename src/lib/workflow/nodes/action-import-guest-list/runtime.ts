// `action.import_guest_list` — the step handler. Server side: SDK-free, and it
// imports the shared step contract from `steps/shared`, never from
// `steps/index` (the registry imports this file, so that would be a cycle).
import { ACTION_BRANCH_HANDLES } from '../../catalogue/types';
import type { StepHandler } from '../../steps/shared';
import { PermanentNodeExecutionError } from '../../vendor/workflowbuilder/execution-core/errors';

/**
 * The list that started this run, staged for review.
 *
 * ⚠️ THIS IS THE NODE THAT MAKES GUEST IMPORT A FLOW INSTEAD OF A MECHANISM.
 *
 * Importing from WhatsApp used to be unreachable from a workflow twice over: a
 * file or a contact card never started a run (the BILLING classifier was the
 * automation gate), and there was no step that could do anything with one. Both
 * halves are gone — `matchesKind` on the trigger, and this.
 *
 * IT NEEDS NO CONFIG. Everything it could be asked is either settled (which
 * event) or belongs on the canvas (what to do about 400 rows, or about a file
 * that would not parse). A node whose behaviour is chosen in its own form is the
 * hard-coded mechanism again, wearing a different shape.
 *
 * SAFE TO RUN TWICE, which the step lease requires: staging is keyed on the
 * inbound message id, so a replay reports `created: false` and returns the same
 * review link rather than staging a second copy of the same list.
 *
 * A `created: false` is NOT the error branch. It means the list is already
 * staged — usually because the hard-coded import path, which still runs beside
 * this, won the race. Nothing went wrong; the owner has their link either way.
 */
export const importGuestList: StepHandler = async (config, ctx) => {
  void config;

  const port = ctx.deps.guests.importGuestList;
  if (!port) {
    throw new PermanentNodeExecutionError(
      'capability_unavailable',
      'הפעולה "קליטת רשימת אורחים" אינה זמינה בסביבה הזו.',
    );
  }

  // NOT `requireGuestContext`: this run is about an OWNER sending a list, so it
  // deliberately has no contact. It does need the event — without one there is
  // nowhere to stage — and `inboxRowId` is where the list itself lives.
  const { eventId, inboxRowId } = ctx.trigger;
  if (!eventId || !inboxRowId) {
    throw new PermanentNodeExecutionError(
      'missing_import_context',
      'הצעד "קליטת רשימת אורחים" פועל רק בתהליך שמתחיל מקובץ או מאנשי קשר שנשלחו בוואטסאפ.',
    );
  }

  const result = await port({ inboxRowId, eventId });

  return result.ok
    ? {
        output: {
          staged: true,
          created: result.created,
          // THE LIST ITSELF, on the run's own record. Readable downstream as
          // `{{nodes.<id>.rows}}` — the reason it is here rather than only in
          // the staging table, which is wiped the moment the owner decides.
          rows: result.rows,
          rowCount: result.rowCount,
          errorCount: result.errorCount,
          fileName: result.fileName,
          reviewUrl: result.reviewUrl,
        },
      }
    : {
        output: { staged: false, reason: result.reason, message: result.message ?? null },
        nextPort: ACTION_BRANCH_HANDLES.error,
      };
};
