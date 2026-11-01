import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// redirect() throws Next's control-flow signal; the digest is what next-safe-action recognises and re-throws.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    redirect: vi.fn((target: string) => {
      throw Object.assign(new Error(`REDIRECT:${target}`), { digest: `NEXT_REDIRECT;replace;${target};307;` });
    }),
  };
});
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/admin/workflows', () => ({
  listContactsForManualRun: vi.fn(),
  listEventsForManualRun: vi.fn(),
  cancelRun: vi.fn(),
  createWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  saveWorkflowDefinition: vi.fn(),
  setWorkflowActive: vi.fn(),
  testWorkflow: vi.fn(),
}));
vi.mock('@/lib/data/admin/voximplant-channel', () => ({ listVoximplantRules: vi.fn() }));
vi.mock('@/lib/data/admin/elevenlabs-agents', () => ({ listElevenLabsAgents: vi.fn() }));
vi.mock('@/lib/data/admin/sumit-trigger-subscriptions', () => ({
  listSumitFoldersForEditor: vi.fn(),
  listSumitViewsForEditor: vi.fn(),
  registerSumitTrigger: vi.fn(),
}));
vi.mock('@/lib/workflow/manual-run', () => ({ startManualRun: vi.fn() }));
vi.mock('@/lib/workflow/engine/dry-run', () => ({ DRY_RUN_GUEST_CASES: ['one', 'none', 'several'] }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  cancelRun,
  createWorkflow,
  deleteWorkflow,
  listContactsForManualRun,
  listEventsForManualRun,
  saveWorkflowDefinition,
  setWorkflowActive,
  testWorkflow,
} from '@/lib/data/admin/workflows';
import { listVoximplantRules } from '@/lib/data/admin/voximplant-channel';
import { listElevenLabsAgents } from '@/lib/data/admin/elevenlabs-agents';
import { listSumitViewsForEditor, registerSumitTrigger } from '@/lib/data/admin/sumit-trigger-subscriptions';
import { startManualRun } from '@/lib/workflow/manual-run';
import { actionErrorMessage } from '@/lib/action-result';
import { GENERIC_ACTION_ERROR } from '@/lib/safe-action';
import {
  cancelRunAction,
  createWorkflowAction,
  deleteWorkflowAction,
  generateWebhookTokenAction,
  listManualRunContactsAction,
  listManualRunEventsAction,
  loadSumitViewsAction,
  loadVoiceDialListsAction,
  registerSumitTriggerAction,
  saveWorkflowAction,
  setWorkflowActiveAction,
  startManualRunAction,
  testWorkflowAction,
} from './actions';

// The workflow actions are thin: they validate, call the gated data layer, and hand its answer back as `data`. A
// failure is the result's serverError / validationErrors; each caller turns it into what it showed before.

const WF = '11111111-1111-4111-8111-111111111111';
const EV = '22222222-2222-4222-8222-222222222222';
const CT = '33333333-3333-4333-8333-333333333333';

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('createWorkflowAction', () => {
  it('creates and navigates to the new workflow’s editor', async () => {
    vi.mocked(createWorkflow).mockResolvedValue(WF);

    await expect(createWorkflowAction({}, form({ name: 'אישור אוטומטי' }))).rejects.toThrow(`REDIRECT:/admin/workflows/${WF}`);
    expect(createWorkflow).toHaveBeenCalledWith('אישור אוטומטי');
  });

  it('an empty name reaches the data layer, whose Hebrew refusal the form shows', async () => {
    vi.mocked(createWorkflow).mockRejectedValue(new Error('שם התהליך לא יכול להיות ריק'));

    const result = await createWorkflowAction({}, form({ name: '' }));

    expect(createWorkflow).toHaveBeenCalledWith('');
    expect(actionErrorMessage(result)).toBe('שם התהליך לא יכול להיות ריק');
  });
});

describe('saveWorkflowAction', () => {
  it('saves (id, definition) and resolves with no error, which the editor reads as saved', async () => {
    const definition = { nodes: [], edges: [] };

    expect(await saveWorkflowAction(WF, definition)).toEqual({});
    expect(saveWorkflowDefinition).toHaveBeenCalledWith(WF, definition);
  });

  it('a malformed id or a data-layer failure is an error result (the editor throws it)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await saveWorkflowAction('not-an-id', {})).toEqual({ serverError: GENERIC_ACTION_ERROR });
    expect(saveWorkflowDefinition).not.toHaveBeenCalled();

    vi.mocked(saveWorkflowDefinition).mockRejectedValue(new Error('התהליך לא נמצא'));
    expect(await saveWorkflowAction(WF, {})).toEqual({ serverError: 'התהליך לא נמצא' });
  });
});

describe('arm, delete and cancel', () => {
  it('arms only on the literal "true"', async () => {
    vi.mocked(setWorkflowActive).mockResolvedValue({ ok: true } as never);

    expect(await setWorkflowActiveAction(form({ id: WF, isActive: 'true' }))).toEqual({ data: { ok: true } });
    expect(setWorkflowActive).toHaveBeenLastCalledWith(WF, true);
    await setWorkflowActiveAction(form({ id: WF, isActive: 'false' }));
    expect(setWorkflowActive).toHaveBeenLastCalledWith(WF, false);
    await setWorkflowActiveAction(form({ id: WF }));
    expect(setWorkflowActive).toHaveBeenLastCalledWith(WF, false);

    const malformed = await setWorkflowActiveAction(form({ id: 'x', isActive: 'true' }));
    expect(malformed.validationErrors?.fieldErrors.id).toHaveLength(1);
    expect(setWorkflowActive).toHaveBeenCalledTimes(3);
  });

  it('a refusal is data, passed through as the data layer wrote it', async () => {
    vi.mocked(deleteWorkflow).mockResolvedValue({ ok: false, errors: ['אי אפשר למחוק תהליך פעיל.'] } as never);
    expect(await deleteWorkflowAction(form({ id: WF }))).toEqual({ data: { ok: false, errors: ['אי אפשר למחוק תהליך פעיל.'] } });

    vi.mocked(cancelRun).mockResolvedValue({ ok: true } as never);
    expect(await cancelRunAction(form({ workflowId: WF, runId: EV }))).toEqual({ data: { ok: true } });
    expect(cancelRun).toHaveBeenCalledWith(EV);
  });
});

describe('startManualRunAction', () => {
  it('validates, then checks BOTH permissions in order, then starts the run', async () => {
    vi.mocked(startManualRun).mockResolvedValue({ ok: true, runId: 'r-1' } as never);

    const result = await startManualRunAction(WF, { eventId: EV, contactId: CT, messageText: '', buttonPayload: '' });

    expect(result).toEqual({ data: { ok: true, runId: 'r-1' } });
    expect(vi.mocked(requirePlatformPermission).mock.calls).toEqual([['view_customer_data'], ['manage_voice']]);
    expect(startManualRun).toHaveBeenCalledWith({ workflowId: WF, eventId: EV, contactId: CT, messageText: '', buttonPayload: '' });
  });

  it('a malformed target is refused before any gate or run', async () => {
    const result = await startManualRunAction(WF, { eventId: 'x', contactId: CT });

    expect(result.validationErrors?.fieldErrors.eventId).toHaveLength(1);
    expect(requirePlatformPermission).not.toHaveBeenCalled();
    expect(startManualRun).not.toHaveBeenCalled();
  });
});

describe('the loaders and the test run', () => {
  it('return the data layer’s answer as data', async () => {
    vi.mocked(listEventsForManualRun).mockResolvedValue([{ id: EV, name: 'חתונה' }] as never);
    expect(await listManualRunEventsAction()).toEqual({ data: [{ id: EV, name: 'חתונה' }] });

    vi.mocked(listContactsForManualRun).mockResolvedValue([] as never);
    expect(await listManualRunContactsAction(EV)).toEqual({ data: [] });
    expect((await listManualRunContactsAction('x')).validationErrors?.formErrors).toHaveLength(1);

    vi.mocked(testWorkflow).mockResolvedValue({ outcome: 'completed', steps: [] } as never);
    expect(await testWorkflowAction(WF, { messageText: 'כן', buttonPayload: '', guestCase: 'one' })).toEqual({
      data: { outcome: 'completed', steps: [] },
    });
    expect(testWorkflow).toHaveBeenCalledWith(WF, { messageText: 'כן', buttonPayload: '', guestCase: 'one' });
  });

  it('dial lists: each vendor answers for itself', async () => {
    vi.mocked(listVoximplantRules).mockResolvedValue({ ok: false, message: 'אין חיבור ל-Voximplant' } as never);
    vi.mocked(listElevenLabsAgents).mockResolvedValue({ ok: true, agents: [{ agentId: 'a-1', name: 'סוכן' }] } as never);

    expect(await loadVoiceDialListsAction()).toEqual({
      data: {
        rules: { ok: false, message: 'אין חיבור ל-Voximplant' },
        agents: { ok: true, items: [{ value: 'a-1', label: 'סוכן' }] },
      },
    });
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_voice');
  });

  it('SUMIT: views by a numeric folder id; registering passes the parsed input', async () => {
    vi.mocked(listSumitViewsForEditor).mockResolvedValue({ ok: true, items: [] } as never);
    expect(await loadSumitViewsAction('123')).toEqual({ data: { ok: true, items: [] } });
    expect((await loadSumitViewsAction('12a')).validationErrors).toBeDefined();

    vi.mocked(registerSumitTrigger).mockResolvedValue({ ok: true, message: 'נרשם ב-SUMIT' } as never);
    const url = 'https://kalfa.me/api/workflows/hook/t';
    expect(await registerSumitTriggerAction({ workflowId: WF, nodeId: 'n-1', url })).toEqual({
      data: { ok: true, message: 'נרשם ב-SUMIT' },
    });
    expect(registerSumitTrigger).toHaveBeenCalledWith(WF, 'n-1', url);
  });

  it('a webhook token is 32 random bytes in hex, behind manage_settings', async () => {
    const result = await generateWebhookTokenAction();

    expect(result.data).toMatch(/^[0-9a-f]{64}$/);
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });
});
