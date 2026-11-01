import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

vi.mock('server-only', () => ({}));

import { actionErrorMessage, actionFormError } from './action-result';
import { GENERIC_ACTION_ERROR, actionClient, returnUserError } from './safe-action';

// The error policy every Server Action shares (src/lib/safe-action.ts): every thrown failure is logged with its cause;
// a Hebrew message thrown by the data layer reaches the customer as it is, anything else is replaced; an expected
// failure is sent as given; and a failed schema comes back flattened with the schema's own Hebrew text.

afterEach(() => vi.restoreAllMocks());

const throwing = (message: string) => actionClient.action(async () => {
  throw new Error(message);
});

describe('actionClient — what reaches the customer', () => {
  it('passes a Hebrew message from the data layer through unchanged — and still logs it, with its cause', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const action = actionClient.action(async () => {
      throw new Error('שליחת אישור ההגעה נכשלה', { cause: { code: '57014', message: 'canceling statement due to statement timeout' } });
    });

    expect(await action()).toEqual({ serverError: 'שליחת אישור ההגעה נכשלה' });
    expect(log).toHaveBeenCalledWith(
      '[action] Error: שליחת אישור ההגעה נכשלה — [57014] canceling statement due to statement timeout',
    );
  });

  it('replaces a provider or internal message with the generic one, and logs it on the server', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await throwing('duplicate key value violates unique constraint "guests_pkey"')();

    expect(result).toEqual({ serverError: GENERIC_ACTION_ERROR });
    expect(log).toHaveBeenCalledWith('[action] Error: duplicate key value violates unique constraint "guests_pkey"');
  });

  it('sends an expected failure as given (returnUserError), without logging it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const action = actionClient.action(async () => returnUserError('יש לבחור חבילה'));

    expect(await action()).toEqual({ serverError: 'יש לבחור חבילה' });
    expect(log).not.toHaveBeenCalled();
  });

  it('returns a failed form schema flattened, with the schema’s Hebrew message', async () => {
    const action = actionClient
      .inputSchema(zfd.formData({ package_id: zfd.text(z.uuid({ error: 'יש לבחור חבילה' })) }))
      .stateAction(async () => ({ notice: 'נשמר' }));

    const result = await action({}, new FormData());

    expect(result).toEqual({ validationErrors: { formErrors: [], fieldErrors: { package_id: ['יש לבחור חבילה'] } } });
    expect(actionErrorMessage(result)).toBe('יש לבחור חבילה');
  });

  it('refuses a bound argument that fails its schema, with the generic message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const action = actionClient.bindArgsSchemas([z.uuid()]).action(async () => ({ notice: 'נשמר' }));

    expect(await action('not-an-id')).toEqual({ serverError: GENERIC_ACTION_ERROR });
  });
});

describe('actionErrorMessage', () => {
  it('reads the server error first, then the form-level, then the first field message', () => {
    expect(actionErrorMessage(null)).toBeUndefined();
    expect(actionErrorMessage({})).toBeUndefined();
    expect(actionErrorMessage({ serverError: 'א' })).toBe('א');
    expect(actionErrorMessage({ validationErrors: { formErrors: ['ב'], fieldErrors: { x: ['ג'] } } })).toBe('ב');
    expect(actionErrorMessage({ validationErrors: { formErrors: [], fieldErrors: { x: [], y: ['ג'] } } })).toBe('ג');
  });
});

describe('actionFormError — a form that shows its field messages under the fields', () => {
  it('reads the server error or a form-level message, never a field message', () => {
    expect(actionFormError(null)).toBeUndefined();
    expect(actionFormError({ serverError: 'א' })).toBe('א');
    expect(actionFormError({ validationErrors: { formErrors: ['ב'], fieldErrors: { x: ['ג'] } } })).toBe('ב');
    expect(actionFormError({ validationErrors: { formErrors: [], fieldErrors: { x: ['ג'] } } })).toBeUndefined();
  });
});
