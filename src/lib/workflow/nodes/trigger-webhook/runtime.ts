// `trigger.webhook` — the step handler. Server side: SDK-free, and it imports
// the shared step contract from `steps/shared`, never from `steps/index` (the
// registry imports this file, so that would be a cycle).
import type { StepHandler } from '../../steps/shared';

// An external system calls in and a run starts.
//
// The DYNAMIC trigger: it declares no field list. Whatever JSON the caller sent
// is published as this node's output and is readable anywhere as
// `{{trigger.body.<path>}}`. A new caller with a different shape needs no code
// change, no migration and no new node type — which is the difference between
// this and every other trigger a workflow tool hard-codes.
//
// It performs no side effect. By the time a run exists the request has already
// been received, authenticated by its token and persisted as the trigger payload.
export const webhookTrigger: StepHandler = async (_config, ctx) => ({
  output: {
    body: ctx.trigger.body ?? {},
    // ⚠️ PUBLISHED SEPARATELY, AND IT HAS TO BE RETURNED HERE TOO. The query
    // string was added to the trigger payload and to this node's outputSchema on
    // 2026-09-22 — but not to this return, so `{{nodes.<trigger>.query.x}}`
    // resolved to nothing while the picker happily offered it. A declaration is
    // a promise the HANDLER keeps; declaring without returning is the same class
    // of defect as returning without declaring, and the same gate now catches
    // both.
    query: ctx.trigger.query ?? {},
  },
});
