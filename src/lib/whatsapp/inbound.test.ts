import { describe, expect, it } from 'vitest';

import { classifyInbound } from './inbound';

describe('classifyInbound', () => {
  it('treats an inbound text message as billable (one reached signal)', () => {
    const r = classifyInbound({
      messages: [{ id: 'wamid.1', from: '972501234567', type: 'text' }],
    });
    expect(r.billableMessages).toEqual([
      { providerId: 'wamid.1', from: '972501234567' },
    ]);
    expect(r.statuses).toEqual([]);
  });

  it('does NOT bill on a delivered/read status (op-status only)', () => {
    const r = classifyInbound({
      statuses: [{ id: 'wamid.1', status: 'delivered' }],
    });
    expect(r.billableMessages).toEqual([]);
    expect(r.statuses).toEqual([{ providerId: 'wamid.1', status: 'delivered' }]);
  });

  it('does NOT bill a system/unsupported message', () => {
    const r = classifyInbound({
      messages: [{ id: 'wamid.2', from: '972500000000', type: 'system' }],
    });
    expect(r.billableMessages).toEqual([]);
  });

  it('bills button/interactive replies (RSVP button taps)', () => {
    const r = classifyInbound({
      messages: [{ id: 'wamid.3', from: '972501111111', type: 'button' }],
    });
    expect(r.billableMessages).toHaveLength(1);
  });

  it('returns empty arrays for an empty value', () => {
    expect(classifyInbound({})).toEqual({ billableMessages: [], statuses: [] });
  });
});
