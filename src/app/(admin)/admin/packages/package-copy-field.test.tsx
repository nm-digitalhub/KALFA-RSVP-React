// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rewrite } = vi.hoisted(() => ({ rewrite: vi.fn() }));
vi.mock('./rewrite-action', () => ({ rewritePackageCopyAction: rewrite }));
vi.mock('react-dom', async (original) => ({
  ...await original<typeof import('react-dom')>(),
  useFormStatus: () => ({ pending: false }),
}));

import { PackageCopyField } from './package-copy-field';

beforeEach(() => { rewrite.mockReset(); });
afterEach(cleanup);

describe('package copy field', () => {
  it('applies only on confirmation, while preserving the submitted field name', async () => {
    rewrite.mockResolvedValue({ ok: true, text: 'Improved' });
    render(<form><PackageCopyField field="description" label="תיאור" initialValue="Original" rows={3} /></form>);
    fireEvent.click(screen.getByRole('button', { name: 'שפר ניסוח: תיאור' }));
    await screen.findByRole('button', { name: 'החל ניסוח' });
    const input = screen.getByLabelText('תיאור') as HTMLTextAreaElement;
    expect(input.value).toBe('Original');
    fireEvent.click(screen.getByRole('button', { name: 'החל ניסוח' }));
    expect(input.value).toBe('Improved');
    expect(new FormData(input.form!).get('description')).toBe('Improved');
  });

  it('discards a late proposal after an edit, including edit-and-revert', async () => {
    let resolve!: (value: unknown) => void;
    rewrite.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<PackageCopyField field="description" label="תיאור" initialValue="Original" rows={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'שפר ניסוח: תיאור' }));
    const input = screen.getByLabelText('תיאור');
    fireEvent.change(input, { target: { value: 'Edited' } });
    fireEvent.change(input, { target: { value: 'Original' } });
    await act(async () => { resolve({ ok: true, text: 'Stale' }); });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'החל ניסוח' })).toBeNull());
    expect((input as HTMLTextAreaElement).value).toBe('Original');
  });

  it('preserves the includes field and original lines on cancel', async () => {
    rewrite.mockResolvedValue({ ok: true, text: 'One improved\nTwo improved' });
    render(<form><PackageCopyField field="includes" label="כלול בחבילה" initialValue={'One\nTwo'} rows={5} /></form>);
    fireEvent.click(screen.getByRole('button', { name: 'שפר ניסוח: כלול בחבילה' }));
    fireEvent.click(await screen.findByRole('button', { name: 'ביטול' }));
    const input = screen.getByLabelText('כלול בחבילה') as HTMLTextAreaElement;
    expect(new FormData(input.form!).get('includes')).toBe('One\nTwo');
  });
});
