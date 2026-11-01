import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/message-templates', () => ({
  updateMessageTemplate: vi.fn(),
  acknowledgeTemplateCategory: vi.fn(),
}));

vi.mock('@/lib/data/admin/whatsapp-templates', () => ({
  setTemplateRoute: vi.fn(),
  removeTemplateRoute: vi.fn(),
  saveTemplateParameters: vi.fn(),
  requestTemplateSync: vi.fn(),
}));

import { actionErrorMessage } from '@/lib/action-result';
import { saveTemplateParameters, setTemplateRoute } from '@/lib/data/admin/whatsapp-templates';
import {
  acknowledgeTemplateCategory,
  updateMessageTemplate,
} from '@/lib/data/message-templates';
import {
  acknowledgeTemplateCategoryAction,
  saveTemplateParametersAction,
  setTemplateRouteAction,
  updateTemplateAction,
} from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const FIELDS = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'תבנית',
  language: 'he',
  body: 'שלום',
};

beforeEach(() => vi.clearAllMocks());

describe('updateTemplateAction — Next.js control-flow signals (requirePlatformPermission)', () => {
  it('propagates a NEXT_REDIRECT from updateMessageTemplate instead of returning { error }', async () => {
    vi.mocked(updateMessageTemplate).mockRejectedValue(NEXT_REDIRECT);

    await expect(updateTemplateAction({}, fd(FIELDS))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(updateMessageTemplate).mockRejectedValue(new Error('db down'));

    const result = await updateTemplateAction({}, fd(FIELDS));

    expect(result).toEqual({ serverError: 'עדכון התבנית נכשל. נסו שוב.' });
  });
});

describe('acknowledgeTemplateCategoryAction', () => {
  const OK = { id: FIELDS.id, observed_category: 'MARKETING' };

  it('passes the category that was ON SCREEN, not just the id', async () => {
    vi.mocked(acknowledgeTemplateCategory).mockResolvedValueOnce({
      ok: true,
      from: 'UTILITY',
      to: 'MARKETING',
    });
    const result = await acknowledgeTemplateCategoryAction({}, fd(OK));
    expect(acknowledgeTemplateCategory).toHaveBeenCalledWith(FIELDS.id, 'MARKETING');
    expect(result.data?.notice).toBeTruthy();
  });

  it('says plainly that acknowledging does not change the billing or the limits', async () => {
    // The badge clearing must not read as the problem going away: Meta classifies
    // by message body and the template stays MARKETING.
    vi.mocked(acknowledgeTemplateCategory).mockResolvedValueOnce({
      ok: true,
      from: 'UTILITY',
      to: 'MARKETING',
    });
    const result = await acknowledgeTemplateCategoryAction({}, fd(OK));
    expect(result.data?.notice).toContain('החיוב והמגבלות');
  });

  it('a refusal from the DAL is shown as its own reason, not a generic failure', async () => {
    vi.mocked(acknowledgeTemplateCategory).mockResolvedValueOnce({
      ok: false,
      reason: 'הקטגוריה השתנתה מאז שהעמוד נטען. רעננו ובדקו שוב לפני האישור.',
    });
    const result = await acknowledgeTemplateCategoryAction({}, fd(OK));
    expect(result.serverError).toContain('רעננו');
  });

  it('rejects a missing observed category rather than accepting whatever is current', async () => {
    const result = await acknowledgeTemplateCategoryAction({}, fd({ id: FIELDS.id }));
    expect(actionErrorMessage(result)).toBe('בקשה לא תקינה');
    expect(acknowledgeTemplateCategory).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid id', async () => {
    const result = await acknowledgeTemplateCategoryAction(
      {},
      fd({ id: 'nope', observed_category: 'MARKETING' }),
    );
    expect(actionErrorMessage(result)).toBe('בקשה לא תקינה');
    expect(acknowledgeTemplateCategory).not.toHaveBeenCalled();
  });

  it('propagates a framework redirect instead of swallowing it', async () => {
    vi.mocked(acknowledgeTemplateCategory).mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(acknowledgeTemplateCategoryAction({}, fd(OK))).rejects.toBe(
      NEXT_REDIRECT,
    );
  });
});

describe('setTemplateRouteAction', () => {
  it('rejects malformed input without calling the data layer', async () => {
    // 'party' is not an event type: the point of this case (as never only to get it past the typed input).
    expect(await setTemplateRouteAction({ messageKey: 'invite', eventType: 'party' as never, withMedia: false, templateId: '1' }))
      .toEqual({ validationErrors: { formErrors: ['בקשה לא תקינה'], fieldErrors: {} } });
    expect(await setTemplateRouteAction({ messageKey: 'invite', eventType: null, withMedia: false, templateId: 'abc' }))
      .toEqual({ validationErrors: { formErrors: ['בקשה לא תקינה'], fieldErrors: {} } });
    expect(setTemplateRoute).not.toHaveBeenCalled();
  });

  it('passes validated input through and returns the data layer result', async () => {
    vi.mocked(setTemplateRoute).mockResolvedValueOnce({ ok: true, warning: 'w' });
    const input = { messageKey: 'invite', eventType: 'brit', withMedia: true, templateId: '123' } as const;
    expect(await setTemplateRouteAction(input)).toEqual({ data: { ok: true, warning: 'w' } });
    expect(setTemplateRoute).toHaveBeenCalledWith(input);
  });

  it('hides internal failures behind a generic message', async () => {
    vi.mocked(setTemplateRoute).mockRejectedValueOnce(new Error('db exploded'));
    expect(await setTemplateRouteAction({ messageKey: 'invite', eventType: null, withMedia: false, templateId: '1' }))
      .toEqual({ serverError: 'השמירה נכשלה. נסו שוב.' });
  });
});

describe('saveTemplateParametersAction', () => {
  it('rejects an unknown component type', async () => {
    expect(
      await saveTemplateParametersAction({
        templateId: '1',
        // 'footer' is not a component type: the point of this case (as never only to get it past the typed input).
        values: [{ type: 'footer' as never, sub_type: null, index: null, position: 1, source_path: 'guest.first_name' }],
      }),
    ).toEqual({ validationErrors: { formErrors: ['בקשה לא תקינה'], fieldErrors: {} } });
    expect(saveTemplateParameters).not.toHaveBeenCalled();
  });
});
