import { describe, expect, it } from 'vitest';

import { classifyInbound, isRemovalIntent } from './inbound';

describe('classifyInbound', () => {
  it('treats an inbound text message as billable (one reached signal)', () => {
    const r = classifyInbound({
      messages: [{ id: 'wamid.1', from: '972501234567', type: 'text' }],
    });
    expect(r.billableMessages).toEqual([
      { providerId: 'wamid.1', from: '972501234567', removal: false },
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

  it('flags a removal/opt-out text body as removal (still billable)', () => {
    const r = classifyInbound({
      messages: [
        {
          id: 'wamid.r',
          from: '972501234567',
          type: 'text',
          text: { body: 'אנא הסירו אותי מהרשימה' },
        },
      ],
    });
    expect(r.billableMessages).toEqual([
      { providerId: 'wamid.r', from: '972501234567', removal: true },
    ]);
  });

  it('flags removal from an interactive button reply title', () => {
    const r = classifyInbound({
      messages: [
        {
          id: 'wamid.i',
          from: '972501234567',
          type: 'interactive',
          interactive: { button_reply: { title: 'STOP' } },
        },
      ],
    });
    expect(r.billableMessages[0].removal).toBe(true);
  });

  it('does NOT flag a normal RSVP reply as removal (billable, removal=false)', () => {
    const r = classifyInbound({
      messages: [
        {
          id: 'wamid.y',
          from: '972501234567',
          type: 'text',
          text: { body: 'אני מגיע, תודה רבה!' },
        },
      ],
    });
    expect(r.billableMessages).toEqual([
      { providerId: 'wamid.y', from: '972501234567', removal: false },
    ]);
  });
});

describe('isRemovalIntent', () => {
  it('matches explicit opt-out keywords (Hebrew + English, any case)', () => {
    expect(isRemovalIntent('הסר')).toBe(true);
    expect(isRemovalIntent('להסיר אותי בבקשה')).toBe(true);
    expect(isRemovalIntent('Please STOP')).toBe(true);
    expect(isRemovalIntent('unsubscribe')).toBe(true);
  });

  it('does not match ordinary replies or empty text', () => {
    expect(isRemovalIntent('')).toBe(false);
    expect(isRemovalIntent('אני מגיע')).toBe(false);
    expect(isRemovalIntent('כמה אורחים אפשר להביא?')).toBe(false);
  });
});
