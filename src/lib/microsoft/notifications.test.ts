import { describe, expect, it } from 'vitest';

import { graphNotificationRows, type GraphNotification } from './notifications';

const SECRET = 'client-state-secret';
const NOW = Date.parse('2026-10-30T10:15:00Z');

// The shape MEASURED 30.10.2026 on every stored intake row.
const mail: GraphNotification = {
  subscriptionId: 'sub-mail',
  clientState: SECRET,
  changeType: 'created',
  resource: 'Users/1111/Messages/AAMkMsg',
  resourceData: { '@odata.type': '#Microsoft.Graph.Message', '@odata.etag': 'W/"m1"', id: 'AAMkMsg' },
  subscriptionExpirationDateTime: '2026-11-01T00:00:00Z',
};

function event(changeType: string, etag?: string): GraphNotification {
  return {
    subscriptionId: 'sub-cal',
    clientState: SECRET,
    changeType,
    resource: 'Users/1111/Events/AAMkEvt',
    resourceData: { '@odata.type': '#Microsoft.Graph.Event', ...(etag ? { '@odata.etag': etag } : {}), id: 'AAMkEvt' },
  };
}

describe('graphNotificationRows', () => {
  it('a mail notification is the same row as before, without the client state', () => {
    expect(graphNotificationRows([mail], SECRET, NOW)).toEqual([
      {
        provider: 'graph',
        event_kind: 'graph_mail',
        dedupe_key: 'graph-mail:AAMkMsg',
        message_id: 'AAMkMsg',
        context_message_id: null,
        phone_number_id: null,
        event_at: null,
        payload: {
          subscriptionId: 'sub-mail',
          changeType: 'created',
          resource: 'Users/1111/Messages/AAMkMsg',
          resourceData: mail.resourceData,
          subscriptionExpirationDateTime: '2026-11-01T00:00:00Z',
        },
      },
    ]);
  });

  it('never stores the client state, which is the webhook secret', () => {
    const rows = graphNotificationRows([mail, event('updated', 'W/"e1"')], SECRET, NOW);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });

  it('drops a notification whose client state does not match', () => {
    expect(graphNotificationRows([{ ...mail, clientState: 'other' }], SECRET, NOW)).toEqual([]);
  });

  it('a calendar notification is a calendar row, whatever the subscription', () => {
    const [row] = graphNotificationRows([event('created', 'W/"e1"')], SECRET, NOW);
    expect(row).toMatchObject({ event_kind: 'graph_calendar', message_id: null });
  });

  it('two updates of one event are two rows — the etag moves with each change', () => {
    const rows = graphNotificationRows([event('updated', 'W/"e1"'), event('updated', 'W/"e2"')], SECRET, NOW);
    expect(new Set(rows.map((r) => r.dedupe_key)).size).toBe(2);
  });

  it('a redelivered update is the same row', () => {
    const a = graphNotificationRows([event('updated', 'W/"e1"')], SECRET, NOW);
    const b = graphNotificationRows([event('updated', 'W/"e1"')], SECRET, NOW + 60_000);
    expect(a[0].dedupe_key).toBe(b[0].dedupe_key);
  });

  it('recognises an event by its resource when the type is absent', () => {
    const [row] = graphNotificationRows(
      [{ ...event('deleted'), resourceData: { id: 'AAMkEvt' }, resource: "Users('1111')/events('AAMkEvt')" }],
      SECRET,
      NOW,
    );
    expect(row.event_kind).toBe('graph_calendar');
  });

  it('a lifecycle notification is a lifecycle row, though it carries no resource data', () => {
    const lifecycle: GraphNotification = {
      subscriptionId: 'sub-cal',
      clientState: SECRET,
      lifecycleEvent: 'missed',
      subscriptionExpirationDateTime: '2026-11-01T00:00:00Z',
    };
    const [row] = graphNotificationRows([lifecycle], SECRET, NOW);
    expect(row).toMatchObject({ event_kind: 'graph_lifecycle', message_id: null });

    // A redelivery within the hour collapses; the same event an hour later does not.
    const again = graphNotificationRows([lifecycle], SECRET, NOW + 10 * 60_000)[0];
    const later = graphNotificationRows([lifecycle], SECRET, NOW + 60 * 60_000)[0];
    expect(again.dedupe_key).toBe(row.dedupe_key);
    expect(later.dedupe_key).not.toBe(row.dedupe_key);
  });

  it('a mail notification without a message id is still dropped', () => {
    expect(graphNotificationRows([{ ...mail, resourceData: {} }], SECRET, NOW)).toEqual([]);
  });
});
