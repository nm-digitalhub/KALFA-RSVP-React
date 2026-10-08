import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('@/lib/owner-agent/runner', () => ({
  nodeExec: exec,
  ownerAgentPaths: () => ({ hostDir: '/test-host' }),
  buildCliEnv: () => ({ HOME: '/test-host', PATH: '/test-bin', NODE_ENV: 'test', TZ: 'Asia/Jerusalem' }),
}));

vi.mock('./package-copy-skills', () => ({
  getPackageCopySkill: vi.fn().mockResolvedValue({ instructions: 'SKILL-INSTRUCTIONS', task: 'FIELD-TASK' }),
}));

import { runPackageCopy } from './package-copy';

beforeEach(() => { exec.mockReset(); });

describe('package copy runner', () => {
  it('sends text via stdin and uses the stored login without database credentials', async () => {
    exec.mockResolvedValue({ ok: true, stdout: JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: 'Improved copy',
    }) });
    expect(await runPackageCopy('description', '--mcp-config=INJECTION', 'user-1')).toBe('Improved copy');
    const request = exec.mock.calls[0][0];
    expect(JSON.parse(request.input).text).toBe('--mcp-config=INJECTION');
    expect(request.args.join(' ')).not.toContain('INJECTION');
    expect(request.env).not.toHaveProperty('SUPABASE_ACCESS_TOKEN');
    expect(request.args).toContain('--no-session-persistence');
    expect(request.args[request.args.indexOf('--tools') + 1]).toBe('');
    expect(request.timeoutMs).toBe(45_000);
    const system = request.args[request.args.indexOf('--system-prompt') + 1];
    expect(system).toContain('SKILL-INSTRUCTIONS');
    expect(system).toContain('FIELD-TASK');
  });

  it('rejects model errors and releases the slot after failure', async () => {
    exec.mockResolvedValueOnce({ ok: true, stdout: JSON.stringify({
      type: 'result', subtype: 'error_max_turns', is_error: true, result: '',
    }) }).mockResolvedValueOnce({ ok: false, failure: 'timeout', stdout: '' });
    await expect(runPackageCopy('description', 'Original', 'user-2')).rejects.toMatchObject({ code: 'invalid_output' });
    await expect(runPackageCopy('description', 'Original', 'user-2')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('refuses duplicate work for the same user', async () => {
    let resolve!: (value: unknown) => void;
    exec.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const first = runPackageCopy('description', 'Original', 'user-3');
    await vi.waitFor(() => expect(exec).toHaveBeenCalled());
    await expect(runPackageCopy('description', 'Original', 'user-3')).rejects.toMatchObject({ code: 'busy' });
    resolve({ ok: true, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Copy' }) });
    await expect(first).resolves.toBe('Copy');
  });
});
