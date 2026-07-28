// Concurrency contract for the admin Exchange calendar (owner-approved spec,
// 27.07.2026). Framework-free on purpose so every rule is unit-testable:
//
// 1. Every write gets a monotonically increasing operation id.
// 2. A stale refresh result must never be applied: a refresh captures the
//    write-op counter when it STARTS; if any newer write began before the
//    refresh response lands, the response is discarded.
// 3. The authoritative refresh runs only once all in-flight writes settled —
//    callers ask shouldRefreshNow(); while writes are pending the wish is
//    remembered and honored when the last write settles.
// 4. While a write for event X is pending, another write for X is refused
//    (per-event lock); other events proceed independently.
// 5. One failed write never hides another — failures are collected as a
//    list, each dismissed individually by the UI.

export type TrackedError = { opId: number; message: string };

export class CalendarOpTracker {
  private opCounter = 0;
  private pendingByEvent = new Map<string, number>();
  private refreshCounter = 0;
  private refreshWanted = false;
  private errors: TrackedError[] = [];

  /** Rule 4: refuse a second concurrent write to the same event. */
  canStartWrite(eventId: string): boolean {
    return !this.pendingByEvent.has(eventId);
  }

  /** Rule 1: register a write; returns its operation id. */
  startWrite(eventId: string): number {
    const opId = ++this.opCounter;
    this.pendingByEvent.set(eventId, opId);
    return opId;
  }

  /**
   * Settle a write (success OR failure). Only the op that currently owns the
   * event's lock releases it (a stale settle of a superseded op is a no-op).
   * Returns true when a deferred refresh should fire now (rule 3).
   */
  settleWrite(eventId: string, opId: number, failureMessage?: string): boolean {
    if (this.pendingByEvent.get(eventId) === opId) {
      this.pendingByEvent.delete(eventId);
    }
    if (failureMessage) {
      // Rule 5: append, never replace.
      this.errors.push({ opId, message: failureMessage });
      this.refreshWanted = true; // failure ⇒ realign with the server's truth
    }
    return this.refreshWanted && this.pendingByEvent.size === 0;
  }

  /** Ask for an authoritative refresh; true = run it NOW (nothing pending). */
  requestRefresh(): boolean {
    if (this.pendingByEvent.size > 0) {
      this.refreshWanted = true;
      return false;
    }
    this.refreshWanted = false;
    return true;
  }

  /** Rule 2: a refresh captures its start snapshot... */
  beginRefresh(): { refreshId: number; opSnapshot: number } {
    this.refreshWanted = false;
    return { refreshId: ++this.refreshCounter, opSnapshot: this.opCounter };
  }

  /** ...and its result is applied only if nothing newer happened meanwhile. */
  shouldApplyRefresh(token: { refreshId: number; opSnapshot: number }): boolean {
    return token.refreshId === this.refreshCounter && token.opSnapshot === this.opCounter;
  }

  hasPendingWrites(): boolean {
    return this.pendingByEvent.size > 0;
  }

  /** Rule 5: the full failure list; UI renders and dismisses individually. */
  getErrors(): readonly TrackedError[] {
    return this.errors;
  }

  dismissError(opId: number): void {
    this.errors = this.errors.filter((e) => e.opId !== opId);
  }
}
