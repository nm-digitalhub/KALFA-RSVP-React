import { describe, expect, it } from 'vitest';

import {
  classifyMessagePayload,
  extractReplyId,
  isBillableMessageType,
} from './inbound';

describe('classifyMessagePayload', () => {
  it('treats an inbound text message as billable (one reached signal)', () => {
    expect(classifyMessagePayload({ type: 'text' })).toEqual({
      billable: true,
      replyId: null,
    });
  });

  it('does NOT bill a system/unsupported message', () => {
    expect(classifyMessagePayload({ type: 'system' })).toEqual({
      billable: false,
      replyId: null,
    });
  });

  it('bills button/interactive replies (RSVP button taps)', () => {
    expect(classifyMessagePayload({ type: 'button' }).billable).toBe(true);
    expect(classifyMessagePayload({ type: 'interactive' }).billable).toBe(true);
  });

  it('a text asking to be removed is an ordinary billable reply (owner, 01.11.2026)', () => {
    expect(
      classifyMessagePayload({
        type: 'text',
        text: { body: 'אנא הסירו אותי מהרשימה' },
      }),
    ).toEqual({ billable: true, replyId: null });
  });

  it('a normal RSVP reply is billable', () => {
    expect(
      classifyMessagePayload({
        type: 'text',
        text: { body: 'אני מגיע, תודה רבה!' },
      }),
    ).toEqual({ billable: true, replyId: null });
  });

  it('surfaces the opaque reply id of a template quick-reply button (billable)', () => {
    expect(
      classifyMessagePayload({
        type: 'button',
        button: { payload: 'rsvp_attending', text: 'אני מגיע' },
      }),
    ).toEqual({ billable: true, replyId: 'rsvp_attending' });
  });

  it('surfaces the opaque id of an interactive button reply (billable)', () => {
    expect(
      classifyMessagePayload({
        type: 'interactive',
        interactive: { button_reply: { id: 'rsvp_declined', title: 'לא מגיע' } },
      }),
    ).toEqual({ billable: true, replyId: 'rsvp_declined' });
  });

  it('never surfaces a reply id on a non-billable type', () => {
    // replyId is only inspected when billable.
    expect(
      classifyMessagePayload({
        type: 'system',
        button: { payload: 'rsvp_attending' },
      }),
    ).toEqual({ billable: false, replyId: null });
  });
});

describe('extractReplyId', () => {
  it('reads a template quick-reply button payload', () => {
    expect(
      extractReplyId({ type: 'button', button: { payload: 'rsvp_attending' } }),
    ).toBe('rsvp_attending');
  });

  it('reads an interactive button_reply id', () => {
    expect(
      extractReplyId({
        type: 'interactive',
        interactive: { button_reply: { id: 'rsvp_declined' } },
      }),
    ).toBe('rsvp_declined');
  });

  it('reads an interactive list_reply id', () => {
    expect(
      extractReplyId({
        type: 'interactive',
        interactive: { list_reply: { id: 'rsvp_maybe' } },
      }),
    ).toBe('rsvp_maybe');
  });

  it('returns null when no reply id is present (plain text / reaction)', () => {
    expect(extractReplyId({ type: 'text', text: { body: 'אני מגיע' } })).toBeNull();
    expect(extractReplyId({ type: 'reaction' })).toBeNull();
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
