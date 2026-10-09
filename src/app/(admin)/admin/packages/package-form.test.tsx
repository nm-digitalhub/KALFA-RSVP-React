// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ScheduleStepOption } from '@/lib/data/schedule-picker';
import { PackageForm, type PackageFormInitial, type PricingModelStatus, type ScheduleSeed } from './package-form';

// The description and includes fields call a Server Action to rewrite their text. The real one needs the server (server-only, the
// Claude process), so the form is rendered here with a stand-in; the field itself has its own tests (package-copy-field.test.tsx).
vi.mock('./rewrite-action', () => ({ rewritePackageCopyAction: vi.fn() }));

// The package form edits two kinds of package. The pay-per-result package carries the per-reached formula (a price per
// contact, a base fee, an included count) and the card-hold floor and buffer. The fixed-price package carries ONE
// number instead — its contact quota — and none of those: its price is the package's own price, charged once. The form
// shows only the fields of the model being edited, and a field that is not shown is not submitted, so a stale formula
// value can never ride along with a quota.

afterEach(cleanup);

const CHANNELS = [
  { key: 'whatsapp', display_name: 'וואטסאפ', is_built: true },
  { key: 'call', display_name: 'שיחת AI', is_built: true },
];
const PRICING: PricingModelStatus = { gateActive: true, effectiveSummaryHe: null, headlineMismatch: null };
const BASE: PackageFormInitial = {
  name: 'חבילה',
  tier: 'gold',
  category: 'wedding',
  description: '',
  price_with_vat: 1000,
  includes: [],
  active: true,
  sort_order: 0,
  price_per_reached: '',
  base_price: '',
  included_reached: '',
  contact_quota: '',
  channels: ['whatsapp'],
  outreach_schedule: [],
  min_hold_floor: '',
  hold_buffer_pct_percent: '',
};

const STEPS: ScheduleStepOption[] = [
  { channel: 'call', messageKey: 'call_1', label: 'שיחה ראשונה', problem: null },
  { channel: 'whatsapp', messageKey: 'invite', label: 'הזמנה', problem: null },
  { channel: 'whatsapp', messageKey: 'reminder_1', label: 'תזכורת ראשונה', problem: null },
  { channel: 'whatsapp', messageKey: 'final', label: 'הודעה אחרונה', problem: 'אין תבנית מאושרת ב-Meta' },
];

function form(initial: Partial<PackageFormInitial> = {}) {
  return render(
    <PackageForm
      action={vi.fn()}
      initial={{ ...BASE, ...initial }}
      submitLabel="שמירה"
      callChannelStatus="live"
      channelOptions={CHANNELS}
      pricingModelStatus={PRICING}
      scheduleOptions={STEPS}
    />,
  );
}

// The create page passes no `initial`: the form is empty, and may start from the schedule of an existing package.
function createForm(scheduleSeed: ScheduleSeed | null = null) {
  return render(
    <PackageForm
      action={vi.fn()}
      submitLabel="יצירה"
      callChannelStatus="live"
      channelOptions={CHANNELS}
      pricingModelStatus={PRICING}
      scheduleOptions={STEPS}
      scheduleSeed={scheduleSeed}
    />,
  );
}
const submitted = (container: HTMLElement) =>
  JSON.parse((container.querySelector('[name="outreach_schedule_json"]') as HTMLInputElement).value) as Array<{
    days_before: number | '';
    channel: string;
    message_key: string;
  }>;
const field = (container: HTMLElement, name: string) => container.querySelector(`[name="${name}"]`);
const FORMULA_AND_HOLD = ['price_per_reached', 'base_price', 'included_reached', 'min_hold_floor', 'hold_buffer_pct'];

describe('PackageForm — the pay-per-result package (unchanged)', () => {
  it('shows the per-reached formula and the hold fields, and no quota field', () => {
    const { container } = form();
    for (const name of FORMULA_AND_HOLD) expect(field(container, name), name).not.toBeNull();
    expect(field(container, 'contact_quota')).toBeNull();
    expect((screen.getByLabelText('חיוב לפי תוצאה') as HTMLInputElement).checked).toBe(true);
  });
});

describe('PackageForm — the fixed-price package', () => {
  it('opens in this model when the package already has a quota, showing it and hiding the formula and hold fields', () => {
    const { container } = form({ contact_quota: 40 });
    expect((screen.getByLabelText('חבילה במחיר קבוע עם מכסה') as HTMLInputElement).checked).toBe(true);
    expect((field(container, 'contact_quota') as HTMLInputElement).value).toBe('40');
    for (const name of FORMULA_AND_HOLD) expect(field(container, name), name).toBeNull();
  });

  it('switching to it shows the quota field and removes every formula and hold field from the DOM — nothing stale is submitted', () => {
    const { container } = form({ price_per_reached: 4, base_price: 200, included_reached: 200, min_hold_floor: 50, hold_buffer_pct_percent: 10 });
    fireEvent.click(screen.getByLabelText('חבילה במחיר קבוע עם מכסה'));
    expect(field(container, 'contact_quota')).not.toBeNull();
    for (const name of FORMULA_AND_HOLD) expect(field(container, name), name).toBeNull();
  });

  it('the quota is required in this model (and a whole number from 1)', () => {
    const { container } = form({ contact_quota: 40 });
    const quota = field(container, 'contact_quota') as HTMLInputElement;
    expect(quota.required).toBe(true);
    expect(quota.min).toBe('1');
    expect(quota.step).toBe('1');
  });

  it('switching back restores the formula fields with what was saved, and drops the quota field', () => {
    const { container } = form({ price_per_reached: 4 });
    fireEvent.click(screen.getByLabelText('חבילה במחיר קבוע עם מכסה'));
    fireEvent.click(screen.getByLabelText('חיוב לפי תוצאה'));
    expect((field(container, 'price_per_reached') as HTMLInputElement).value).toBe('4');
    expect(field(container, 'contact_quota')).toBeNull();
  });

  it('keeps what both models share: the price, the channels and the outreach schedule', () => {
    const { container } = form({ contact_quota: 40 });
    expect(field(container, 'price_with_vat')).not.toBeNull();
    expect(container.querySelectorAll('[name="channels"]')).toHaveLength(2);
    expect(field(container, 'outreach_schedule_json')).not.toBeNull();
    expect(screen.getByText('+ הוספת שלב')).toBeTruthy();
  });

  it('says what the model means, and never talks about a hold or the provider', () => {
    const { container } = form({ contact_quota: 40 });
    expect(container.textContent).toContain('מכסת אנשי קשר');
    expect(container.textContent).toContain('נגבה פעם אחת');
    expect(container.textContent).not.toMatch(/J5|hold|תפיסת מסגרת/i);
    expect(container.textContent).not.toMatch(/sumit/i);
  });

  it('shows the server\'s answer for the quota field', () => {
    // exercised through useActionState in the app; here only that the error slot exists beside the field
    const { container } = form({ contact_quota: 40 });
    expect(container.querySelector('#contact_quota')).not.toBeNull();
  });
});

describe('PackageForm — the outreach schedule is picked, not typed', () => {
  it('offers the steps of the row\'s channel in a list, with no free-text key field', () => {
    const { container } = form({ outreach_schedule: [{ days_before: 6, channel: 'whatsapp', message_key: 'reminder_1' }] });
    expect(container.querySelector('input[type="text"][dir="ltr"]')).toBeNull();
    const pick = screen.getByLabelText('תבנית הודעה') as HTMLSelectElement;
    expect(Array.from(pick.options).map((o) => o.value)).toEqual(['invite', 'reminder_1', 'final']);
    expect(pick.value).toBe('reminder_1');
  });

  it('shows a step that cannot be picked with the reason, disabled', () => {
    form({ outreach_schedule: [{ days_before: 1, channel: 'whatsapp', message_key: 'invite' }] });
    const final = screen.getByRole('option', { name: /הודעה אחרונה/ }) as HTMLOptionElement;
    expect(final.disabled).toBe(true);
    expect(final.textContent).toContain('אין תבנית מאושרת ב-Meta');
  });

  it('keeps a stored key that is not on offer, selected and marked, instead of swapping it silently', () => {
    const { container } = form({ outreach_schedule: [{ days_before: 3, channel: 'whatsapp', message_key: 'old_step' }] });
    const pick = screen.getByLabelText('תבנית הודעה') as HTMLSelectElement;
    expect(pick.value).toBe('old_step');
    expect(screen.getByRole('option', { name: 'old_step (לא זמין)' })).toBeTruthy();
    expect(submitted(container)[0].message_key).toBe('old_step');
  });

  it('a new row starts on the first step that can be picked, so it never reaches the server without a template', () => {
    const { container } = form();
    fireEvent.click(screen.getByText('+ הוספת שלב'));
    expect(submitted(container)).toEqual([{ days_before: '', channel: 'whatsapp', message_key: 'invite' }]);
  });

  it('changing the channel of a row moves it to a step of the new channel', () => {
    const { container } = form({
      channels: ['whatsapp', 'call'],
      outreach_schedule: [{ days_before: 2, channel: 'whatsapp', message_key: 'reminder_1' }],
    });
    fireEvent.change(screen.getByLabelText('ערוץ'), { target: { value: 'call' } });
    expect(submitted(container)).toEqual([{ days_before: 2, channel: 'call', message_key: 'call_1' }]);
    expect(screen.getByLabelText('תסריט שיחה')).toBeTruthy();
  });

  it('picking another step is what gets submitted', () => {
    const { container } = form({ outreach_schedule: [{ days_before: 6, channel: 'whatsapp', message_key: 'reminder_1' }] });
    fireEvent.change(screen.getByLabelText('תבנית הודעה'), { target: { value: 'invite' } });
    expect(submitted(container)[0].message_key).toBe('invite');
  });

  it('calls the section "לוח פניות" and says what a step is', () => {
    const { container } = form();
    expect(container.textContent).toContain('לוח פניות');
    expect(container.textContent).not.toContain('outreach schedule');
    expect(container.textContent).toContain('מספר ימים לפני האירוע');
  });
});

describe('PackageForm — a new package does not start with an empty schedule', () => {
  const SEED: ScheduleSeed = {
    fromName: 'חבילת הדגל',
    channels: ['whatsapp', 'call'],
    schedule: [
      { days_before: 10, channel: 'whatsapp', message_key: 'invite' },
      { days_before: 2, channel: 'call', message_key: 'call_1' },
    ],
  };

  it('starts from the suggested schedule and channels, and says where they came from', () => {
    const { container } = createForm(SEED);
    expect(submitted(container)).toEqual(SEED.schedule);
    expect((container.querySelectorAll('[name="channels"]:checked')).length).toBe(2);
    // The notice itself, by its words: the description and includes fields keep their own (empty, screen-reader-only) live regions.
    expect(screen.getByText(/הלוח והערוצים הועתקו מהחבילה/).textContent).toContain('חבילת הדגל');
  });

  it('with nothing to suggest the form is empty, as before, and says nothing', () => {
    const { container } = createForm(null);
    expect(submitted(container)).toEqual([]);
    expect(screen.queryByText(/הלוח והערוצים הועתקו מהחבילה/)).toBeNull();
  });

  it('is only for creating: an edited package keeps its own schedule and is never overwritten by a suggestion', () => {
    const { container } = render(
      <PackageForm
        action={vi.fn()}
        initial={{ ...BASE, outreach_schedule: [{ days_before: 5, channel: 'whatsapp', message_key: 'final' }] }}
        submitLabel="שמירה"
        callChannelStatus="live"
        channelOptions={CHANNELS}
        pricingModelStatus={PRICING}
        scheduleOptions={STEPS}
        scheduleSeed={SEED}
      />,
    );
    expect(submitted(container)).toEqual([{ days_before: 5, channel: 'whatsapp', message_key: 'final' }]);
    expect(screen.queryByText(/הלוח והערוצים הועתקו מהחבילה/)).toBeNull();
  });

  it('every step can still be removed or changed', () => {
    const { container } = createForm(SEED);
    fireEvent.click(screen.getAllByText('הסרה')[0]);
    expect(submitted(container)).toEqual([SEED.schedule[1]]);
  });
});

describe('PackageForm — a new package opens as a fixed-price package', () => {
  it('shows the quota and none of the pay-per-result formula, hold fields or hold warning', () => {
    const { container } = createForm();
    expect((screen.getByLabelText('חבילה במחיר קבוע עם מכסה') as HTMLInputElement).checked).toBe(true);
    expect(field(container, 'contact_quota')).not.toBeNull();
    for (const name of FORMULA_AND_HOLD) expect(field(container, name), name).toBeNull();
    expect(container.textContent).not.toMatch(/J5|hold|Buffer|מחיר לכל מושג/i);
  });

  it('the pay-per-result model is one click away, and brings its fields back', () => {
    const { container } = createForm();
    fireEvent.click(screen.getByLabelText('חיוב לפי תוצאה'));
    for (const name of FORMULA_AND_HOLD) expect(field(container, name), name).not.toBeNull();
    expect(field(container, 'contact_quota')).toBeNull();
  });

  it('an existing package without a quota still opens in the pay-per-result model', () => {
    form({ price_per_reached: 4 });
    expect((screen.getByLabelText('חיוב לפי תוצאה') as HTMLInputElement).checked).toBe(true);
  });
});
