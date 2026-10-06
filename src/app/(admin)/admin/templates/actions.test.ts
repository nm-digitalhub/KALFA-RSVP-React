import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('updateTemplateAction — Next.js control-flow signals (requireAdmin)', () => {
  it('propagates a NEXT_REDIRECT from updateMessageTemplate instead of returning { error }', async () => {
    vi.mocked(updateMessageTemplate).mockRejectedValue(NEXT_REDIRECT);

    await expect(updateTemplateAction(null, fd(FIELDS))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(updateMessageTemplate).mockRejectedValue(new Error('db down'));

    const result = await updateTemplateAction(null, fd(FIELDS));

    expect(result).toEqual({ error: 'עדכון התבנית נכשל. נסו שוב.' });
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
    const result = await acknowledgeTemplateCategoryAction(null, fd(OK));
    expect(acknowledgeTemplateCategory).toHaveBeenCalledWith(FIELDS.id, 'MARKETING');
    expect(result?.notice).toBeTruthy();
  });

  it('says plainly that acknowledging does not change the billing or the limits', async () => {
    // The badge clearing must not read as the problem going away: Meta classifies
    // by message body and the template stays MARKETING.
    vi.mocked(acknowledgeTemplateCategory).mockResolvedValueOnce({
      ok: true,
      from: 'UTILITY',
      to: 'MARKETING',
    });
    const result = await acknowledgeTemplateCategoryAction(null, fd(OK));
    expect(result?.notice).toContain('החיוב והמגבלות');
  });

  it('a refusal from the DAL is shown as its own reason, not a generic failure', async () => {
    vi.mocked(acknowledgeTemplateCategory).mockResolvedValueOnce({
      ok: false,
      reason: 'הקטגוריה השתנתה מאז שהעמוד נטען. רעננו ובדקו שוב לפני האישור.',
    });
    const result = await acknowledgeTemplateCategoryAction(null, fd(OK));
    expect(result?.error).toContain('רעננו');
  });

  it('rejects a missing observed category rather than accepting whatever is current', async () => {
    const result = await acknowledgeTemplateCategoryAction(null, fd({ id: FIELDS.id }));
    expect(result?.error).toBe('בקשה לא תקינה');
    expect(acknowledgeTemplateCategory).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid id', async () => {
    const result = await acknowledgeTemplateCategoryAction(
      null,
      fd({ id: 'nope', observed_category: 'MARKETING' }),
    );
    expect(result?.error).toBe('בקשה לא תקינה');
    expect(acknowledgeTemplateCategory).not.toHaveBeenCalled();
  });

  it('propagates a framework redirect instead of swallowing it', async () => {
    vi.mocked(acknowledgeTemplateCategory).mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(acknowledgeTemplateCategoryAction(null, fd(OK))).rejects.toBe(
      NEXT_REDIRECT,
    );
  });
});

describe('setTemplateRouteAction', () => {
  it('rejects malformed input without calling the data layer', async () => {
    expect(await setTemplateRouteAction({ messageKey: 'invite', eventType: 'party', withMedia: false, templateId: '1' }))
      .toEqual({ ok: false, problems: ['בקשה לא תקינה'] });
    expect(await setTemplateRouteAction({ messageKey: 'invite', eventType: null, withMedia: false, templateId: 'abc' }))
      .toEqual({ ok: false, problems: ['בקשה לא תקינה'] });
    expect(setTemplateRoute).not.toHaveBeenCalled();
  });

  it('passes validated input through and returns the data layer result', async () => {
    vi.mocked(setTemplateRoute).mockResolvedValueOnce({ ok: true, warning: 'w' });
    const input = { messageKey: 'invite', eventType: 'brit', withMedia: true, templateId: '123' };
    expect(await setTemplateRouteAction(input)).toEqual({ ok: true, warning: 'w' });
    expect(setTemplateRoute).toHaveBeenCalledWith(input);
  });

  it('hides internal failures behind a generic message', async () => {
    vi.mocked(setTemplateRoute).mockRejectedValueOnce(new Error('db exploded'));
    expect(await setTemplateRouteAction({ messageKey: 'invite', eventType: null, withMedia: false, templateId: '1' }))
      .toEqual({ ok: false, problems: ['השמירה נכשלה. נסו שוב.'] });
  });
});

describe('saveTemplateParametersAction', () => {
  it('rejects an unknown component type', async () => {
    expect(
      await saveTemplateParametersAction({
        templateId: '1',
        values: [{ type: 'footer', sub_type: null, index: null, position: 1, source_path: 'guest.first_name' }],
      }),
    ).toEqual({ ok: false, problems: ['בקשה לא תקינה'] });
    expect(saveTemplateParameters).not.toHaveBeenCalled();
  });
});
