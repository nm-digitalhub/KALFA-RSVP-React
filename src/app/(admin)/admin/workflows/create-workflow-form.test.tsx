// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The form imports a Server Action module; in a real build that is a client reference, here it would drag
// `server-only` into the test.
vi.mock('./actions', () => ({ createWorkflowAction: vi.fn() }));

import { createWorkflowAction } from './actions';
import { CreateWorkflowForm } from './create-workflow-form';

// The create form reads its action's result: a refusal is shown under the form (it used to replace the page with
// the admin error boundary), and nothing is shown until there is one.

afterEach(cleanup);

describe('CreateWorkflowForm', () => {
  it('shows nothing above the list until a submit answers', () => {
    render(<CreateWorkflowForm />);

    expect(screen.getByRole('button', { name: 'יצירה' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the server’s refusal under the form', async () => {
    vi.mocked(createWorkflowAction).mockResolvedValue({ serverError: 'שם התהליך לא יכול להיות ריק' });
    render(<CreateWorkflowForm />);

    fireEvent.change(screen.getByPlaceholderText('למשל: אישור אוטומטי מוואטסאפ'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'יצירה' }));

    expect((await screen.findByRole('alert')).textContent).toBe('שם התהליך לא יכול להיות ריק');
    const sent = vi.mocked(createWorkflowAction).mock.calls[0]![1] as FormData;
    expect(sent.get('name')).toBe('   ');
  });
});
