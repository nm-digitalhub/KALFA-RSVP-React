import { beforeEach, describe, expect, it, vi } from 'vitest';

// The contact-message actions: the gate lives in the data layer, so these tests cover the wrapper — the fields reach
// the shared schemas as posted (an empty reply gets its Hebrew message), a failed status update keeps its fixed message,
// and the reply's own Hebrew domain errors reach the admin.

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data/admin/contacts', () => ({
  sendInquiryReply: vi.fn(),
  updateContactStatus: vi.fn(),
}));

import { revalidatePath } from 'next/cache';

import { sendInquiryReply, updateContactStatus } from '@/lib/data/admin/contacts';

import { sendInquiryReplyAction, updateContactStatusAction } from './actions';

const ID = '3b0ab9ec-c77b-4c75-b6e4-2c431c1d8cd0';
const REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/auth/login;307;' });

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe('updateContactStatusAction', () => {
  it('updates the status and says so', async () => {
    const result = await updateContactStatusAction({}, fd({ id: ID, status: 'done' }));

    expect(updateContactStatus).toHaveBeenCalledWith(ID, 'done');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/contacts');
    expect(result).toEqual({ data: { notice: 'הסטטוס עודכן' } });
  });

  it('refuses a status outside the vocabulary, in Hebrew', async () => {
    const result = await updateContactStatusAction({}, fd({ id: ID, status: 'reopened' }));

    expect(result.validationErrors?.fieldErrors?.status).toEqual(['סטטוס לא תקין']);
    expect(updateContactStatus).not.toHaveBeenCalled();
  });

  it('keeps its fixed message when the update fails', async () => {
    vi.mocked(updateContactStatus).mockRejectedValue(new Error('db down'));

    expect(await updateContactStatusAction({}, fd({ id: ID, status: 'done' }))).toEqual({
      serverError: 'עדכון הסטטוס נכשל. נסו שוב.',
    });
  });

  it('re-throws the permission redirect', async () => {
    vi.mocked(updateContactStatus).mockRejectedValue(REDIRECT);

    await expect(updateContactStatusAction({}, fd({ id: ID, status: 'done' }))).rejects.toThrow('NEXT_REDIRECT');
  });
});

describe('sendInquiryReplyAction', () => {
  it('sends the trimmed reply and says so', async () => {
    const result = await sendInquiryReplyAction({}, fd({ id: ID, reply: ' תודה על הפנייה ' }));

    expect(sendInquiryReply).toHaveBeenCalledWith(ID, 'תודה על הפנייה');
    expect(result).toEqual({ data: { notice: 'המענה נשלח ללקוח' } });
  });

  it('an empty reply reaches the schema and gets its Hebrew message', async () => {
    const result = await sendInquiryReplyAction({}, fd({ id: ID, reply: '' }));

    expect(result.validationErrors?.fieldErrors?.reply).toEqual(['נא לכתוב את תוכן המענה']);
    expect(sendInquiryReply).not.toHaveBeenCalled();
  });

  it("shows the domain error's own Hebrew message", async () => {
    vi.mocked(sendInquiryReply).mockRejectedValue(new Error('אין כתובת דוא״ל בפנייה זו'));

    expect(await sendInquiryReplyAction({}, fd({ id: ID, reply: 'שלום' }))).toEqual({
      serverError: 'אין כתובת דוא״ל בפנייה זו',
    });
  });
});
