import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import {
  OwnerAgentRunError,
  allowedToolsFor,
  nodeExec,
  parseEnvAssignment,
  parseStreamJson,
  parseTokenEnv,
  runOwnerAgent,
  type OwnerAgentExec,
  type OwnerAgentExecOutcome,
  type OwnerAgentExecRequest,
  type OwnerAgentRunInput,
} from './runner';

// Nothing here runs the real CLI. Every run goes through a fake `exec` that
// records what the runner would have launched and replies with a canned
// stream-json trace, shaped after the 2.1.281 SDK message schemas.

const TOKEN = 'sk-ant-oat01-TEST-TOKEN-SENTINEL-4f9a';
const SB_TOKEN = 'sbp_SUPABASE-PAT-SENTINEL-77c1';
const REF = 'abcdefghijklmnopqrst';
const SUPABASE_TOOLS = ['mcp__supabase__execute_sql', 'mcp__supabase__list_tables'];
const PROMPT = 'כמה אירועים פעילים יש השבוע? PROMPT-SENTINEL';
const SYSTEM = 'אתה עוזר הנתונים של KALFA. ענה בעברית, בקצרה.';
const SESSION = '3f2b8c1e-5d4a-4b6f-9e21-7a8c9d0e1f23';
const NODE = '/opt/node/bin/node';

let host: string;
let repo: string;

beforeEach(() => {
  host = mkdtempSync(path.join(tmpdir(), 'owner-agent-runner-'));
  repo = path.join(host, 'beta');
  mkdirSync(path.join(repo, '.claude/fleet/settings'), { recursive: true });
  mkdirSync(path.join(repo, 'dist'), { recursive: true });
  writeFileSync(path.join(repo, '.claude/fleet/settings/owner-agent.settings.json'), '{}');
  writeFileSync(path.join(repo, 'dist/owner-agent-mcp.cjs'), '');
  writeFileSync(path.join(repo, '.claude/fleet/.token.env'), `CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}\n`);
  mkdirSync(path.join(repo, 'node_modules/@supabase/mcp-server-supabase/dist'), { recursive: true });
  writeFileSync(path.join(repo, 'node_modules/@supabase/mcp-server-supabase/dist/cli.js'), '');
  mkdirSync(path.join(repo, 'supabase/.temp'), { recursive: true });
  writeFileSync(path.join(repo, 'supabase/.temp/project-ref'), `${REF}\n`);
  writeFileSync(
    path.join(repo, '.env.local'),
    `SUPABASE_SERVICE_ROLE_KEY=svc-SENTINEL\nOWNER_AGENT_SUPABASE_TOKEN=${SB_TOKEN}\n`,
  );
});

afterEach(() => {
  rmSync(host, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// --- trace builders ---------------------------------------------------------------

const line = (o: object) => JSON.stringify(o);
const init = (
  servers: Array<{ name: string; status: string }> = [
    { name: 'owner_agent', status: 'connected' },
    { name: 'supabase', status: 'connected' },
  ],
) =>
  line({
    type: 'system',
    subtype: 'init',
    cwd: '/x',
    session_id: SESSION,
    tools: ['mcp__owner_agent__events_pipeline', ...SUPABASE_TOOLS],
    mcp_servers: servers,
    model: 'claude-sonnet-5',
    permissionMode: 'dontAsk',
    slash_commands: [],
    apiKeySource: 'none',
  });
const toolUse = (...names: string[]) =>
  line({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'בודק…' },
        ...names.map((name, i) => ({ type: 'tool_use', id: `toolu_${i}`, name, input: { range: '7d' } })),
      ],
    },
    parent_tool_use_id: null,
    session_id: SESSION,
    uuid: 'u1',
  });
const toolResult = () =>
  line({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_0', content: '{"createdInRange":3}' }] },
    parent_tool_use_id: null,
    session_id: SESSION,
  });
const result = (over: Record<string, unknown> = {}) =>
  line({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1200,
    duration_api_ms: 900,
    num_turns: 3,
    result: 'יש 12 אירועים פעילים.',
    stop_reason: 'end_turn',
    session_id: SESSION,
    total_cost_usd: 0.0123,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    uuid: 'r1',
    ...over,
  });
const trace = (...lines: string[]) => `${lines.join('\n')}\n`;
const OK_TRACE = trace(init(), toolUse('mcp__owner_agent__events_pipeline'), toolResult(), result());

// --- harness ----------------------------------------------------------------------

function fakeExec(outcome: OwnerAgentExecOutcome = { ok: true, stdout: OK_TRACE }) {
  const calls: OwnerAgentExecRequest[] = [];
  const exec: OwnerAgentExec = async (request) => {
    calls.push(request);
    return outcome;
  };
  return { exec, calls };
}

const baseInput = (over: Partial<OwnerAgentRunInput> = {}): OwnerAgentRunInput => ({
  prompt: PROMPT,
  systemPrompt: SYSTEM,
  permissions: ['view_events'],
  model: 'sonnet',
  maxTurns: 6,
  timeoutMs: 90_000,
  ...over,
});

async function runWith(input: OwnerAgentRunInput, outcome?: OwnerAgentExecOutcome) {
  const { exec, calls } = fakeExec(outcome);
  const out = await runOwnerAgent(input, { repoDir: repo, exec, nodePath: NODE });
  return { out, call: calls[0], calls };
}

async function failureOf(input: OwnerAgentRunInput, outcome?: OwnerAgentExecOutcome) {
  const { exec, calls } = fakeExec(outcome);
  const err = await runOwnerAgent(input, { repoDir: repo, exec, nodePath: NODE }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(OwnerAgentRunError);
  return { err: err as OwnerAgentRunError, calls };
}

const p = (rel: string) => path.join(repo, rel);

function expectedArgs(opts: { allowed: string[]; permissions: string; resume?: string }) {
  const mcpConfig = JSON.stringify({
    mcpServers: {
      owner_agent: {
        type: 'stdio',
        command: NODE,
        args: [`--env-file=${p('.env.local')}`, p('dist/owner-agent-mcp.cjs')],
        env: {
          OWNER_AGENT_PERMISSIONS: opts.permissions,
          MASTRA_TELEMETRY_DISABLED: 'true',
          CLAUDE_CODE_OAUTH_TOKEN: '',
          SUPABASE_ACCESS_TOKEN: '',
        },
        alwaysLoad: true,
      },
      supabase: {
        type: 'stdio',
        command: NODE,
        args: [
          p('node_modules/@supabase/mcp-server-supabase/dist/cli.js'),
          '--read-only',
          '--project-ref',
          REF,
          '--features',
          'database',
        ],
        env: { CLAUDE_CODE_OAUTH_TOKEN: '' },
        alwaysLoad: true,
      },
    },
  });
  return [
    '-p',
    '--permission-mode',
    'dontAsk',
    '--setting-sources',
    'project',
    '--settings',
    p('.claude/fleet/settings/owner-agent.settings.json'),
    '--strict-mcp-config',
    '--mcp-config',
    mcpConfig,
    '--tools',
    '',
    '--allowedTools',
    [...opts.allowed, ...SUPABASE_TOOLS].join(','),
    '--system-prompt',
    SYSTEM,
    '--model',
    'sonnet',
    '--max-turns',
    '6',
    '--output-format',
    'stream-json',
    '--verbose',
    ...(opts.resume ? ['--resume', opts.resume] : []),
  ];
}

// ---------------------------------------------------------------------------------

describe('the exact argv, per permission set', () => {
  it.each([
    [['view_events'], ['mcp__owner_agent__events_pipeline', 'mcp__owner_agent__rsvp_totals'], 'view_events'],
    [
      ['view_webhooks', 'view_customer_data'],
      [
        'mcp__owner_agent__inquiries_summary',
        'mcp__owner_agent__system_health',
        'mcp__owner_agent__web_traffic_summary',
        'mcp__owner_agent__whatsapp_delivery_summary',
      ],
      'view_customer_data,view_webhooks',
    ],
    [
      ['view_customer_data', 'manage_billing', 'view_billing', 'manage_voice', 'view_events', 'view_webhooks'],
      [
        'mcp__owner_agent__billing_summary',
        'mcp__owner_agent__campaigns_status_summary',
        'mcp__owner_agent__events_pipeline',
        'mcp__owner_agent__inquiries_summary',
        'mcp__owner_agent__rsvp_totals',
        'mcp__owner_agent__system_health',
        'mcp__owner_agent__voice_calls_summary',
        'mcp__owner_agent__web_traffic_summary',
        'mcp__owner_agent__whatsapp_delivery_summary',
      ],
      'manage_billing,manage_voice,view_billing,view_customer_data,view_events,view_webhooks',
    ],
    [['view_billing'], ['mcp__owner_agent__billing_summary'], 'view_billing'],
    [['manage_billing'], ['mcp__owner_agent__campaigns_status_summary'], 'manage_billing'],
    [[], [], ''],
    // Duplicates collapse; order is canonical.
    [['view_events', 'view_events'], ['mcp__owner_agent__events_pipeline', 'mcp__owner_agent__rsvp_totals'], 'view_events'],
  ] as const)('%j → --allowedTools %j', async (permissions, allowed, env) => {
    const { call } = await runWith(baseInput({ permissions }));
    expect(call.file).toBe('claude');
    expect(call.args).toEqual(expectedArgs({ allowed: [...allowed], permissions: env }));
  });

  it('appends --resume <id> last when given', async () => {
    const { call } = await runWith(baseInput({ resumeSessionId: SESSION }));
    expect(call.args).toEqual(
      expectedArgs({
        allowed: ['mcp__owner_agent__events_pipeline', 'mcp__owner_agent__rsvp_totals'],
        permissions: 'view_events',
        resume: SESSION,
      }),
    );
  });

  it('with no permission at all, exactly the two Supabase tools are allowed (plan §3.8)', async () => {
    const { call } = await runWith(baseInput({ permissions: [] }));
    expect(call.args[call.args.indexOf('--allowedTools') + 1]).toBe(SUPABASE_TOOLS.join(','));
  });

  it('allowedToolsFor: at most 11, and never another Supabase tool', () => {
    const all = allowedToolsFor(['view_customer_data', 'manage_billing', 'view_billing', 'manage_voice', 'view_events', 'view_webhooks']);
    expect(all).toHaveLength(11);
    expect(all.filter((t) => t.startsWith('mcp__supabase__'))).toEqual(SUPABASE_TOOLS);
    for (const never of ['list_migrations', 'list_extensions', 'apply_migration']) {
      expect(all).not.toContain(`mcp__supabase__${never}`);
    }
  });
});

describe('the walls that must always be there', () => {
  it.each([
    [baseInput()],
    [baseInput({ permissions: [] })],
    [baseInput({ permissions: ['view_billing'] })],
    [baseInput({ resumeSessionId: SESSION, permissions: ['view_webhooks', 'manage_voice'] })],
  ])('--tools "" and --strict-mcp-config are present (%#)', async (input) => {
    const { call } = await runWith(input);
    const tools = call.args.indexOf('--tools');
    expect(tools).toBeGreaterThan(-1);
    expect(call.args[tools + 1]).toBe('');
    expect(call.args.filter((a) => a === '--tools')).toHaveLength(1);
    expect(call.args).toContain('--strict-mcp-config');
    expect(call.args.filter((a) => a === '--mcp-config')).toHaveLength(1);
    // Nothing that would re-open a door.
    for (const forbidden of ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--append-system-prompt', '--add-dir']) {
      expect(call.args).not.toContain(forbidden);
    }
    const mcp = JSON.parse(call.args[call.args.indexOf('--mcp-config') + 1]) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    expect(Object.keys(mcp.mcpServers)).toEqual(['owner_agent', 'supabase']);
    // The Supabase server is read-only, database-only, on the linked project.
    const sb = mcp.mcpServers.supabase.args;
    expect(sb).toContain('--read-only');
    expect(sb.slice(sb.indexOf('--features'), sb.indexOf('--features') + 2)).toEqual(['--features', 'database']);
    expect(sb.slice(sb.indexOf('--project-ref'), sb.indexOf('--project-ref') + 2)).toEqual(['--project-ref', REF]);
  });

  it('the prompt goes on stdin and nowhere in argv', async () => {
    const { call } = await runWith(baseInput());
    expect(call.input).toBe(PROMPT);
    expect(call.args.some((a) => a.includes('PROMPT-SENTINEL'))).toBe(false);
  });

  it('a prompt shaped like an option is still only stdin (it cannot become a flag)', async () => {
    const evil = '--mcp-config={"mcpServers":{"x":{"command":"sh"}}}';
    const { call } = await runWith(baseInput({ prompt: evil }));
    expect(call.input).toBe(evil);
    expect(call.args).not.toContain(evil);
    expect(call.args.filter((a) => a === '--mcp-config')).toHaveLength(1);
  });

  it('runs in the dedicated cwd, created on demand', async () => {
    const { call } = await runWith(baseInput());
    expect(call.cwd).toBe(p('.fleet-logs/owner-agent/cwd'));
  });

  it('passes the timeout through, with a hard-kill grace', async () => {
    const { call } = await runWith(baseInput({ timeoutMs: 45_000 }));
    expect(call.timeoutMs).toBe(45_000);
    expect(call.killAfterMs).toBe(10_000);
  });
});

describe('the token', () => {
  it('is read from .claude/fleet/.token.env into the child env — and only there', async () => {
    const { call } = await runWith(baseInput());
    expect(call.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
    expect(call.args.some((a) => a.includes(TOKEN))).toBe(false);
    expect(call.input).not.toContain(TOKEN);
  });

  it('the child env is built, not inherited: HOME/PATH pinned like run-role.sh, no server secrets', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc-role-SENTINEL');
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'inherited-token-SENTINEL');
    const { call } = await runWith(baseInput());
    expect(call.env).toEqual({
      HOME: host,
      PATH: `${host}/.supabase/bin:${host}/.local/bin:/usr/local/bin:/usr/bin:/bin`,
      NODE_ENV: 'production',
      TZ: 'Asia/Jerusalem',
      CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
      SUPABASE_ACCESS_TOKEN: SB_TOKEN,
    });
    expect(JSON.stringify(call)).not.toContain('svc-role-SENTINEL');
    // .env.local is read for ONE key; nothing else in it reaches the child.
    expect(JSON.stringify(call)).not.toContain('svc-SENTINEL');
  });

  it('the Supabase access token is in the CLI env ONLY: never argv, the mcp-config or stdin (plan §4.3)', async () => {
    const { call } = await runWith(baseInput());
    expect(call.env.SUPABASE_ACCESS_TOKEN).toBe(SB_TOKEN);
    expect(call.args.some((a) => a.includes(SB_TOKEN))).toBe(false);
    expect(call.input).not.toContain(SB_TOKEN);
    // Each server's config only BLANKS inherited credentials (measured: config env wins).
    const mcp = JSON.parse(call.args[call.args.indexOf('--mcp-config') + 1]) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
    };
    expect(mcp.mcpServers.owner_agent.env).toMatchObject({ SUPABASE_ACCESS_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN: '' });
    expect(mcp.mcpServers.supabase.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: '' });
  });

  it.each([
    ['no .env.local', () => unlinkSync(p('.env.local'))],
    ['no assignment in it', () => writeFileSync(p('.env.local'), 'OTHER=1\n')],
    ['an empty value', () => writeFileSync(p('.env.local'), 'OWNER_AGENT_SUPABASE_TOKEN=\n')],
  ])('%s → supabase_token_unavailable, and the CLI is never started', async (_label, arrange) => {
    arrange();
    const { err, calls } = await failureOf(baseInput());
    expect(err.code).toBe('supabase_token_unavailable');
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['a missing project-ref file', () => unlinkSync(p('supabase/.temp/project-ref'))],
    ['a project ref shaped like a flag', () => writeFileSync(p('supabase/.temp/project-ref'), '--read-write')],
    ['a project ref with a space', () => writeFileSync(p('supabase/.temp/project-ref'), 'abcdefghij klmnopqrs')],
  ])('%s → runner_misconfigured, and the CLI is never started', async (_label, arrange) => {
    arrange();
    const { err, calls } = await failureOf(baseInput());
    expect(err.code).toBe('runner_misconfigured');
    expect(calls).toHaveLength(0);
  });

  it('is re-read on every run (a rotated token needs no restart)', async () => {
    const { exec, calls } = fakeExec();
    await runOwnerAgent(baseInput(), { repoDir: repo, exec, nodePath: NODE });
    writeFileSync(p('.claude/fleet/.token.env'), 'export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-ROTATED"\n');
    await runOwnerAgent(baseInput(), { repoDir: repo, exec, nodePath: NODE });
    expect(calls.map((c) => c.env.CLAUDE_CODE_OAUTH_TOKEN)).toEqual([TOKEN, 'sk-ant-oat01-ROTATED']);
  });

  it('a missing file is token_unavailable, and the CLI is never started', async () => {
    unlinkSync(p('.claude/fleet/.token.env'));
    const { err, calls } = await failureOf(baseInput());
    expect(err.code).toBe('token_unavailable');
    expect(calls).toHaveLength(0);
  });

  it('a file with no assignment is token_unavailable', async () => {
    writeFileSync(p('.claude/fleet/.token.env'), '# nothing here\nOTHER=1\n');
    const { err, calls } = await failureOf(baseInput());
    expect(err.code).toBe('token_unavailable');
    expect(calls).toHaveLength(0);
  });

  it('never appears in an error, and the runner logs nothing at all', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    for (const outcome of [
      { ok: false, failure: 'exit', stdout: `${TOKEN} ${PROMPT}` },
      { ok: false, failure: 'timeout', stdout: '' },
      { ok: true, stdout: `not json ${TOKEN}` },
    ] as OwnerAgentExecOutcome[]) {
      const { err } = await failureOf(baseInput(), outcome);
      for (const s of [err.message, String(err), JSON.stringify(err), err.stack ?? '']) {
        expect(s).not.toContain(TOKEN);
      }
    }
    await runWith(baseInput());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('parseTokenEnv', () => {
  it.each([
    [`CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}`, TOKEN],
    [`export CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}`, TOKEN],
    [`CLAUDE_CODE_OAUTH_TOKEN="${TOKEN}"`, TOKEN],
    [`CLAUDE_CODE_OAUTH_TOKEN='${TOKEN}'\r\n`, TOKEN],
    [`# comment\n\nCLAUDE_CODE_OAUTH_TOKEN=old\nCLAUDE_CODE_OAUTH_TOKEN=${TOKEN}`, TOKEN],
    ['CLAUDE_CODE_OAUTH_TOKEN=', null],
    ['CLAUDE_CODE_OAUTH_TOKEN=$(curl evil)', null],
    ['CLAUDE_CODE_OAUTH_TOKEN=a b', null],
    ['OTHER_TOKEN=x', null],
    ['', null],
  ])('%j → %j', (contents, expected) => {
    expect(parseTokenEnv(contents)).toBe(expected);
  });

  it('parseEnvAssignment reads only the exact key', () => {
    const env = `X_OWNER_AGENT_SUPABASE_TOKEN=wrong\nOWNER_AGENT_SUPABASE_TOKEN_OLD=wrong\nOWNER_AGENT_SUPABASE_TOKEN="${SB_TOKEN}"\n`;
    expect(parseEnvAssignment(env, 'OWNER_AGENT_SUPABASE_TOKEN')).toBe(SB_TOKEN);
    expect(parseEnvAssignment('OWNER_AGENT_SUPABASE_TOKEN=$(id)', 'OWNER_AGENT_SUPABASE_TOKEN')).toBeNull();
  });
});

describe('the result', () => {
  it('text, cost, session, turns and the tool ids that were called', async () => {
    const { out } = await runWith(baseInput());
    expect(out).toEqual({
      text: 'יש 12 אירועים פעילים.',
      costUsd: 0.0123,
      sessionId: SESSION,
      toolNames: ['events_pipeline'],
      turns: 3,
      sqlUnavailable: false,
    });
  });

  it('tool names: first-use order, deduplicated, foreign names kept verbatim', () => {
    const t = parseStreamJson(
      trace(
        init(),
        toolUse('mcp__owner_agent__system_health', 'mcp__owner_agent__events_pipeline'),
        toolUse('mcp__owner_agent__system_health', 'Bash'),
        result(),
      ),
    );
    expect(t.ok && t.toolNames).toEqual(['system_health', 'events_pipeline', 'Bash']);
  });

  it('a missing cost is null, not zero', async () => {
    const { out } = await runWith(baseInput(), {
      ok: true,
      stdout: trace(init(), line({ ...JSON.parse(result()), total_cost_usd: undefined })),
    });
    expect(out.costUsd).toBeNull();
    expect(out.toolNames).toEqual([]);
  });

  it('returns the model text as written — phone numbers included (no output filter, owner decision)', async () => {
    const answer = 'דנה כהן, 050-1234567; יוסי לוי, +972 52 765 4321. 12 אירועים.';
    const { out } = await runWith(baseInput(), { ok: true, stdout: trace(init(), result({ result: answer })) });
    expect(out.text).toBe(answer);
  });

  it.each([
    ['failed', [{ name: 'owner_agent', status: 'connected' }, { name: 'supabase', status: 'failed' }]],
    ['pending', [{ name: 'owner_agent', status: 'connected' }, { name: 'supabase', status: 'pending' }]],
    ['absent', [{ name: 'owner_agent', status: 'connected' }]],
  ])('a Supabase server that is %s DEGRADES the run: an answer, flagged sqlUnavailable', async (_label, servers) => {
    const { out } = await runWith(baseInput(), { ok: true, stdout: trace(init(servers), result()) });
    expect(out.text).toBe('יש 12 אירועים פעילים.');
    expect(out.sqlUnavailable).toBe(true);
  });

  it('both servers connected: sqlUnavailable is false', async () => {
    const { out } = await runWith(baseInput());
    expect(out.sqlUnavailable).toBe(false);
  });

  it('Supabase tools come back as their bare ids for the audit', () => {
    const t = parseStreamJson(
      trace(init(), toolUse('mcp__supabase__list_tables', 'mcp__supabase__execute_sql', 'mcp__owner_agent__rsvp_totals'), result()),
    );
    expect(t.ok && t.toolNames).toEqual(['list_tables', 'execute_sql', 'rsvp_totals']);
  });
});

describe('failures become typed codes', () => {
  it.each([
    ['timeout', { ok: false, failure: 'timeout', stdout: '' }],
    ['cli_not_found', { ok: false, failure: 'not_found', stdout: '' }],
    ['output_too_large', { ok: false, failure: 'too_large', stdout: '' }],
    ['cli_failed', { ok: false, failure: 'spawn', stdout: '' }],
    ['cli_failed', { ok: false, failure: 'exit', stdout: 'Error: something STDERR-SENTINEL' }],
    ['cli_failed', { ok: false, failure: 'exit', stdout: trace(init(), result()) }],
    ['max_turns', { ok: false, failure: 'exit', stdout: trace(init(), result({ subtype: 'error_max_turns', is_error: true, result: undefined, errors: ['Reached maximum number of turns (6)'] })) }],
    ['model_error', { ok: false, failure: 'exit', stdout: trace(init(), result({ subtype: 'error_during_execution', is_error: true, result: undefined, errors: ['boom'] })) }],
    ['unparsable_output', { ok: true, stdout: 'STDOUT-SENTINEL not json at all' }],
    ['unparsable_output', { ok: true, stdout: '' }],
    ['unparsable_output', { ok: true, stdout: trace(result()) }],
    ['unparsable_output', { ok: true, stdout: trace(init()) }],
    ['mcp_unavailable', { ok: true, stdout: trace(init([{ name: 'owner_agent', status: 'failed' }, { name: 'supabase', status: 'connected' }]), result()) }],
    ['mcp_unavailable', { ok: true, stdout: trace(init([{ name: 'owner_agent', status: 'pending' }, { name: 'supabase', status: 'connected' }]), result()) }],
    ['mcp_unavailable', { ok: true, stdout: trace(init([{ name: 'someone_else', status: 'connected' }, { name: 'supabase', status: 'connected' }]), result()) }],
    // Our server is required even when the Supabase one connected.
    ['mcp_unavailable', { ok: true, stdout: trace(init([{ name: 'supabase', status: 'connected' }]), result()) }],
    // An auth or API failure: subtype success, is_error true, the failure text
    // in `result`. It must not come back as an answer.
    ['model_error', { ok: true, stdout: trace(init(), result({ is_error: true, result: 'Invalid API key · STDOUT-SENTINEL' })) }],
    ['model_error', { ok: true, stdout: trace(init(), result({ result: undefined })) }],
  ] as [string, OwnerAgentExecOutcome][])('%s ← %j', async (code, outcome) => {
    const { err } = await failureOf(baseInput(), outcome);
    expect(err.code).toBe(code);
    // The code and nothing else: no prompt, stdout, stderr or token.
    expect(err.message).toBe(code);
    expect('cause' in err).toBe(false);
    for (const s of [String(err), JSON.stringify(err), err.stack ?? '']) {
      for (const sentinel of ['PROMPT-SENTINEL', 'STDOUT-SENTINEL', 'STDERR-SENTINEL', TOKEN]) {
        expect(s).not.toContain(sentinel);
      }
    }
  });

  it.each([
    ['an empty prompt', { prompt: '' }],
    ['a blank prompt', { prompt: '  \n ' }],
    ['a blank system prompt', { systemPrompt: ' ' }],
    ['an unknown permission', { permissions: ['manage_staff'] as unknown as OwnerAgentRunInput['permissions'] }],
    ['a resume id that is not a session id', { resumeSessionId: 'latest' }],
    ['a model that is a flag', { model: '--dangerously-skip-permissions' }],
    ['a model with a space', { model: 'sonnet --verbose' }],
    ['zero turns', { maxTurns: 0 }],
    ['fractional turns', { maxTurns: 1.5 }],
    ['a zero timeout', { timeoutMs: 0 }],
  ])('rejects %s as invalid_input without starting anything', async (_label, over) => {
    const { err, calls } = await failureOf(baseInput(over));
    expect(err.code).toBe('invalid_input');
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['the settings file', '.claude/fleet/settings/owner-agent.settings.json'],
    ['the MCP server bundle', 'dist/owner-agent-mcp.cjs'],
    ['the Supabase MCP server', 'node_modules/@supabase/mcp-server-supabase/dist/cli.js'],
  ])('refuses to start when %s is missing (runner_misconfigured)', async (_label, rel) => {
    unlinkSync(p(rel));
    const { err, calls } = await failureOf(baseInput());
    expect(err.code).toBe('runner_misconfigured');
    expect(calls).toHaveLength(0);
  });
});

// The real exec, against plain node child processes — never the claude CLI.
describe('nodeExec', () => {
  const node = process.execPath;
  const req = (script: string, over: Partial<OwnerAgentExecRequest> = {}): OwnerAgentExecRequest => ({
    file: node,
    args: ['-e', script],
    cwd: tmpdir(),
    env: { PATH: process.env.PATH, NODE_ENV: 'test' },
    input: '',
    timeoutMs: 10_000,
    killAfterMs: 1_000,
    maxBuffer: 1024 * 1024,
    ...over,
  });

  it('writes the input to stdin and returns stdout', async () => {
    const out = await nodeExec(
      req('let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write("got:"+s))', {
        input: 'שלום',
      }),
    );
    expect(out).toEqual({ ok: true, stdout: 'got:שלום' });
  });

  it('a non-zero exit keeps the stdout written before it', async () => {
    const out = await nodeExec(req('process.stdout.write("partial");process.exit(3)'));
    expect(out).toEqual({ ok: false, failure: 'exit', stdout: 'partial' });
  });

  it('a missing program is not_found', async () => {
    const out = await nodeExec(req('', { file: path.join(tmpdir(), 'no-such-claude-binary') }));
    expect(out).toEqual({ ok: false, failure: 'not_found', stdout: '' });
  });

  it('a child that ignores SIGTERM is hard-killed and reported as a timeout', async () => {
    const started = Date.now();
    const out = await nodeExec(
      req('process.on("SIGTERM",()=>{});process.stdout.write("x");setInterval(()=>{},1000)', {
        timeoutMs: 300,
        killAfterMs: 300,
      }),
    );
    expect(out).toEqual({ ok: false, failure: 'timeout', stdout: '' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('output beyond maxBuffer is too_large', async () => {
    const out = await nodeExec(req('process.stdout.write("x".repeat(64*1024))', { maxBuffer: 1024 }));
    expect(out).toEqual({ ok: false, failure: 'too_large', stdout: '' });
  });

  it('a child that exits without reading stdin does not crash the caller (EPIPE)', async () => {
    const out = await nodeExec(req('process.exit(0)', { input: 'y'.repeat(4 * 1024 * 1024) }));
    expect(out.ok).toBe(true);
  });
});
