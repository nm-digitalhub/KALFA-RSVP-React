import { describe, expect, it } from 'vitest';

import { AddGuestsOnboarding } from './add-guests-onboarding';

const EVENT_ID = '9f1c2d4e-6b0a-4c58-9a1e-7d3b5f8c2a10';
const CHANNEL = {
  displayNumber: '+97233301505',
  waMeUrl: 'https://wa.me/97233301505',
};

type El = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };

// Flatten the returned element tree. Nested FUNCTION components are INVOKED —
// <Option> is where the href and the description actually live, and a walker
// that only descends `children` would see an unexecuted element and assert
// nothing. (The page tests' collect() deliberately does not invoke; here it is
// the whole point.)
function collect(node: unknown, out: El[] = [], depth = 0): El[] {
  if (!node || typeof node !== 'object' || depth > 40) return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out, depth + 1));
    return out;
  }
  const el = node as El;
  out.push(el);
  if (typeof el.type === 'function') {
    try {
      collect((el.type as (p: unknown) => unknown)(el.props ?? {}), out, depth + 1);
    } catch {
      // A component that needs a runtime we do not have here is simply not
      // descended into; the assertions below name what must be found.
    }
  }
  collect(el.props?.children, out, depth + 1);
  return out;
}

function hrefs(tree: unknown): string[] {
  return collect(tree)
    .map((el) => (el.props?.href ?? el.props?.['href']) as unknown)
    .filter((h): h is string => typeof h === 'string');
}

function texts(tree: unknown): string {
  return collect(tree)
    .flatMap((el) => {
      const bits: unknown[] = [el.props?.children, el.props?.description, el.props?.title];
      return bits.flatMap((b) => (Array.isArray(b) ? b : [b]));
    })
    .filter((t): t is string => typeof t === 'string')
    .join(' ');
}

function render(importChannel: typeof CHANNEL | null) {
  return AddGuestsOnboarding({
    eventId: EVENT_ID,
    eventName: 'החתונה של דנה ויוסי',
    stage: 'active',
    importChannel,
  });
}

describe('AddGuestsOnboarding — the WhatsApp option', () => {
  it('with a number wired: opens WhatsApp ON that number, and names it', () => {
    const tree = render(CHANNEL);
    expect(hrefs(tree)).toContain('https://wa.me/97233301505');
    expect(texts(tree)).toContain('+97233301505');
  });

  it('the outbound link is new-tab and rel-guarded (it leaves the app)', () => {
    // Two elements carry the href: the <Option> wrapper and the <Link> it
    // renders. The anchor is the one that also carries the target.
    const anchors = collect(render(CHANNEL)).filter(
      (el) => el.props?.href === 'https://wa.me/97233301505' && el.props?.target,
    );
    expect(anchors).toHaveLength(1);
    expect(anchors[0].props?.target).toBe('_blank');
    expect(String(anchors[0].props?.rel)).toContain('noopener');
  });

  it('with NO number: falls back to the in-app import screen, unchanged', () => {
    const tree = render(null);
    const links = hrefs(tree);
    expect(links).toContain(`/app/events/${EVENT_ID}/guests/import/whatsapp`);
    expect(links.some((h) => h.includes('wa.me'))).toBe(false);
    expect(texts(tree)).toContain('שלחו אנשי קשר או קובץ ל־KALFA');
  });

  it('the other two options never change with the channel', () => {
    for (const channel of [CHANNEL, null]) {
      const links = hrefs(render(channel));
      expect(links).toContain(`/app/events/${EVENT_ID}/guests/import`);
      expect(links).toContain(`/app/events/${EVENT_ID}/guests/new`);
    }
  });
});
