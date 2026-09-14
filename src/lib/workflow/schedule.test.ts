import { describe, expect, it } from 'vitest';

import { israelSlot, israelWeekday, matchesSchedule, planScheduledRuns } from './schedule';
import type { ArmedWorkflow } from './trigger';

// `trigger.schedule` — the clock as a way into a workflow.
//
// ⚠️ THE HARD PART IS NOT THE MATCHING, IT IS THE TIMEZONE. "כל יום ב-09:00"
// means nine in the morning where the owner and the guests are, and it has to
// keep meaning that across both DST transitions — on a server whose own clock is
// UTC. Every test below drives a real instant and asserts what an Israeli wall
// clock would have read at it.

const armed = (properties: Record<string, unknown>, id = 'wf-1'): ArmedWorkflow => ({
  id,
  eventId: null,
  definition: {
    name: 'w',
    layoutDirection: 'RIGHT',
    nodes: [
      {
        id: 't',
        type: 'node',
        position: { x: 0, y: 0 },
        data: {
          type: 'trigger.schedule',
          icon: 'Clock',
          properties: { label: 't', description: 'd', ...properties },
        },
      },
    ],
    edges: [],
  },
});

/** An instant, named by what an Israeli clock reads at it. */
const at = (iso: string) => new Date(iso);

describe('israelSlot — the key everything deduplicates on', () => {
  it('formats an instant as Israeli wall-clock minutes', () => {
    // 06:00 UTC in winter (UTC+2) is 08:00 in Israel.
    expect(israelSlot(at('2026-01-15T06:00:00Z'))).toBe('2026-01-15T08:00');
  });

  it('⚠️ is correct in SUMMER, when the offset is +3', () => {
    // The same UTC hour reads differently half the year. Computing the local
    // time by adding a fixed offset would be an hour wrong for six months —
    // silently, because nothing downstream can tell a wrong slot from a right one.
    expect(israelSlot(at('2026-07-15T06:00:00Z'))).toBe('2026-07-15T09:00');
  });

  it('⚠️ survives the SPRING transition', () => {
    // Israel springs forward on the Friday before the last Sunday of March —
    // 2026: 27 March at 02:00 local, which IS 00:00 UTC because the offset is
    // still +2 at that moment. The fixture below was wrong on the first attempt
    // for exactly that reason: 00:30 UTC is already PAST the change.
    expect(israelSlot(at('2026-03-26T23:30:00Z'))).toBe('2026-03-27T01:30'); // still +2
    expect(israelSlot(at('2026-03-27T00:30:00Z'))).toBe('2026-03-27T03:30'); // now +3

    // The hour 02:00–02:59 local does not exist on this date. Nothing scheduled
    // inside it can fire, and that is the timezone's behaviour rather than ours
    // — worth pinning so a future reader does not treat it as a bug.
    expect(matchesSchedule({ time: '02:30' }, at('2026-03-27T00:30:00Z'))).toBe(false);
  });

  it('⚠️ survives the AUTUMN transition', () => {
    // 2026: 25 October, 02:00 → 01:00.
    expect(israelSlot(at('2026-10-24T22:30:00Z'))).toBe('2026-10-25T01:30'); // +3
    expect(israelSlot(at('2026-10-25T00:30:00Z'))).toBe('2026-10-25T02:30'); // +2
  });

  it('⚠️ renders midnight as 00, never 24', () => {
    // The classic ICU trap: `hour12: false` yields '24' for midnight in some
    // versions. Unnormalised, a schedule set for 00:00 would never match — for
    // the one minute it is supposed to.
    expect(israelSlot(at('2026-01-14T22:00:00Z'))).toBe('2026-01-15T00:00');
  });

  it('two instants in the same minute share a slot; the next minute does not', () => {
    // This is what makes the dedupe key work: the sweep runs every minute and
    // pg-boss may deliver a tick twice.
    expect(israelSlot(at('2026-01-15T06:00:10Z'))).toBe(israelSlot(at('2026-01-15T06:00:59Z')));
    expect(israelSlot(at('2026-01-15T06:01:00Z'))).not.toBe(israelSlot(at('2026-01-15T06:00:00Z')));
  });
});

describe('israelWeekday', () => {
  it('counts Sunday as 0', () => {
    expect(israelWeekday(at('2026-01-11T10:00:00Z'))).toBe(0); // Sunday
    expect(israelWeekday(at('2026-01-16T10:00:00Z'))).toBe(5); // Friday
  });

  it('uses the ISRAELI day, not the UTC one', () => {
    // 22:30 UTC on Saturday is already Sunday in Israel.
    expect(israelWeekday(at('2026-01-10T22:30:00Z'))).toBe(0);
  });
});

describe('matchesSchedule', () => {
  const NINE = at('2026-01-15T07:00:00Z'); // 09:00 Israel, a Thursday

  it('fires at its minute', () => {
    expect(matchesSchedule({ time: '09:00' }, NINE)).toBe(true);
  });

  it('does not fire a minute early or late', () => {
    expect(matchesSchedule({ time: '09:00' }, at('2026-01-15T06:59:00Z'))).toBe(false);
    expect(matchesSchedule({ time: '09:00' }, at('2026-01-15T07:01:00Z'))).toBe(false);
  });

  it('absent days means EVERY day', () => {
    // The same "unset is widest" rule the keyword and number filters follow.
    for (const iso of ['2026-01-11T07:00:00Z', '2026-01-15T07:00:00Z', '2026-01-17T07:00:00Z']) {
      expect(matchesSchedule({ time: '09:00' }, at(iso))).toBe(true);
    }
  });

  it('an EMPTY days array is also every day, not never', () => {
    // A schedule that can never fire is a dead workflow that looks armed.
    expect(matchesSchedule({ time: '09:00', days: [] }, NINE)).toBe(true);
  });

  it('honours a day list', () => {
    expect(matchesSchedule({ time: '09:00', days: [4] }, NINE)).toBe(true); // Thursday
    expect(matchesSchedule({ time: '09:00', days: [0, 1] }, NINE)).toBe(false);
  });

  it('refuses a malformed time rather than guessing', () => {
    // The config is jsonb: the form constrains what can be typed, not what is in
    // the row. A schedule whose time cannot be read must not fire at a time
    // nobody chose.
    for (const time of ['9:00', '25:00', '09:60', 'morning', '', '09:00:00', null, 9]) {
      expect(matchesSchedule({ time }, NINE)).toBe(false);
    }
  });

  it('ignores junk inside the day list', () => {
    expect(matchesSchedule({ time: '09:00', days: ['4', null, 4] }, NINE)).toBe(true);
    // Only junk left → treated as unset, which is every day.
    expect(matchesSchedule({ time: '09:00', days: ['x', 99] }, NINE)).toBe(true);
  });

  it('refuses a non-object config', () => {
    expect(matchesSchedule(null, NINE)).toBe(false);
    expect(matchesSchedule('09:00', NINE)).toBe(false);
  });
});

describe('planScheduledRuns', () => {
  const NINE = at('2026-01-15T07:00:00Z');

  it('plans a run for a matching workflow', () => {
    const [run] = planScheduledRuns([armed({ time: '09:00' })], NINE);
    expect(run).toMatchObject({
      workflowId: 'wf-1',
      triggerSource: 'schedule',
      dedupeKey: 'schedule:wf-1:2026-01-15T09:00',
    });
  });

  it('⚠️ the dedupe key is the SLOT — the same minute plans the same key', () => {
    // The whole idempotency of the feature. The sweep runs every minute against
    // a slot that lasts a minute, and pg-boss may deliver a tick twice.
    const a = planScheduledRuns([armed({ time: '09:00' })], at('2026-01-15T07:00:05Z'));
    const b = planScheduledRuns([armed({ time: '09:00' })], at('2026-01-15T07:00:55Z'));
    expect(a[0]!.dedupeKey).toBe(b[0]!.dedupeKey);
  });

  it('tomorrow is a different key', () => {
    const today = planScheduledRuns([armed({ time: '09:00' })], NINE);
    const tomorrow = planScheduledRuns([armed({ time: '09:00' })], at('2026-01-16T07:00:00Z'));
    expect(today[0]!.dedupeKey).not.toBe(tomorrow[0]!.dedupeKey);
  });

  it('⚠️ carries NO contact — a scheduled run is not about a person', () => {
    // The property every guest-touching node relies on: `requireGuestContext`
    // refuses inside this run, which is correct until a step goes and finds guests.
    const [run] = planScheduledRuns([armed({ time: '09:00' })], NINE);
    expect(run!.triggerPayload.contactId).toBeUndefined();
    expect(run!.eventId).toBeNull();
  });

  it('publishes the slot it fired for', () => {
    const [run] = planScheduledRuns([armed({ time: '09:00' })], NINE);
    expect(run!.triggerPayload.body).toEqual({ firedAt: '2026-01-15T09:00' });
  });

  it('plans nothing for a non-matching time', () => {
    expect(planScheduledRuns([armed({ time: '10:00' })], NINE)).toEqual([]);
  });

  it('⚠️ a WhatsApp trigger is NEVER woken by the clock', () => {
    // Written as an equality on the trigger type rather than "is a trigger", so
    // a second trigger source cannot accidentally arm an existing workflow
    // against an event it was never built for.
    const whatsapp: ArmedWorkflow = {
      id: 'wf-2',
      eventId: null,
      definition: {
        name: 'w',
        layoutDirection: 'RIGHT',
        nodes: [
          {
            id: 't',
            type: 'node',
            position: { x: 0, y: 0 },
            data: {
              type: 'trigger.whatsapp_inbound',
              icon: 'WhatsappLogo',
              properties: { label: 't', description: 'd', time: '09:00' },
            },
          },
        ],
        edges: [],
      },
    };
    expect(planScheduledRuns([whatsapp], NINE)).toEqual([]);
  });

  it('skips a diagram with TWO triggers', () => {
    const two = armed({ time: '09:00' });
    (two.definition as { nodes: unknown[] }).nodes.push({
      id: 't2',
      type: 'node',
      position: { x: 0, y: 0 },
      data: { type: 'trigger.webhook', icon: 'Plugs', properties: { label: 'x', description: 'd' } },
    });
    expect(planScheduledRuns([two], NINE)).toEqual([]);
  });

  it('skips a definition that will not parse', () => {
    expect(planScheduledRuns([{ id: 'wf-3', eventId: null, definition: 'nope' }], NINE)).toEqual([]);
  });

  it('carries the workflow’s own event scope', () => {
    const scoped = { ...armed({ time: '09:00' }), eventId: 'e1' };
    expect(planScheduledRuns([scoped], NINE)[0]!.eventId).toBe('e1');
  });

  it('plans one run per matching workflow', () => {
    const runs = planScheduledRuns(
      [armed({ time: '09:00' }, 'a'), armed({ time: '09:00' }, 'b'), armed({ time: '10:00' }, 'c')],
      NINE,
    );
    expect(runs.map((r) => r.workflowId)).toEqual(['a', 'b']);
  });
});
