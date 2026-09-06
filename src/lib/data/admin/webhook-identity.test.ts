import { describe, expect, it } from 'vitest';

import {
  extractWebhookIdentity,
  summarizeWebhookContent,
} from './webhook-identity';

describe('extractWebhookIdentity', () => {
  it('reads the sender of an inbound message: phone + BSUID + profile from sender_contact', () => {
    expect(
      extractWebhookIdentity('message', {
        from: '972532743588',
        from_user_id: 'IL.824822393432180',
        type: 'text',
        sender_contact: {
          wa_id: '972532743588',
          user_id: 'IL.824822393432180',
          profile: { name: 'KALFA Netanel Mevorach' },
        },
      }),
    ).toEqual({
      role: 'sender',
      phone: '972532743588',
      phoneMissing: false,
      bsuid: 'IL.824822393432180',
      parentBsuid: null,
      profileName: 'KALFA Netanel Mevorach',
      username: null,
    });
  });

  it('flags a username adopter whose phone Meta did not share (no from, no wa_id)', () => {
    expect(
      extractWebhookIdentity('message', {
        from_user_id: 'US.13491208655302741918',
        from_parent_user_id: 'US.ENT.506847293015824',
        type: 'contacts',
        contacts: [{ name: { formatted_name: 'x' } }],
        sender_contact: {
          user_id: 'US.13491208655302741918',
          parent_user_id: 'US.ENT.506847293015824',
          profile: { name: 'test user name', username: '@testusername' },
        },
      }),
    ).toMatchObject({
      phone: null,
      phoneMissing: true,
      bsuid: 'US.13491208655302741918',
      parentBsuid: 'US.ENT.506847293015824',
      username: '@testusername',
    });
  });

  it('reads the recipient of a status: recipient_id, then recipient_contact for the BSUID/username', () => {
    expect(
      extractWebhookIdentity('status', {
        id: 'wamid.x',
        status: 'delivered',
        recipient_id: '16315551181',
        recipient_contact: {
          user_id: 'US.13491208655302741918',
          profile: { username: '@testusername' },
        },
      }),
    ).toMatchObject({
      role: 'recipient',
      phone: '16315551181',
      phoneMissing: false,
      bsuid: 'US.13491208655302741918',
      username: '@testusername',
    });
  });

  it('returns null for generic provider fields and for non-object payloads', () => {
    expect(extractWebhookIdentity('business_username_updates', { status: 'approved' })).toBeNull();
    expect(extractWebhookIdentity('message', null)).toBeNull();
  });
});

describe('summarizeWebhookContent', () => {
  it('decodes typed text', () => {
    expect(summarizeWebhookContent({ type: 'text', text: { body: 'היי' } })).toMatchObject({
      type: 'text',
      text: 'היי',
      replyId: null,
    });
  });

  it('decodes a template quick-reply tap (button.payload) and an interactive list reply', () => {
    expect(
      summarizeWebhookContent({ type: 'button', button: { payload: 'rsvp_yes', text: 'מגיע/ה' } }),
    ).toMatchObject({ replyId: 'rsvp_yes', replyTitle: 'מגיע/ה' });
    expect(
      summarizeWebhookContent({
        type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: 'hc_3', title: '3' } },
      }),
    ).toMatchObject({ replyId: 'hc_3', replyTitle: '3' });
  });

  it('decodes import inputs: CSV file name and shared-contact count', () => {
    expect(
      summarizeWebhookContent({ type: 'document', document: { id: 'm1', filename: 'guests.csv' } }),
    ).toMatchObject({ fileName: 'guests.csv', contactCount: null });
    expect(
      summarizeWebhookContent({ type: 'contacts', contacts: [{}, {}, {}] }),
    ).toMatchObject({ contactCount: 3 });
  });

  it('surfaces a system message body (number / BSUID change)', () => {
    expect(
      summarizeWebhookContent({
        type: 'system',
        system: { type: 'user_changed_number', body: 'User A changed from 1 to 2' },
      }),
    ).toMatchObject({ systemBody: 'User A changed from 1 to 2' });
  });
});
