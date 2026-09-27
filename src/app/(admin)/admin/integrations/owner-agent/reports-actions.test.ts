import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { ownerMock, revalidateMock, enabledMock, templateMock, scheduleMock } = vi.hoisted(() => ({
  ownerMock: vi.fn(),
  revalidateMock: vi.fn(),
  enabledMock: vi.fn(),
  templateMock: vi.fn(),
  scheduleMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformOwner: ownerMock }));
vi.mock('@/lib/data/admin/owner-agent-reports', () => ({
  setOwnerAgentReportsEnabled: enabledMock,
  setOwnerAgentReportTemplate: templateMock,
  setOwnerAgentReportSchedule: scheduleMock,
}));

import { OWNER_AGENT_REPORT_ERRORS } from '@/lib/validation/owner-agent-reports';

import {
  setOwnerAgentReportScheduleAction,
  setOwnerAgentReportTemplateAction,
  setOwnerAgentReportsEnabledAction,
} from './reports-actions';

const ENTRY_ID = '9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a';

function form(fields: Array<[string, string]>): FormData {
  const fd = new FormData();
  for (const [k, v] of fields) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  ownerMock.mockResolvedValue({ id: 'owner' });
});

describe('owner gate', () => {
  it('every action checks the owner itself, and a refusal reaches no DAL', async () => {
    ownerMock.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(setOwnerAgentReportsEnabledAction(null, form([['owner_agent_reports_enabled', 'on']]))).rejects.toThrow('NEXT_REDIRECT');
    await expect(setOwnerAgentReportTemplateAction(null, form([['templateName', 'x_v1']]))).rejects.toThrow('NEXT_REDIRECT');
    await expect(
      setOwnerAgentReportScheduleAction(null, form([['entryId', ENTRY_ID], ['optIn', 'on'], ['slots', '08:00']])),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(enabledMock).not.toHaveBeenCalled();
    expect(templateMock).not.toHaveBeenCalled();
    expect(scheduleMock).not.toHaveBeenCalled();
  });
});

describe('setOwnerAgentReportsEnabledAction', () => {
  it('a ticked box turns reports on; an unticked one off', async () => {
    expect(await setOwnerAgentReportsEnabledAction(null, form([['owner_agent_reports_enabled', 'on']]))).toEqual({ notice: 'הדוחות הופעלו' });
    expect(enabledMock).toHaveBeenLastCalledWith(true);
    await setOwnerAgentReportsEnabledAction(null, form([]));
    expect(enabledMock).toHaveBeenLastCalledWith(false);
    expect(revalidateMock).toHaveBeenCalledWith('/admin/integrations/owner-agent');
  });

  it('only the DAL’s own messages reach the screen', async () => {
    enabledMock.mockRejectedValueOnce(new Error(OWNER_AGENT_REPORT_ERRORS.switchFailed));
    expect(await setOwnerAgentReportsEnabledAction(null, form([]))).toEqual({ error: OWNER_AGENT_REPORT_ERRORS.switchFailed });
    enabledMock.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "x" (+972501234567)'));
    expect(await setOwnerAgentReportsEnabledAction(null, form([]))).toEqual({ error: 'עדכון מתג הדוחות נכשל' });
  });
});

describe('setOwnerAgentReportTemplateAction', () => {
  it('a malformed name is a field error, with no DAL call', async () => {
    const state = await setOwnerAgentReportTemplateAction(null, form([['templateName', 'Bad Name'], ['templateLang', 'he']]));
    expect(state?.fieldErrors?.templateName).toBeDefined();
    expect(templateMock).not.toHaveBeenCalled();
  });

  it('passes the raw strings through (the DAL re-parses)', async () => {
    await setOwnerAgentReportTemplateAction(null, form([['templateName', 'kalfa_owner_daily_report_util_v1'], ['templateLang', 'he']]));
    expect(templateMock).toHaveBeenCalledWith({ templateName: 'kalfa_owner_daily_report_util_v1', templateLang: 'he' });
  });
});

describe('setOwnerAgentReportScheduleAction', () => {
  it('reads the opt-in box and every ticked hour', async () => {
    const state = await setOwnerAgentReportScheduleAction(
      null,
      form([['entryId', ENTRY_ID], ['optIn', 'on'], ['slots', '08:00'], ['slots', '00:00']]),
    );
    expect(state).toEqual({ notice: 'לוח הזמנים נשמר' });
    expect(scheduleMock).toHaveBeenCalledWith({
      entryId: ENTRY_ID,
      optIn: true,
      slots: [
        { time: '08:00', instructions: '' },
        { time: '00:00', instructions: '' },
      ],
    });
  });

  it('any whole-minute time is accepted; an emptied field is dropped', async () => {
    await setOwnerAgentReportScheduleAction(
      null,
      form([
        ['entryId', ENTRY_ID],
        ['optIn', 'on'],
        ['slots', '07:45'],
        ['instructions', 'רק הכנסות'],
        ['slots', ''],
        ['instructions', 'נזרק עם השעה הריקה'],
        ['slots', ' 21:10 '],
        ['instructions', ''],
      ]),
    );
    expect(scheduleMock).toHaveBeenCalledWith({
      entryId: ENTRY_ID,
      optIn: true,
      slots: [
        { time: '07:45', instructions: 'רק הכנסות' },
        { time: '21:10', instructions: '' },
      ],
    });
  });

  it('opt-in with no time, a 25th time, or a malformed time is refused before the DAL', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ['slots', `${String(i % 24).padStart(2, '0')}:${String(i).padStart(2, '0')}`]);
    for (const fields of [
      [['entryId', ENTRY_ID], ['optIn', 'on']],
      [['entryId', ENTRY_ID], ['optIn', 'on'], ...many],
      [['entryId', ENTRY_ID], ['slots', '8:15']],
      [['entryId', 'not-a-uuid'], ['slots', '08:00']],
    ] as Array<Array<[string, string]>>) {
      const state = await setOwnerAgentReportScheduleAction(null, form(fields));
      expect(state?.fieldErrors).toBeDefined();
    }
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('opting out needs no hour', async () => {
    expect(await setOwnerAgentReportScheduleAction(null, form([['entryId', ENTRY_ID]]))).toEqual({ notice: 'הדוחות לרשומה הזו כובו' });
    expect(scheduleMock).toHaveBeenCalledWith({ entryId: ENTRY_ID, optIn: false, slots: [] });
  });
});
