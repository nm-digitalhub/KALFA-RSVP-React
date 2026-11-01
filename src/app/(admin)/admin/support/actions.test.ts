import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/admin/support', () => ({
  findEventsForSupport: vi.fn(),
  getEventForSupportView: vi.fn(),
  listGuestsForSupportView: vi.fn(),
}));

import { actionErrorMessage } from '@/lib/action-result';
import {
  findEventsForSupport,
  getEventForSupportView,
  listGuestsForSupportView,
  type SupportEventView,
} from '@/lib/data/admin/support';
import { GENERIC_ACTION_ERROR } from '@/lib/safe-action';
import { findSupportEventsAction, viewSupportEventAction } from './actions';

// The read-only support actions: the shared schemas answer bad input in Hebrew before the data layer is touched, the
// data layer's own Hebrew message reaches the screen, and anything else becomes the generic one.

const EVENT_ID = '7a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d';
const REASON = 'פנייה בנושא הזמנה #1234';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('findSupportEventsAction', () => {
  it('refuses a short reason with the schema’s message, before the data layer', async () => {
    const result = await findSupportEventsAction({ event_id: EVENT_ID, owner_phone: '', owner_email: '', reason: 'קצר' });

    expect(actionErrorMessage(result)).toBe('יש לציין סיבה לחיפוש (לפחות 10 תווים)');
    expect(findEventsForSupport).not.toHaveBeenCalled();
  });

  it('refuses a search with no event id, phone or e-mail', async () => {
    const result = await findSupportEventsAction({ event_id: '', owner_phone: '', owner_email: '', reason: REASON });

    expect(actionErrorMessage(result)).toBe('יש להזין מזהה אירוע או טלפון/אימייל של בעל האירוע');
    expect(findEventsForSupport).not.toHaveBeenCalled();
  });

  it('refuses a malformed event id', async () => {
    const result = await findSupportEventsAction({ event_id: 'nope', owner_phone: '', owner_email: '', reason: REASON });

    expect(actionErrorMessage(result)).toBe('מזהה אירוע לא תקין');
    expect(findEventsForSupport).not.toHaveBeenCalled();
  });

  it('passes an empty identifier as absent and returns the candidates', async () => {
    vi.mocked(findEventsForSupport).mockResolvedValue([]);

    const result = await findSupportEventsAction({ event_id: '', owner_phone: '0501234567', owner_email: '', reason: REASON });

    expect(findEventsForSupport).toHaveBeenCalledWith(
      { eventId: undefined, ownerPhone: '0501234567', ownerEmail: undefined },
      REASON,
    );
    expect(result).toEqual({ data: [] });
  });

  it('shows the data layer’s Hebrew message as it is', async () => {
    vi.mocked(findEventsForSupport).mockRejectedValue(new Error('אין הרשאה לצפייה בנתוני לקוח'));

    const result = await findSupportEventsAction({ event_id: EVENT_ID, owner_phone: '', owner_email: '', reason: REASON });

    expect(result).toEqual({ serverError: 'אין הרשאה לצפייה בנתוני לקוח' });
  });

  it('replaces a provider message with the generic one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(findEventsForSupport).mockRejectedValue(new Error('permission denied for table events'));

    const result = await findSupportEventsAction({ event_id: EVENT_ID, owner_phone: '', owner_email: '', reason: REASON });

    expect(result).toEqual({ serverError: GENERIC_ACTION_ERROR });
  });
});

describe('viewSupportEventAction', () => {
  it('refuses a malformed event id and a short reason before the data layer', async () => {
    expect(actionErrorMessage(await viewSupportEventAction({ event_id: 'nope', reason: REASON }))).toBe('מזהה אירוע לא תקין');
    expect(actionErrorMessage(await viewSupportEventAction({ event_id: EVENT_ID, reason: 'קצר' }))).toBe(
      'יש לציין סיבה לצפייה (לפחות 10 תווים)',
    );
    expect(getEventForSupportView).not.toHaveBeenCalled();
    expect(listGuestsForSupportView).not.toHaveBeenCalled();
  });

  it('returns the event and its guests, each read with the reason', async () => {
    const event: SupportEventView = {
      id: EVENT_ID,
      name: 'חתונה',
      eventType: 'wedding',
      eventTypeLabel: 'חתונה',
      eventDate: null,
      venueName: null,
      venueAddress: null,
      celebrantsText: null,
      status: 'active',
      statusLabel: 'פעיל',
      owner: { fullName: null, phone: null, email: null },
    };
    vi.mocked(getEventForSupportView).mockResolvedValue(event);
    vi.mocked(listGuestsForSupportView).mockResolvedValue([]);

    const result = await viewSupportEventAction({ event_id: EVENT_ID, reason: REASON });

    expect(getEventForSupportView).toHaveBeenCalledWith(EVENT_ID, REASON);
    expect(listGuestsForSupportView).toHaveBeenCalledWith(EVENT_ID, REASON);
    expect(result).toEqual({ data: { event, guests: [] } });
  });
});
