// `trigger.whatsapp_inbound` — the step handler. Server side: SDK-free, and it
// imports the shared step contract from `steps/shared`, never from `steps/index`
// (the registry imports this file, so that would be a cycle).
import type { StepHandler } from '../../steps/shared';

// The entry node. It performs no side effect: by the time a run exists the
// message has already arrived and been persisted. Its job is to publish the
// payload as this node's output, so the rest of the graph reads it the same way
// it reads any other node's result.
//
// The `keyword` filter is applied at ENQUEUE time, not here — a run that should
// not have started must not exist at all, rather than start and immediately stop
// (which would leave a run row implying something happened). See `planRuns` in
// ../../trigger.ts and the predicates in ./match.ts.
export const whatsappInbound: StepHandler = async (_config, ctx) => ({
  output: {
    message_text: ctx.trigger.message_text,
    button_payload: ctx.trigger.button_payload,
  },
});
