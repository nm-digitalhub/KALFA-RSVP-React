import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { findOrphanedStatusAppointments } from '@/lib/data/exchange-availability';
import type { ExchangeAppointment } from '@/lib/exchange-ews/types';

// Regression for the same shape of gap measured in callback-scheduling.ts
// (2026-08-19): reconcileBlocksWithCalendar only ever asks "does my row's
// appointment still exist" — never "does an appointment exist that no row
// claims". This module had no live orphans when that was found (one
// historical row, already past), but the missing check was identical, and an
// untested function is not the same as a correct one.
const START = new Date('2026-07-28T07:40:00Z');
const END = new Date('2026-07-28T07:55:00Z');

function calItem(overrides: Partial<ExchangeAppointment> = {}): ExchangeAppointment {
  return {
    id: 'cal-item-1',
    subject: 'תפוס — KALFA',
    start: START,
    end: END,
    allDay: false,
    showAs: 'busy',
    seriesLinked: false,
    ...overrides,
  };
}

function blockRow(appointmentId: string) {
  return {
    id: 'block-1',
    show_as: 'busy' as const,
    label: 'תפוס',
    starts_at: START.toISOString(),
    ends_at: END.toISOString(),
    appointment_id: appointmentId,
    connection_id: 'conn-1',
  };
}

describe('findOrphanedStatusAppointments', () => {
  it('finds a status-subject calendar item with no matching block row', () => {
    const orphans = findOrphanedStatusAppointments(
      [calItem({ id: 'orphan-1' }), calItem({ id: 'known-1' })],
      [blockRow('known-1')],
    );
    expect(orphans.map((o) => o.id)).toEqual(['orphan-1']);
  });

  it('never flags an item outside the exact four status subjects this module writes', () => {
    const orphans = findOrphanedStatusAppointments(
      [calItem({ id: 'meeting-1', subject: 'פגישת צוות' })],
      [],
    );
    expect(orphans).toEqual([]);
  });

  it('matches all four AVAILABILITY_PRESETS subjects, not just "תפוס"', () => {
    const subjects = ['תפוס — KALFA', 'מחוץ למשרד — KALFA', 'עובד מרחוק — KALFA', 'טנטטיבי — KALFA'];
    const items = subjects.map((subject, i) => calItem({ id: `s-${i}`, subject }));
    const orphans = findOrphanedStatusAppointments(items, []);
    expect(orphans).toHaveLength(4);
  });

  it('reports nothing when every live item has a matching row', () => {
    const orphans = findOrphanedStatusAppointments(
      [calItem({ id: 'known-1' })],
      [blockRow('known-1')],
    );
    expect(orphans).toEqual([]);
  });
});
