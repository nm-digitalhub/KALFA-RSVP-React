import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { INQUIRY_TOPICS } from '@/lib/validation/inquiries';
import { TOPIC_TO_QUEUE_KEY } from '@/lib/data/inquiries';

// The queue keys as they exist in console_queues. Duplicated here ON PURPOSE:
// this test is the tripwire for the two vocabularies drifting apart, and reading
// the real table would make it pass by construction.
const QUEUE_KEYS = ['sales', 'support', 'events', 'billing'];

// 'אחר' is not a queue and must stay unmapped — an unrouted inquiry is visible
// and triageable, a wrongly-routed one is not.
const UNROUTED = 'אחר';

describe('topic → queue routing', () => {
  // The bug this exists to prevent, measured 16.08: the original prescription
  // matched `console_queues.name_he` against the topic string. For billing those
  // are 'גבייה' and 'חיוב ותשלום' — different — so every billing inquiry would
  // have failed to route with no error at all. It looked correct because no
  // customer had chosen that option yet, so counting existing rows hid it.
  it.each(INQUIRY_TOPICS.filter((t) => t !== UNROUTED))(
    'topic %s maps to a real queue key',
    (topic) => {
      const key = TOPIC_TO_QUEUE_KEY[topic];
      expect(key, `topic "${topic}" has no queue mapping`).toBeDefined();
      expect(QUEUE_KEYS, `topic "${topic}" maps to unknown queue "${key}"`).toContain(key);
    },
  );

  it('leaves אחר deliberately unrouted', () => {
    expect(TOPIC_TO_QUEUE_KEY[UNROUTED]).toBeUndefined();
  });

  // Keying on `key` rather than `name_he` is what makes a queue rename a display
  // change instead of a silent re-route.
  it('maps to keys, never to Hebrew display names', () => {
    for (const key of Object.values(TOPIC_TO_QUEUE_KEY)) {
      expect(key).toMatch(/^[a-z_]+$/);
    }
  });

  it('never maps a topic the form cannot produce', () => {
    for (const topic of Object.keys(TOPIC_TO_QUEUE_KEY)) {
      expect(INQUIRY_TOPICS as readonly string[]).toContain(topic);
    }
  });
});
