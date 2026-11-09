// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CalendarEventDetailDTO } from '@/lib/data/exchange-connections';

vi.mock('./actions', () => ({
  fetchCalendarEventAction: vi.fn(),
  updateCalendarEventAction: vi.fn(async () => ({ data: {} })),
  deleteCalendarEventAction: vi.fn(),
}));

import { fetchCalendarEventAction, updateCalendarEventAction } from './actions';
import { EventEditDialog } from './event-edit-dialog';

// 17:30–18:30 in Israel (UTC+2 in November).
const EVENT: CalendarEventDetailDTO = {
  id: 'evt-1',
  title: 'פגישת בדיקה',
  startIso: '2026-11-09T15:30:00.000Z',
  endIso: '2026-11-09T16:30:00.000Z',
  allDay: false,
  readOnly: false,
  location: '',
  body: '',
  reminderMinutes: 15,
  showAs: 'busy',
  sensitivity: 'normal',
  category: '',
  attendees: [],
  recurrenceText: null,
  callback: null,
};

let pinnedTz: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchCalendarEventAction).mockResolvedValue({ data: { event: EVENT } } as Awaited<
    ReturnType<typeof fetchCalendarEventAction>
  >);
  // The admin calendar grid shows Israel time on any machine (timeZone="Asia/Jerusalem").
  // Run the dialog on a machine set to New York, where the machine's own clock reads
  // 10:30 for the same instant.
  pinnedTz = process.env.TZ;
  process.env.TZ = 'America/New_York';
});
afterEach(() => {
  cleanup();
  process.env.TZ = pinnedTz;
});

describe('EventEditDialog — times are Israel time on any machine', () => {
  it('shows the Israel wall clock in the fields and saves the same instant back', async () => {
    // The switch took effect: this machine's own clock reads 10:30, not 17:30.
    expect(new Date(EVENT.startIso).getHours()).toBe(10);

    const user = userEvent.setup();
    render(
      <EventEditDialog
        connectionId="conn-1"
        appointmentId={EVENT.id}
        categories={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /עריכה/ }));

    expect((screen.getByLabelText('התחלה') as HTMLInputElement).value).toBe('2026-11-09T17:30');
    expect((screen.getByLabelText('סיום') as HTMLInputElement).value).toBe('2026-11-09T18:30');

    await user.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(updateCalendarEventAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateCalendarEventAction).mock.calls[0][0]).toMatchObject({
      startIso: EVENT.startIso,
      endIso: EVENT.endIso,
    });
  });
});
