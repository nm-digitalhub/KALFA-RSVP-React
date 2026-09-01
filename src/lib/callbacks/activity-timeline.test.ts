import { describe, expect, it } from 'vitest';

import { buildCallbackActivity, type TimelineSalesCall } from './activity-timeline';

function salesCall(overrides: Partial<TimelineSalesCall> = {}): TimelineSalesCall {
  return {
    source: 'sales',
    attemptId: 'attempt-1',
    dispatchStatus: 'concluded',
    attemptCreatedAt: '2026-09-01T09:00:00+00:00',
    attemptUpdatedAt: '2026-09-01T09:00:00+00:00',
    waDeliveryStatus: null,
    waDeliveryErrorCode: null,
    waStatusAt: null,
    signupCompletedAt: null,
    outcomeRecordedAt: null,
    hasAnalysis: false,
    callSuccessful: 'unknown',
    callSuccessScore: null,
    analysisAt: null,
    ...overrides,
  };
}

describe('buildCallbackActivity', () => {
  it('always records the request itself, even with nothing else to show', () => {
    const entries = buildCallbackActivity({
      createdAt: '2026-09-01T08:00:00+00:00',
      scheduledAt: null,
      status: 'scheduled',
      salesCalls: [],
    });
    expect(entries).toEqual([
      { key: 'callback:created', at: '2026-09-01T08:00:00+00:00', title: 'הפנייה התקבלה' },
    ]);
  });

  it('marks the diary slot as planned rather than as something that happened', () => {
    const entries = buildCallbackActivity({
      createdAt: '2026-09-01T08:00:00+00:00',
      scheduledAt: '2026-09-02T11:30:00+00:00',
      status: 'scheduled',
      salesCalls: [],
    });
    expect(entries[0]).toMatchObject({ key: 'callback:scheduled', planned: true });
    expect(entries[1]).toMatchObject({ key: 'callback:created' });
  });

  // closeCallbackAppointment only nulls scheduled_at once Exchange archived the
  // appointment, so a closed/cancelled row can still be holding its old slot.
  it.each(['cancelled', 'closed'])(
    'stops promising a call once the request is %s',
    (status) => {
      const [slot] = buildCallbackActivity({
        createdAt: '2026-09-01T08:00:00+00:00',
        scheduledAt: '2026-09-02T11:30:00+00:00',
        status,
        salesCalls: [],
      });
      expect(slot).toMatchObject({ key: 'callback:scheduled', title: 'שובצה ביומן' });
      expect(slot.planned).toBeUndefined();
    },
  );

  it('orders newest first across the request and every attempt', () => {
    const entries = buildCallbackActivity({
      createdAt: '2026-09-01T08:00:00+00:00',
      scheduledAt: null,
      status: 'scheduled',
      salesCalls: [
        salesCall({
          attemptId: 'a1',
          attemptCreatedAt: '2026-09-01T09:00:00+00:00',
          attemptUpdatedAt: '2026-09-01T09:04:00+00:00',
          outcomeRecordedAt: '2026-09-01T09:03:00+00:00',
          hasAnalysis: true,
          analysisAt: '2026-09-01T09:04:00+00:00',
          callSuccessful: 'success',
          callSuccessScore: 87,
        }),
      ],
    });
    expect(entries.map((e) => e.key)).toEqual([
      'a1:analysis',
      'a1:outcome',
      'a1:created',
      'callback:created',
    ]);
  });

  it('compares instants, not strings, so a "Z" timestamp is not sorted apart', () => {
    const entries = buildCallbackActivity({
      createdAt: '2026-09-01T08:00:00+00:00',
      scheduledAt: null,
      status: 'scheduled',
      salesCalls: [
        salesCall({
          attemptId: 'a1',
          attemptCreatedAt: '2026-09-01T07:00:00Z',
          attemptUpdatedAt: '2026-09-01T07:00:00Z',
        }),
      ],
    });
    expect(entries.map((e) => e.key)).toEqual(['callback:created', 'a1:created']);
  });

  it('spells out the analysis verdict and score in one line', () => {
    const [analysis] = buildCallbackActivity({
      createdAt: '2026-09-01T08:00:00+00:00',
      scheduledAt: null,
      status: 'scheduled',
      salesCalls: [
        salesCall({
          hasAnalysis: true,
          analysisAt: '2026-09-01T09:05:00+00:00',
          callSuccessful: 'success',
          callSuccessScore: 87,
        }),
      ],
    });
    expect(analysis).toMatchObject({ detail: 'הצליחה · ציון 87' });
  });

  it('omits the analysis line while the webhook has not landed yet', () => {
    const entries = buildCallbackActivity({
      createdAt: '2026-09-01T08:00:00+00:00',
      scheduledAt: null,
      status: 'scheduled',
      salesCalls: [salesCall({ hasAnalysis: false, analysisAt: null })],
    });
    expect(entries.some((e) => e.key.endsWith(':analysis'))).toBe(false);
  });

  it('reports a failed signup-link delivery with the provider error code', () => {
    const entries = buildCallbackActivity({
      createdAt: '2026-09-01T08:00:00+00:00',
      scheduledAt: null,
      status: 'scheduled',
      salesCalls: [
        salesCall({
          waDeliveryStatus: 'failed',
          waDeliveryErrorCode: '131049',
          waStatusAt: '2026-09-01T09:02:00+00:00',
        }),
      ],
    });
    expect(entries.find((e) => e.key.endsWith(':wa'))).toMatchObject({
      title: 'קישור הרשמה — נכשל',
      detail: 'שגיאת מסירה 131049',
    });
  });

  // The point of the whole "emitted" set: a row whose mtime already has a
  // named event must not also print a contentless "last updated" line.
  it('does not duplicate a timestamp an explicit event already covers', () => {
    const entries = buildCallbackActivity({
      createdAt: '2026-09-01T08:00:00+00:00',
      scheduledAt: null,
      status: 'scheduled',
      salesCalls: [
        salesCall({
          attemptUpdatedAt: '2026-09-01T09:03:00+00:00',
          outcomeRecordedAt: '2026-09-01T09:03:00+00:00',
        }),
      ],
    });
    expect(entries.some((e) => e.key.endsWith(':updated'))).toBe(false);
  });

  it('keeps the last-updated line when it is the only trace of the change', () => {
    const entries = buildCallbackActivity({
      createdAt: '2026-09-01T08:00:00+00:00',
      scheduledAt: null,
      status: 'scheduled',
      salesCalls: [
        salesCall({
          dispatchStatus: 'concluded',
          attemptCreatedAt: '2026-09-01T09:00:00+00:00',
          attemptUpdatedAt: '2026-09-01T09:06:00+00:00',
        }),
      ],
    });
    expect(entries[0]).toMatchObject({
      key: 'attempt-1:updated',
      title: 'שיחה #1 — עדכון אחרון',
      detail: 'הסתיימה',
    });
  });

  it('numbers each attempt in the order the DAL returns them', () => {
    const entries = buildCallbackActivity({
      createdAt: '2026-09-01T08:00:00+00:00',
      scheduledAt: null,
      status: 'scheduled',
      salesCalls: [
        salesCall({ attemptId: 'a1', attemptCreatedAt: '2026-09-01T09:00:00+00:00' }),
        salesCall({
          attemptId: 'a2',
          attemptCreatedAt: '2026-09-01T10:00:00+00:00',
          attemptUpdatedAt: '2026-09-01T10:00:00+00:00',
        }),
      ],
    });
    expect(entries.map((e) => e.title)).toEqual([
      'שיחת מכירות #2 נוצרה',
      'שיחת מכירות #1 נוצרה',
      'הפנייה התקבלה',
    ]);
  });

  // The timeline is persona-agnostic by construction: it maps the same list the
  // card does, so a meeting-confirmation call appears without a branch of its
  // own — only its label differs.
  it('names each entry by the persona that placed the call', () => {
    const entries = buildCallbackActivity({
      createdAt: '2026-09-01T08:00:00+00:00',
      scheduledAt: null,
      status: 'scheduled',
      salesCalls: [
        salesCall({ source: 'meeting_confirm', attemptId: 'c1' }),
        salesCall({
          source: 'sales',
          attemptId: 's1',
          attemptCreatedAt: '2026-09-01T10:00:00+00:00',
          attemptUpdatedAt: '2026-09-01T10:00:00+00:00',
        }),
      ],
    });
    expect(entries.map((e) => e.title)).toEqual([
      'שיחת מכירות #2 נוצרה',
      'אישור פגישה #1 נוצרה',
      'הפנייה התקבלה',
    ]);
  });
});
