import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('./setup-stepper', () => ({
  SetupStepper: ({ steps, back }: { steps: Array<{ key: string }>; back: { href: string } | null }) => (
    <div data-marker="stepper" data-steps={steps.map((s) => s.key).join(',')} data-back={back?.href ?? ''} />
  ),
}));
vi.mock('./event-status-actions', () => ({
  EventStatusActions: ({ closeAllowed }: { closeAllowed: boolean }) => (
    <div data-marker="close-control" data-allowed={String(closeAllowed)} />
  ),
}));

import { SetupShell } from './setup-shell';

// The one frame of the setup flow (design D3, task 4.1): the step list appears exactly once, with one close control
// and one content surface around whatever the step renders.

const STEPS = [
  { key: 'details' as const, state: 'done' as const, label: 'פרטי האירוע' },
  { key: 'pay' as const, state: 'current' as const, label: 'תשלום החבילה' },
];
const CLOSE = { status: 'active' as const, closeAllowed: true, blockedHint: null, closeAction: vi.fn() };

const count = (html: string, needle: string) => html.split(needle).length - 1;

function render(close: typeof CLOSE | null = CLOSE) {
  return renderToStaticMarkup(
    <SetupShell eventId="e1" eventName="החתונה" steps={STEPS} back={null} close={close}>
      <h2>תשלום החבילה</h2>
      <div data-marker="step-content" />
    </SetupShell>,
  );
}

describe('SetupShell', () => {
  it('renders exactly one stepper and one close control', () => {
    const html = render();
    expect(count(html, 'data-marker="stepper"')).toBe(1);
    expect(count(html, 'data-marker="close-control"')).toBe(1);
    expect(html).toContain('data-steps="details,pay"');
  });

  it('puts the step content inside one framed surface, after the stepper', () => {
    const html = render();
    const surfaces = html.match(/<section[^>]*>/g) ?? [];
    // The stepper's own frame and the content surface: nothing else is framed by the shell.
    expect(surfaces).toHaveLength(2);
    const content = html.slice(html.lastIndexOf('<section'));
    expect(content).toContain('data-marker="step-content"');
    expect(content).not.toContain('data-marker="stepper"');
    expect(html.indexOf('data-marker="stepper"')).toBeLessThan(html.indexOf('data-marker="step-content"'));
  });

  it('renders no close control for a viewer who may not close the event', () => {
    expect(count(render(null), 'data-marker="close-control"')).toBe(0);
  });

  it('names the flow and the event once, in its header', () => {
    const html = render();
    expect(count(html, '<h1')).toBe(1);
    expect(html).toContain('הקמת אישורי הגעה');
    expect(html).toContain('החתונה');
  });
});
