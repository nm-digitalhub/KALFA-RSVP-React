// `action.notify_team` — the step handler. Server side: SDK-free, and it imports
// the shared step contract from `steps/shared`, never from `steps/index` (the
// registry imports this file, so that would be a cycle).
import { readEnum, readString, type StepHandler } from '../../steps/shared';

import * as notifyTeamDefinition from './definition';
import { NOTIFY_LEVELS, type NotifyTeamConfig } from './definition';

// The only action pointed INWARD. It crosses `TeamAlertsPort` rather than calling
// the Slack module directly — see that port's comment for the two reasons
// (`server-only` leaking into the worker bundle, and a dry run posting for real).
//
// The implementation behind the port is already fail-soft, deduped and
// rate-limited, so a workflow firing on every inbound message cannot flood the
// channel: the same title within the dedup window is suppressed by the alert
// layer, not by anything here.
//
// `detail` passes through the template resolver like every other field, so an
// alert can quote the guest. That is a deliberate widening of what reaches
// Slack: the channel is staff-only and already carries `workflow run failed`
// details, but an owner writing `{{trigger.message_text}}` here is choosing to
// put a guest's words there. Worth knowing; not worth forbidding.
export const notifyTeam: StepHandler = async (config, ctx) => {
  // The schema marks `title` required, so the FORM will not let an owner leave
  // it blank. That constrains the form, not the row: a diagram saved before the
  // field existed, or one arriving through the import modal, can still carry an
  // empty title — and the SDK's validation plugin, which would catch it on the
  // canvas, is Enterprise and not licensed here. An alert with no title tells a
  // reader nothing, so it is skipped rather than sent as a blank line.
  //
  // The keys are checked against NotifyTeamConfig at compile time; the values
  // are still read defensively, because the config is an unvalidated jsonb row.
  const title = readString<NotifyTeamConfig>(config, 'title').trim();
  if (title === '') {
    return { output: { skipped: true, reason: 'empty_title' } };
  }

  const { sent } = await ctx.deps.alerts.notifyTeam({
    level: readEnum(config, 'level', NOTIFY_LEVELS, notifyTeamDefinition.type),
    title,
    detail: readString<NotifyTeamConfig>(config, 'detail'),
  });

  // `sent: false` is an ordinary answer, not a failure — alerts disabled, the
  // category switched off, a duplicate inside the dedup window, or the global
  // per-minute cap. None of those is a reason to fail a guest's run, and the
  // reason is on the output so the log says which happened.
  return sent
    ? { output: { sent: true } }
    : { output: { sent: false, skipped: true, reason: 'alert_suppressed' } };
};
