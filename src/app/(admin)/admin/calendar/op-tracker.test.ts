import { describe, expect, it } from 'vitest';

import { CalendarOpTracker } from './op-tracker';

describe('CalendarOpTracker — the owner-approved concurrency contract', () => {
  it('rule 1: operation ids increase monotonically', () => {
    const t = new CalendarOpTracker();
    const a = t.startWrite('e1');
    const b = t.startWrite('e2');
    expect(b).toBeGreaterThan(a);
  });

  it('rule 4: a second write to the SAME event is refused while pending; other events proceed', () => {
    const t = new CalendarOpTracker();
    t.startWrite('e1');
    expect(t.canStartWrite('e1')).toBe(false);
    expect(t.canStartWrite('e2')).toBe(true);
  });

  it('rule 4: the lock releases on settle and the event is writable again', () => {
    const t = new CalendarOpTracker();
    const op = t.startWrite('e1');
    t.settleWrite('e1', op);
    expect(t.canStartWrite('e1')).toBe(true);
  });

  it('rule 2: a refresh started before a newer write is discarded', () => {
    const t = new CalendarOpTracker();
    const token = t.beginRefresh();
    const op = t.startWrite('e1'); // newer write begins before the response lands
    expect(t.shouldApplyRefresh(token)).toBe(false);
    t.settleWrite('e1', op);
    const fresh = t.beginRefresh();
    expect(t.shouldApplyRefresh(fresh)).toBe(true);
  });

  it('rule 2: a superseded refresh (newer refresh started) is discarded', () => {
    const t = new CalendarOpTracker();
    const older = t.beginRefresh();
    const newer = t.beginRefresh();
    expect(t.shouldApplyRefresh(older)).toBe(false);
    expect(t.shouldApplyRefresh(newer)).toBe(true);
  });

  it('rule 3: refresh requested during pending writes is deferred to the LAST settle', () => {
    const t = new CalendarOpTracker();
    const op1 = t.startWrite('e1');
    const op2 = t.startWrite('e2');
    expect(t.requestRefresh()).toBe(false); // deferred
    expect(t.settleWrite('e1', op1)).toBe(false); // one still pending
    expect(t.settleWrite('e2', op2)).toBe(true); // last settle ⇒ fire now
  });

  it('rule 3: refresh with nothing pending fires immediately', () => {
    const t = new CalendarOpTracker();
    expect(t.requestRefresh()).toBe(true);
  });

  it('rule 5: failures accumulate as a list — one failure never hides another', () => {
    const t = new CalendarOpTracker();
    const op1 = t.startWrite('e1');
    const op2 = t.startWrite('e2');
    t.settleWrite('e1', op1, 'כשל א');
    t.settleWrite('e2', op2, 'כשל ב');
    expect(t.getErrors().map((e) => e.message)).toEqual(['כשל א', 'כשל ב']);
    t.dismissError(t.getErrors()[0].opId);
    expect(t.getErrors().map((e) => e.message)).toEqual(['כשל ב']);
  });

  it('a failed write schedules an authoritative refresh once idle', () => {
    const t = new CalendarOpTracker();
    const op = t.startWrite('e1');
    expect(t.settleWrite('e1', op, 'שמירה נכשלה')).toBe(true); // idle ⇒ refresh now
  });

  it('EXPLICIT GUARANTEE (owner review 27.07): a refresh discarded while writes are pending is ALWAYS re-fired by the last settle — the UI can never wait forever', () => {
    const t = new CalendarOpTracker();
    // refresh R starts, then a write begins before R's response lands → R is stale
    const staleToken = t.beginRefresh();
    const op = t.startWrite('e1');
    expect(t.shouldApplyRefresh(staleToken)).toBe(false);
    // the discard path asks for a fresh refresh; writes are pending → deferred
    expect(t.requestRefresh()).toBe(false);
    // the guarantee: the LAST pending settle (success OR failure) fires it
    expect(t.settleWrite('e1', op, undefined)).toBe(true);
  });

  it('a stale settle of a superseded op does not release a newer lock', () => {
    const t = new CalendarOpTracker();
    const oldOp = t.startWrite('e1');
    t.settleWrite('e1', oldOp); // released
    const newOp = t.startWrite('e1');
    t.settleWrite('e1', oldOp); // stale settle — must NOT release newOp's lock
    expect(t.canStartWrite('e1')).toBe(false);
    t.settleWrite('e1', newOp);
    expect(t.canStartWrite('e1')).toBe(true);
  });
});
