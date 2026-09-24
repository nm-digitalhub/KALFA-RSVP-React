import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { mcpToolName } from './mcp/names';
import { OWNER_AGENT_TOOLS, OWNER_AGENT_TOOLS_PENDING_MIGRATION } from './tools/registry';

// The owner agent's Claude Code settings file, parsed and pinned. The CLI in
// print mode silently IGNORES a settings file that fails validation (its own
// --help), so a drifted key would not error — it would quietly drop every rule
// below. Hence the closed key set.

const SETTINGS_DIR = join(import.meta.dirname, '../../../.claude/fleet/settings');

type Settings = {
  $comment?: string;
  disableAllHooks?: boolean;
  hooks?: unknown;
  permissions: { defaultMode: string; allow: string[]; deny: string[] };
};

const read = (file: string) => JSON.parse(readFileSync(join(SETTINGS_DIR, file), 'utf8')) as Settings;
const settings = read('owner-agent.settings.json');
const tier0 = read('tier0.settings.json');

// Every built-in tool family of the installed CLI (2.1.281: each is a tool-name
// constant in the binary), plus the brief's list. `--tools ""` already removes
// them; this is the wall that stands if that flag is ever dropped.
const REQUIRED_DENIED = [
  'Agent',
  'Task',
  'Bash',
  'PowerShell',
  'REPL',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'LSP',
  'WebFetch',
  'WebSearch',
  'Workflow',
  'Monitor',
  'CronCreate',
  'CronDelete',
  'CronList',
  'RemoteTrigger',
  'EnterWorktree',
  'ExitWorktree',
  'EnterPlanMode',
  'ExitPlanMode',
  'SendMessage',
  'SendUserMessage',
  'PushNotification',
  'AskUserQuestion',
  'TodoWrite',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'TaskStop',
  'Skill',
  'ToolSearch',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
  'Artifact',
  'EndConversation',
];

describe('owner-agent.settings.json', () => {
  it('uses only keys the fleet tier files or the 2.1.281 settings schema use', () => {
    expect(Object.keys(settings).sort()).toEqual(['$comment', 'disableAllHooks', 'permissions']);
    expect(Object.keys(settings.permissions).sort()).toEqual(['allow', 'defaultMode', 'deny']);
  });

  it('is fail-closed: dontAsk, like tier0', () => {
    expect(settings.permissions.defaultMode).toBe('dontAsk');
    expect(tier0.permissions.defaultMode).toBe('dontAsk');
  });

  it('allows exactly the seven offered owner-agent tools, by explicit id', () => {
    const expected = OWNER_AGENT_TOOLS.map((t) => mcpToolName(t.tool.id)).sort();
    expect([...settings.permissions.allow].sort()).toEqual(expected);
    expect(settings.permissions.allow).toHaveLength(7);
  });

  it('allows no pending-migration tool, no wildcard and nothing outside the owner_agent server', () => {
    for (const { tool } of OWNER_AGENT_TOOLS_PENDING_MIGRATION) {
      expect(settings.permissions.allow).not.toContain(mcpToolName(tool.id));
    }
    for (const rule of settings.permissions.allow) {
      expect(rule).toMatch(/^mcp__owner_agent__[a-z][a-z0-9_]*$/);
    }
  });

  it('denies every built-in tool family', () => {
    const missing = REQUIRED_DENIED.filter((t) => !settings.permissions.deny.includes(t));
    expect(missing).toEqual([]);
  });

  it("carries every one of tier0's secret Read denies, verbatim (read live, so they cannot drift)", () => {
    const tier0Reads = tier0.permissions.deny.filter((r) => r.startsWith('Read('));
    expect(tier0Reads.length).toBeGreaterThanOrEqual(7);
    const missing = tier0Reads.filter((r) => !settings.permissions.deny.includes(r));
    expect(missing).toEqual([]);
  });

  it('denies nothing of its own server, and allow and deny do not overlap', () => {
    expect(settings.permissions.deny.filter((r) => r.startsWith('mcp__'))).toEqual([]);
    expect(settings.permissions.allow.filter((r) => settings.permissions.deny.includes(r))).toEqual([]);
  });

  it('runs no hooks: guard.sh is not wired (it cannot see an MCP call) and disableAllHooks is on', () => {
    expect(settings.hooks).toBeUndefined();
    expect(settings.disableAllHooks).toBe(true);
  });
});
