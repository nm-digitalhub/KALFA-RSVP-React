import { describe, expect, it } from 'vitest';

import {
  classifyMessagePayload,
  isBillableMessageType,
  isRemovalIntent,
} from './inbound';

describe('classifyMessagePayload', () => {
  it('treats an inbound text message as billable (one reached signal)', () => {
    expect(classifyMessagePayload({ type: 'text' })).toEqual({
      billable: true,
      removal: false,
    });
  });

  it('does NOT bill a system/unsupported message', () => {
    expect(classifyMessagePayload({ type: 'system' })).toEqual({
      billable: false,
      removal: false,
    });
  });

  it('bills button/interactive replies (RSVP button taps)', () => {
    expect(classifyMessagePayload({ type: 'button' }).billable).toBe(true);
    expect(classifyMessagePayload({ type: 'interactive' }).billable).toBe(true);
  });

  it('flags a removal/opt-out text body as removal (still billable)', () => {
    expect(
      classifyMessagePayload({
        type: 'text',
        text: { body: 'אנא הסירו אותי מהרשימה' },
      }),
    ).toEqual({ billable: true, removal: true });
  });

  it('flags removal from an interactive button reply title', () => {
    expect(
      classifyMessagePayload({
        type: 'interactive',
        interactive: { button_reply: { title: 'STOP' } },
      }).removal,
    ).toBe(true);
  });

  it('does NOT flag a normal RSVP reply as removal (billable, removal=false)', () => {
    expect(
      classifyMessagePayload({
        type: 'text',
        text: { body: 'אני מגיע, תודה רבה!' },
      }),
    ).toEqual({ billable: true, removal: false });
  });

  it('never flags removal on a non-billable type even if text matches', () => {
    // removal is only inspected when billable — a system message can't bill or opt out.
    expect(
      classifyMessagePayload({ type: 'system', text: { body: 'הסר' } }),
    ).toEqual({ billable: false, removal: false });
  });
});

describe('isBillableMessageType', () => {
  it('accepts the four human reply types and rejects the rest', () => {
    for (const t of ['text', 'button', 'interactive', 'reaction']) {
      expect(isBillableMessageType(t)).toBe(true);
    }
    for (const t of ['system', 'unsupported', undefined, null, '']) {
      expect(isBillableMessageType(t)).toBe(false);
    }
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
