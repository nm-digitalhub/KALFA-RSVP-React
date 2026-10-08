import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('@/lib/owner-agent/runner', () => ({ nodeExec: exec }));
const content = '---\nname: hebrew-content-writer\n---\nWRITER-INSTRUCTIONS';
const success = { ok: true, stdout: `CLI prefix\n<SKILL.md>\n${content}\n</SKILL.md>\nTEMPORARY-PATH` };

beforeEach(() => { exec.mockReset(); vi.resetModules(); });

describe('package copy skills', () => {
  it('loads once, but chooses different task instructions for each field', async () => {
    exec.mockResolvedValue(success);
    const { getPackageCopySkill } = await import('./package-copy-skills');
    const description = await getPackageCopySkill('description', '/repo', { PATH: '/bin', NODE_ENV: 'test' });
    const includes = await getPackageCopySkill('includes', '/repo', { PATH: '/bin', NODE_ENV: 'test' });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(description.instructions).toBe(content);
    expect(includes.instructions).toBe(content);
    expect(description.task).not.toBe(includes.task);
    expect(description.instructions).not.toContain('TEMPORARY-PATH');
    const request = exec.mock.calls[0][0];
    expect(request.file).toBe('npx');
    expect(request.args.slice(0, 3)).toEqual(['--no-install', 'skills', 'use']);
    expect(request.args).not.toContain('--agent');
  });
  it('asks for a rewrite of the description and keeps the item count and order for the list', async () => {
    exec.mockResolvedValue(success);
    const { getPackageCopySkill } = await import('./package-copy-skills');
    const description = await getPackageCopySkill('description', '/repo', { NODE_ENV: 'test' });
    const includes = await getPackageCopySkill('includes', '/repo', { NODE_ENV: 'test' });
    expect(description.task).toContain('שכתב');
    expect(description.task).toContain('אל תסתפק בהגהה');
    expect(description.task).toContain('2000');
    expect(includes.task).toContain('מספר הפריטים ועל סדרם');
    expect(includes.task).toContain('200');
  });
  it('shares an in-flight download between two callers', async () => {
    let resolve!: (value: unknown) => void;
    exec.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { getPackageCopySkill } = await import('./package-copy-skills');
    const requests = [getPackageCopySkill('description', '/repo', { NODE_ENV: 'test' }), getPackageCopySkill('includes', '/repo', { NODE_ENV: 'test' })];
    expect(exec).toHaveBeenCalledTimes(1);
    resolve(success);
    await Promise.all(requests);
  });
  it('allows retry after a failed download', async () => {
    exec.mockResolvedValueOnce({ ok: false, failure: 'timeout', stdout: '' }).mockResolvedValueOnce(success);
    const { getPackageCopySkill } = await import('./package-copy-skills');
    await expect(getPackageCopySkill('description', '/repo', { NODE_ENV: 'test' })).rejects.toThrow('Skill loading failed');
    await expect(getPackageCopySkill('description', '/repo', { NODE_ENV: 'test' })).resolves.toHaveProperty('instructions', content);
    expect(exec).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed CLI output', async () => {
    exec.mockResolvedValue({ ok: true, stdout: 'Not a skill' });
    const { getPackageCopySkill } = await import('./package-copy-skills');
    await expect(getPackageCopySkill('description', '/repo', { NODE_ENV: 'test' })).rejects.toThrow('Unexpected skill instructions');
  });
});
