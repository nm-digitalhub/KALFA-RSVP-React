import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const commands = vi.hoisted(() => ({
  cmdApprove: vi.fn(),
  cmdDeny: vi.fn(),
  cmdList: vi.fn(),
  cmdRevoke: vi.fn(),
  cmdShow: vi.fn(),
  cmdStatus: vi.fn(),
}));
vi.mock('./commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./commands')>()),
  ...commands,
}));

import { EXIT, type CliContext } from './commands';
import { buildProgram } from './program';

const OWNER = '22222222-2222-4222-8222-222222222222';

function setup() {
  for (const fn of Object.values(commands)) fn.mockReset().mockResolvedValue(EXIT.ok);
  const ctx = { marker: 'ctx' } as unknown as CliContext;
  const makeContext = vi.fn(() => ctx);
  const watch = vi.fn().mockResolvedValue(EXIT.ok);
  const setExitCode = vi.fn();
  const program = buildProgram({
    makeContext,
    watch,
    setExitCode,
    configure: (root) => root.exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} }),
  });
  const parse = (...args: string[]) => program.parseAsync(args, { from: 'user' });
  return { ctx, makeContext, watch, setExitCode, parse };
}

describe('buildProgram', () => {
  it('passes approve its arguments and defaults without asking commander to guess a duration', async () => {
    const { ctx, parse } = setup();
    await parse('approve', 'abcd1234');
    expect(commands.cmdApprove).toHaveBeenCalledWith(ctx, { id: 'abcd1234', note: '', yes: false });
  });

  it('parses --minutes, --note, --as and --yes', async () => {
    const { ctx, parse } = setup();
    await parse('approve', 'abcd', '--minutes', '90', '--note', '  needed today  ', '--as', OWNER.toUpperCase(), '--yes');
    expect(commands.cmdApprove).toHaveBeenCalledWith(ctx, { id: 'abcd', minutes: 90, note: 'needed today', as: OWNER, yes: true });
  });

  it.each(['4', '241', '60.5', 'abc', '-5', ''])('refuses --minutes %j before anything runs', async (value) => {
    const { makeContext, parse } = setup();
    await expect(parse('approve', 'abcd', '--minutes', value)).rejects.toMatchObject({ exitCode: 1 });
    expect(makeContext).not.toHaveBeenCalled();
    expect(commands.cmdApprove).not.toHaveBeenCalled();
  });

  it('refuses a malformed --as and an over-long note', async () => {
    const { makeContext, parse } = setup();
    await expect(parse('deny', 'abcd', '--as', 'not-a-uuid')).rejects.toMatchObject({ exitCode: 1 });
    await expect(parse('deny', 'abcd', '--note', 'x'.repeat(501))).rejects.toMatchObject({ exitCode: 1 });
    expect(makeContext).not.toHaveBeenCalled();
  });

  it('requires an id for approve, deny and show', async () => {
    const { parse } = setup();
    for (const name of ['approve', 'deny', 'show']) {
      await expect(parse(name)).rejects.toMatchObject({ exitCode: 1 });
    }
  });

  it('lists with the pending status by default and validates --status', async () => {
    const { ctx, parse } = setup();
    await parse('list');
    expect(commands.cmdList).toHaveBeenCalledWith(ctx, { status: 'pending', json: false });
    await parse('list', '--status', 'all', '--json');
    expect(commands.cmdList).toHaveBeenLastCalledWith(ctx, { status: 'all', json: true });
    await expect(parse('list', '--status', 'bogus')).rejects.toMatchObject({ exitCode: 1 });
  });

  it('revokes the active grant only: there is no grant id to type', async () => {
    const { ctx, parse } = setup();
    await parse('revoke', '--reason', 'finished', '--yes');
    expect(commands.cmdRevoke).toHaveBeenCalledWith(ctx, { reason: 'finished', yes: true });
    await expect(parse('revoke', 'some-grant-id')).rejects.toMatchObject({ exitCode: 1 });
  });

  it('runs watch with the interval, defaulting to 5 seconds and bounded to 2..60', async () => {
    const { ctx, watch, parse } = setup();
    await parse('watch');
    expect(watch).toHaveBeenCalledWith(ctx, 5);
    await parse('watch', '--interval', '10');
    expect(watch).toHaveBeenLastCalledWith(ctx, 10);
    for (const bad of ['1', '61', '2.5', 'x']) {
      await expect(parse('watch', '--interval', bad)).rejects.toMatchObject({ exitCode: 1 });
    }
  });

  it('reports the exit code of the command that ran', async () => {
    const { setExitCode, parse } = setup();
    commands.cmdShow.mockResolvedValueOnce(EXIT.noop);
    await parse('show', 'abcd');
    expect(setExitCode).toHaveBeenCalledWith(EXIT.noop);
  });

  it('builds the context lazily: help never needs the environment', async () => {
    const { makeContext, parse } = setup();
    await expect(parse('--help')).rejects.toMatchObject({ exitCode: 0 });
    expect(makeContext).not.toHaveBeenCalled();
  });
});
