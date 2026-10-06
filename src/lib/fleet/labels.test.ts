import { describe, expect, it } from 'vitest';

import {
  GOAL_STATUSES,
  GOAL_STATUS_LABEL,
  GOAL_STATUS_VARIANT,
  KIND_LABEL,
  KIND_VARIANT,
  REQUEST_KINDS,
  REQUEST_STATUSES,
  STATUS_LABEL,
  STATUS_VARIANT,
} from './labels';

// The value lists mirror the DB CHECK constraints (fleet_requests_kind_check,
// fleet_requests_status_check after 20260727000620, fleet_goals_status_check).
describe('fleet labels', () => {
  it('covers every request kind in the DB CHECK', () => {
    expect(REQUEST_KINDS).toHaveLength(3);
    for (const kind of REQUEST_KINDS) {
      expect(KIND_LABEL[kind]).toBeTruthy();
      expect(KIND_VARIANT[kind]).toBeTruthy();
    }
  });

  it('covers every request status in the DB CHECK (7)', () => {
    expect(REQUEST_STATUSES).toHaveLength(7);
    for (const status of REQUEST_STATUSES) {
      expect(STATUS_LABEL[status]).toBeTruthy();
      expect(STATUS_VARIANT[status]).toBeTruthy();
    }
  });

  it('covers every goal status in the DB CHECK (4)', () => {
    expect(GOAL_STATUSES).toHaveLength(4);
    for (const status of GOAL_STATUSES) {
      expect(GOAL_STATUS_LABEL[status]).toBeTruthy();
      expect(GOAL_STATUS_VARIANT[status]).toBeTruthy();
    }
  });

  it('never uses the indigo-filled badge variants on a status chip', () => {
    for (const v of [
      ...Object.values(KIND_VARIANT),
      ...Object.values(STATUS_VARIANT),
      ...Object.values(GOAL_STATUS_VARIANT),
    ]) {
      expect(['default', 'secondary']).not.toContain(v);
    }
  });
});
