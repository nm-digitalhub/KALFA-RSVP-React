import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data/admin/settings', () => ({ updateEmailTransportConfig: vi.fn() }));

import { updateEmailTransportConfig } from '@/lib/data/admin/settings';
import { actionFormError } from '@/lib/action-result';
import { updateEmailTransportAction } from './actions';

// The mail transport form: the SMTP half may be left blank while Resend is live, a checkbox is on only as 'on', a
// refused field is answered beside it, and a failure is one fixed message that carries no provider text.

const EMPTY = { smtp_host: '', smtp_port: '', smtp_user: '', smtp_password: '', smtp_from: '' };

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('updateEmailTransportAction', () => {
  it('saves a form with every SMTP field blank and both boxes unchecked', async () => {
    expect(await updateEmailTransportAction({}, form(EMPTY))).toEqual({ data: { notice: 'הגדרות הדואר נשמרו' } });
    expect(updateEmailTransportConfig).toHaveBeenCalledWith({ email_enabled: false, smtp_secure: false, ...EMPTY });
  });

  it('a checked box is "on", and text is trimmed', async () => {
    await updateEmailTransportAction(
      {},
      form({ ...EMPTY, email_enabled: 'on', smtp_secure: 'on', smtp_host: ' smtp.example.com ', smtp_port: '465' }),
    );

    expect(updateEmailTransportConfig).toHaveBeenCalledWith(
      expect.objectContaining({ email_enabled: true, smtp_secure: true, smtp_host: 'smtp.example.com', smtp_port: '465' }),
    );
  });

  it('a non-numeric port is answered beside the field with the shared schema’s Hebrew', async () => {
    const result = await updateEmailTransportAction({}, form({ ...EMPTY, smtp_port: '58a' }));

    expect(result).toEqual({ validationErrors: { formErrors: [], fieldErrors: { smtp_port: ['פורט חייב להכיל ספרות בלבד'] } } });
    expect(actionFormError(result)).toBeUndefined();
    expect(updateEmailTransportConfig).not.toHaveBeenCalled();
  });

  it('a failure is the fixed message, and the provider’s text is neither returned nor logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(updateEmailTransportConfig).mockRejectedValue(new Error('535 auth failed for user x'));

    const result = await updateEmailTransportAction({}, form(EMPTY));

    expect(result).toEqual({ serverError: 'עדכון הגדרות הדואר נכשל. נסו שוב.' });
    expect(log).not.toHaveBeenCalled();
  });
});
