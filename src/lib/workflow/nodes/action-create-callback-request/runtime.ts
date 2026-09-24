// `action.create_callback_request` — the step handler. Server side: SDK-free,
// and it imports the shared step contract from `steps/shared`, never from
// `steps/index` (the registry imports this file, so that would be a cycle).
import { ACTION_BRANCH_HANDLES } from '../../catalogue/types';
import { readString, requireGuestContext, type StepHandler } from '../../steps/shared';
import { PermanentNodeExecutionError } from '../../vendor/workflowbuilder/execution-core/errors';

import * as callbackRequestDefinition from './definition';
import { CALLBACK_TOPICS, SALES_CALLBACK_TOPIC, type CreateCallbackRequestConfig } from './definition';

// Put the guest in front of a person.
//
// The escape hatch every automation owes: a workflow that cannot answer should
// hand over rather than guess. Unlike `action.notify_team`, which tells the team
// something happened, this creates a row in the queue they work from — with the
// name and number already on it.
//
// `created: false` is a SUCCESS, not the error branch. It means an open request
// already covers this guest, and the dedupe that produced it is what stops a
// guest who writes twice from being called twice. Routing that to the error
// branch would send a workflow down a failure path for the system working.
export const createCallbackRequest: StepHandler = async (config, ctx) => {
  // The keys are checked against CreateCallbackRequestConfig at compile time;
  // the values are still read defensively, because the config is an
  // unvalidated jsonb row.
  const topic = readString<CreateCallbackRequestConfig>(config, 'topic').trim();
  const note = readString<CreateCallbackRequestConfig>(config, 'note');

  // ⚠️ NEVER THE SALES TOPIC FROM A GUEST NODE.
  //
  // `topic` is not a label, it is the ROUTER: `enqueueSalesCallDispatch` gates
  // on `topic === 'מכירות'` and nothing downstream re-examines who the person
  // is. This node is guest-scoped — `requireGuestContext` below, and the port
  // reads `guests.full_name` / `guests.phone` — so that string would put the
  // sales-closing agent on the phone to a wedding guest to sell them KALFA.
  //
  // The form no longer offers it, and this refuses it anyway: the value lives in
  // a jsonb row that the form does not re-validate, and an older saved diagram
  // may carry anything. Permanent rather than routed to the error branch — it is
  // a configuration mistake, not a runtime condition, and retrying cannot help.
  if (topic === SALES_CALLBACK_TOPIC) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      `הצעד "בקשת חזרה לאורח" לא יכול לפנות בנושא "${SALES_CALLBACK_TOPIC}" — הנושא הזה מנתב לסוכן המכירות, והצעד הזה פונה לאורח באירוע.`,
    );
  }

  const create = ctx.deps.guests.createCallbackRequest;
  if (!create) {
    throw new PermanentNodeExecutionError(
      'unsupported',
      'יצירת בקשת חזרה אינה זמינה בהרצה הזו.',
    );
  }

  const guest = requireGuestContext(ctx, callbackRequestDefinition.type);
  const result = await create({
    eventId: guest.eventId,
    contactId: guest.contactId,
    // An empty topic falls back to the first of the offered values rather than
    // to an internal label: the team reads this column in the callback queue,
    // and the agent is handed it as `{{topic_he}}`.
    topic: topic === '' ? CALLBACK_TOPICS[0] : topic,
    note,
  });

  if (!result.ok) {
    return {
      output: { created: false, reason: result.reason ?? null },
      nextPort: ACTION_BRANCH_HANDLES.error,
    };
  }
  return {
    output: result.created
      ? { created: true }
      : { created: false, skipped: true, reason: 'already_open' },
  };
};
