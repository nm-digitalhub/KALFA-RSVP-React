import 'server-only';

import { execFile, type ExecFileException } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
  OWNER_AGENT_MCP_SERVER,
  OWNER_AGENT_PERMISSIONS_ENV,
  mcpToolName,
  toolIdFromMcpName,
} from '@/lib/owner-agent/mcp/names';
import { redactPhoneNumbers } from '@/lib/owner-agent/redact';
import { toolsForPermissions } from '@/lib/owner-agent/tools/registry';
import { OWNER_AGENT_PERMISSIONS, type OwnerAgentPermission } from '@/lib/owner-agent/tools/shared';

// One owner-agent answer: a headless `claude -p` run whose only tools are the
// owner-agent MCP server's (plan §4, owner decision 2026-09-24: "work exactly
// the same way as the fleet").
//
// ⚠️ THE FLEET'S METHOD, ON PURPOSE. `.claude/fleet/bin/run-role.sh` and the
// workflow engine's `ai` port (src/lib/workflow/enqueue.ts) already drive the
// installed CLI with the long-lived CLAUDE_CODE_OAUTH_TOKEN from
// .claude/fleet/.token.env. Mirrored from them: the token read from that file
// at run time; HOME and PATH pinned exactly as run-role.sh pins them;
// `--permission-mode dontAsk --setting-sources project --settings <file>`;
// execFile, never a shell; a hard timeout; and the JSON trace parsed for the
// result text, total_cost_usd and session_id. No API key, no Mastra Agent.
//
// DELIBERATE DEVIATIONS from run-role.sh, each for a stated reason:
//
//  1. NO GLOBAL FLEET FLOCK. run-role.sh serializes all fleet work on
//     locks/global.lock. A WhatsApp answer must never wait behind a
//     20-minute fleet role, and this run starts no `next build` (the thing
//     the lock exists to serialize).
//  2. TOOLS COME ONLY FROM OUR MCP SERVER. `--tools ""` removes every built-in
//     (help: 'Use "" to disable all tools'), `--strict-mcp-config` ignores
//     every MCP server except the one in --mcp-config, and the server
//     registers only the tools the caller's permission set unlocks.
//  3. THE PROMPT GOES ON STDIN, NOT IN ARGV. The CLI accepts either ("Input
//     must be provided either through stdin or as a prompt argument when
//     using --print", 2.1.281 binary). A positional prompt that begins with
//     `-` is parsed as an OPTION — an owner message reading
//     `--mcp-config={…}` would add a server that --strict-mcp-config then
//     trusts. Stdin also sidesteps the variadic options (--tools,
//     --allowedTools, --mcp-config) swallowing a trailing argument, and the
//     kernel's 128 KiB limit on a single argument.
//  4. THE ENVIRONMENT IS BUILT, NOT INHERITED. run-role.sh inherits the
//     scheduler's environment and pins HOME/PATH; the workflow port passes
//     the whole worker environment. The consumer of this runner will hold
//     the Supabase service-role key, and the CLI has no use for it — so the
//     CLI gets HOME, PATH, NODE_ENV and TZ (as a fleet run has them), the
//     token and CLAUDE_CODE_DISABLE_CLAUDE_MDS, and nothing else. The MCP
//     server loads its own credentials with `node --env-file` (./mcp/main.ts).
//  5. A MISSING TOKEN IS AN ERROR. run-role.sh proceeds without the file, and
//     under the pinned HOME the CLI would fall back to the owner's
//     interactive login. A service must not silently depend on that login.
//  6. THE TOKEN FILE IS PARSED, NOT SOURCED. run-role.sh `.`-sources it; a
//     Node process reads the one assignment it needs and executes nothing.
//  7. `--output-format stream-json --verbose`, NOT `json`. The single `json`
//     result carries no tool names (its 2.1.281 schema: result, num_turns,
//     session_id, total_cost_usd, usage, permission_denials — no tool list),
//     and the audit needs them. stream-json emits every assistant message,
//     so tool_use names can be read, plus the init line, which reports
//     whether our MCP server actually connected. `--verbose` is required
//     with it in print mode (the CLI refuses otherwise).
//  8. `--system-prompt` REPLACES Claude Code's default system prompt (help:
//     "System prompt to use for the session"; `--append-system-prompt`
//     would keep the coding-assistant prompt and add to it), and
//     CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 keeps the repo's CLAUDE.md files out:
//     from the dedicated cwd below, the walk up would otherwise reach
//     beta/CLAUDE.md and ~/.claude/CLAUDE.md. The variable is present in the
//     2.1.281 binary and is exactly what `--safe-mode` sets, whose help says
//     it starts "with all customizations (CLAUDE.md, …) disabled".
//  9. A DEDICATED CWD: <repo>/.fleet-logs/owner-agent/cwd. The CLI keeps a
//     session under $HOME/.claude/projects/<cwd with every non-alphanumeric
//     character replaced by '-'>/<session_id>.jsonl — here
//     /var/www/vhosts/kalfa.me/.claude/projects/
//     -var-www-vhosts-kalfa-me-beta--fleet-logs-owner-agent-cwd/ — apart from
//     the fleet's (-var-www-vhosts-kalfa-me-beta). The directory has no
//     .claude/ of its own, so no project settings, hooks or MCP servers load
//     from it. `--resume` looks the session up under the SAME cwd, so it must
//     not move while sessions are kept.
// 10. SIGKILL 10 s AFTER THE TIMEOUT, not 60 (run-role.sh's
//     `timeout --kill-after=60`). The runner reports the timeout only once
//     the process is gone; an owner waiting on WhatsApp should not wait a
//     further minute for a CLI that ignored SIGTERM.

export type OwnerAgentRunErrorCode =
  | 'invalid_input'
  | 'runner_misconfigured'
  | 'token_unavailable'
  | 'cli_not_found'
  | 'timeout'
  | 'output_too_large'
  | 'cli_failed'
  | 'unparsable_output'
  | 'mcp_unavailable'
  | 'max_turns'
  | 'model_error';

// ⚠️ THE MESSAGE IS THE CODE AND NOTHING ELSE, and there is no `cause`. Node's
// exec error carries `cmd` (the full argv), `stdout` and `stderr`; any of them
// can hold the question, the model's text, a tool result or a provider error.
// A fresh error per failure means none of that can ride along into a log line,
// an audit row or a WhatsApp reply.
export class OwnerAgentRunError extends Error {
  readonly code: OwnerAgentRunErrorCode;

  constructor(code: OwnerAgentRunErrorCode) {
    super(code);
    this.name = 'OwnerAgentRunError';
    this.code = code;
  }
}

export interface OwnerAgentRunInput {
  /** The owner's question. Sent on stdin, never in argv. */
  prompt: string;
  /** Replaces Claude Code's default system prompt (`--system-prompt`). */
  systemPrompt: string;
  /**
   * The staff member's granted platform permission keys, resolved server-side
   * by the caller (has_platform_permission_for_user). Never from the model.
   */
  permissions: readonly OwnerAgentPermission[];
  /** Continue an earlier CLI session (`--resume`). Stage 6b decides whether. */
  resumeSessionId?: string;
  /** Model as the CLI spells it: an alias (`sonnet`) or a full name. */
  model: string;
  maxTurns: number;
  timeoutMs: number;
}

export interface OwnerAgentRunResult {
  /** The model's answer, phone-shaped digit runs already masked. */
  text: string;
  /** `total_cost_usd` from the CLI; null when it reported none. */
  costUsd: number | null;
  sessionId: string;
  /**
   * Tools the model called, in first-use order, deduplicated. Owner-agent
   * tools as their registry id (`events_pipeline`); any other name verbatim.
   */
  toolNames: string[];
  /** `num_turns` from the CLI. */
  turns: number;
}

// --- exec: the one seam to the operating system --------------------------------

export interface OwnerAgentExecRequest {
  file: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Written to the child's stdin, which is then closed. */
  input: string;
  timeoutMs: number;
  /** SIGKILL this long after the SIGTERM a timeout sends. */
  killAfterMs: number;
  maxBuffer: number;
}

// Resolved, never rejected: a failure is a kind plus the stdout the child had
// written (the CLI prints its result record even when it exits non-zero, which
// is how `error_max_turns` is told apart from a crash). Nothing else from the
// Node error — not `cmd`, not stderr — crosses this boundary.
export type OwnerAgentExecOutcome =
  | { ok: true; stdout: string }
  | { ok: false; failure: 'timeout' | 'not_found' | 'too_large' | 'exit' | 'spawn'; stdout: string };

export type OwnerAgentExec = (request: OwnerAgentExecRequest) => Promise<OwnerAgentExecOutcome>;

function classifyExecError(error: ExecFileException, stdout: string): OwnerAgentExecOutcome {
  if (error.code === 'ENOENT') return { ok: false, failure: 'not_found', stdout: '' };
  // Checked before `killed`: Node kills the child when the buffer overflows.
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return { ok: false, failure: 'too_large', stdout: '' };
  }
  // `killed` is set only when THIS process sent the signal: the execFile
  // timeout's SIGTERM, or the hard SIGKILL below.
  if (error.killed) return { ok: false, failure: 'timeout', stdout: '' };
  // A non-zero exit, or a signal from elsewhere (the OOM killer).
  if (typeof error.code === 'number' || error.signal) return { ok: false, failure: 'exit', stdout };
  return { ok: false, failure: 'spawn', stdout: '' };
}

export const nodeExec: OwnerAgentExec = (request) =>
  new Promise((resolve) => {
    const child = execFile(
      request.file,
      [...request.args],
      {
        cwd: request.cwd,
        env: request.env,
        // execFile, NOT exec: argv goes to the program as-is, no shell ever
        // sees it. The command is looked up on env.PATH — the pinned one —
        // because `env` is given (Node child_process docs, spawn: "the
        // command lookup is performed using options.env.PATH").
        timeout: request.timeoutMs,
        killSignal: 'SIGTERM',
        maxBuffer: request.maxBuffer,
        encoding: 'utf8',
        windowsHide: true,
      },
      // Always asynchronous, so `hardKill` below is initialized by the time
      // this runs.
      (error, stdout) => {
        clearTimeout(hardKill);
        if (!error) resolve({ ok: true, stdout });
        else resolve(classifyExecError(error, stdout));
      },
    );
    // The `--kill-after` half of run-role.sh's `timeout`: execFile sends one
    // SIGTERM and then waits for ever on a child that ignores it.
    const hardKill = setTimeout(() => child.kill('SIGKILL'), request.timeoutMs + request.killAfterMs);
    hardKill.unref();
    // A CLI that exits before reading its input turns the write into EPIPE,
    // an 'error' event that would otherwise crash the calling process.
    child.stdin?.on('error', () => {});
    child.stdin?.end(request.input);
  });

// --- configuration --------------------------------------------------------------

const MAX_BUFFER = 8 * 1024 * 1024;
// Exported for the consumer's budget chain (consumer/budgets.ts).
export const KILL_AFTER_MS = 10_000;

// Input ceilings. The system prompt travels in argv, and Linux caps a single
// argument at 128 KiB (MAX_ARG_STRLEN); a Hebrew character is two bytes.
const MAX_SYSTEM_PROMPT_CHARS = 32_000;
const MAX_PROMPT_CHARS = 100_000;
const MAX_TURNS_CEILING = 20;
// The workflow port's AI_TIMEOUT_MS: longer than any sane single answer.
const MAX_TIMEOUT_MS = 10 * 60 * 1000;

// An alias or a full model name (`sonnet`, `claude-sonnet-5`,
// `claude-opus-5-5[1m]`). A value starting with `-` can never pass.
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,63}$/;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nonBlank = (s: string) => s.trim().length > 0;

const runInputSchema = z.object({
  prompt: z.string().max(MAX_PROMPT_CHARS).refine(nonBlank),
  systemPrompt: z.string().max(MAX_SYSTEM_PROMPT_CHARS).refine(nonBlank),
  permissions: z.array(z.enum(OWNER_AGENT_PERMISSIONS)),
  resumeSessionId: z.string().regex(SESSION_ID).optional(),
  model: z.string().regex(MODEL),
  maxTurns: z.number().int().min(1).max(MAX_TURNS_CEILING),
  timeoutMs: z.number().int().min(1).max(MAX_TIMEOUT_MS),
});

export interface OwnerAgentPaths {
  /** HOME for the CLI, exactly as run-role.sh derives it: the repo's parent. */
  hostDir: string;
  settingsFile: string;
  tokenFile: string;
  mcpEntry: string;
  envFile: string;
  cwd: string;
}

export function ownerAgentPaths(repoDir: string): OwnerAgentPaths {
  return {
    hostDir: path.dirname(repoDir),
    settingsFile: path.join(repoDir, '.claude/fleet/settings/owner-agent.settings.json'),
    tokenFile: path.join(repoDir, '.claude/fleet/.token.env'),
    mcpEntry: path.join(repoDir, 'dist/owner-agent-mcp.cjs'),
    envFile: path.join(repoDir, '.env.local'),
    cwd: path.join(repoDir, '.fleet-logs/owner-agent/cwd'),
  };
}

// The value of CLAUDE_CODE_OAUTH_TOKEN as `. .token.env` would leave it: the
// last assignment wins, `export ` and one pair of matching quotes are allowed,
// blank lines and comments are skipped. Anything that is not a plain token
// shape counts as no token.
export function parseTokenEnv(contents: string): string | null {
  let token: string | null = null;
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?CLAUDE_CODE_OAUTH_TOKEN=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[1].trim();
    const quote = value[0];
    if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    token = /^[\w.~+/=-]+$/.test(value) ? value : null;
  }
  return token;
}

async function loadOauthToken(tokenFile: string): Promise<string> {
  let contents: string;
  try {
    // Read at run time, every run: a token the owner rotated with
    // `claude setup-token` is picked up without a restart.
    contents = await readFile(tokenFile, 'utf8');
  } catch {
    throw new OwnerAgentRunError('token_unavailable');
  }
  const token = parseTokenEnv(contents);
  if (!token) throw new OwnerAgentRunError('token_unavailable');
  return token;
}

// HOME and PATH exactly as run-role.sh pins them; NODE_ENV and TZ as the
// kalfa-fleet pm2 entry declares them (ecosystem.config.cjs), so the CLI sees
// what it sees in a fleet run; then the token and the CLAUDE.md switch.
// Deviation 4: nothing else, and nothing inherited from process.env.
export function buildCliEnv(hostDir: string, token: string): NodeJS.ProcessEnv {
  return {
    HOME: hostDir,
    PATH: `${hostDir}/.supabase/bin:${hostDir}/.local/bin:/usr/local/bin:/usr/bin:/bin`,
    NODE_ENV: 'production',
    TZ: 'Asia/Jerusalem',
    CLAUDE_CODE_OAUTH_TOKEN: token,
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  };
}

// The one MCP server this session may use, as the inline JSON --mcp-config
// accepts ("Load MCP servers from JSON files or strings"). Every field is in
// the 2.1.281 stdio server schema (type, command, args, env, alwaysLoad).
export function buildMcpConfig(options: {
  nodePath: string;
  envFile: string;
  mcpEntry: string;
  permissions: readonly string[];
}): string {
  return JSON.stringify({
    mcpServers: {
      [OWNER_AGENT_MCP_SERVER]: {
        type: 'stdio',
        // The absolute path of the node running this process, not `node`
        // looked up on whatever PATH the CLI hands its children.
        command: options.nodePath,
        args: [`--env-file=${options.envFile}`, options.mcpEntry],
        env: {
          [OWNER_AGENT_PERMISSIONS_ENV]: options.permissions.join(','),
          // Plan §3.6: @mastra/core reports usage to PostHog unless this is set.
          MASTRA_TELEMETRY_DISABLED: 'true',
        },
        // "All tools from this server are always included in the prompt and
        // never deferred behind tool search" (2.1.281 schema). With every
        // built-in off there is no ToolSearch to un-defer them with.
        alwaysLoad: true,
      },
    },
  });
}

export function buildOwnerAgentArgs(options: {
  settingsFile: string;
  mcpConfig: string;
  allowedTools: readonly string[];
  systemPrompt: string;
  model: string;
  maxTurns: number;
  resumeSessionId?: string;
}): string[] {
  const args = [
    '-p',
    '--permission-mode',
    'dontAsk',
    '--setting-sources',
    'project',
    '--settings',
    options.settingsFile,
    '--strict-mcp-config',
    '--mcp-config',
    options.mcpConfig,
    '--tools',
    '',
  ];
  // Omitted, not passed empty, when nothing is permitted: an empty value of a
  // variadic option is not something the CLI documents.
  if (options.allowedTools.length > 0) {
    args.push('--allowedTools', options.allowedTools.join(','));
  }
  args.push(
    '--system-prompt',
    options.systemPrompt,
    '--model',
    options.model,
    // Hidden from --help but defined in 2.1.281: "Maximum number of agentic
    // turns in non-interactive mode … (only works with --print)".
    '--max-turns',
    String(options.maxTurns),
    '--output-format',
    'stream-json',
    '--verbose',
  );
  if (options.resumeSessionId) args.push('--resume', options.resumeSessionId);
  return args;
}

// --- the trace ------------------------------------------------------------------

// Only the fields read here, from the 2.1.281 SDK message schemas embedded in
// the CLI. Unknown keys are stripped; a line that matches none is skipped.
const initLine = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  mcp_servers: z.array(z.object({ name: z.string(), status: z.string() })),
});
const assistantLine = z.object({
  type: z.literal('assistant'),
  message: z.object({ content: z.array(z.unknown()) }),
});
const toolUseBlock = z.object({ type: z.literal('tool_use'), name: z.string() });
const resultLine = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  num_turns: z.number().int().nonnegative(),
  session_id: z.string(),
  total_cost_usd: z.number().optional(),
});

export type ParsedTrace =
  | { ok: true; text: string; costUsd: number | null; sessionId: string; toolNames: string[]; turns: number }
  | { ok: false; code: OwnerAgentRunErrorCode };

export function parseStreamJson(stdout: string): ParsedTrace {
  let init: z.infer<typeof initLine> | undefined;
  let result: z.infer<typeof resultLine> | undefined;
  const toolNames: string[] = [];

  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const asInit = initLine.safeParse(message);
    if (asInit.success) {
      init ??= asInit.data;
      continue;
    }
    const asAssistant = assistantLine.safeParse(message);
    if (asAssistant.success) {
      for (const block of asAssistant.data.message.content) {
        const toolUse = toolUseBlock.safeParse(block);
        if (!toolUse.success) continue;
        const id = toolIdFromMcpName(toolUse.data.name);
        if (!toolNames.includes(id)) toolNames.push(id);
      }
      continue;
    }
    const asResult = resultLine.safeParse(message);
    if (asResult.success) result = asResult.data;
  }

  if (!init || !result) return { ok: false, code: 'unparsable_output' };
  // An answer given without our server is an answer given without data. The
  // status set is the CLI's own: connected | failed | needs-auth | pending |
  // disabled.
  const server = init.mcp_servers.find((s) => s.name === OWNER_AGENT_MCP_SERVER);
  if (server?.status !== 'connected') return { ok: false, code: 'mcp_unavailable' };
  if (result.subtype === 'error_max_turns') return { ok: false, code: 'max_turns' };
  // `is_error` is checked even on subtype 'success': an authentication or API
  // failure arrives that way, with the failure text in `result` — text that
  // must never be sent to the owner as if it were an answer.
  if (result.subtype !== 'success' || result.is_error || result.result === undefined) {
    return { ok: false, code: 'model_error' };
  }
  return {
    ok: true,
    text: result.result,
    costUsd: result.total_cost_usd ?? null,
    sessionId: result.session_id,
    toolNames,
    turns: result.num_turns,
  };
}

// --- the run --------------------------------------------------------------------

export interface OwnerAgentRunnerDeps {
  /** The repository root. Default: process.cwd(), as for dist/worker.cjs. */
  repoDir?: string;
  exec?: OwnerAgentExec;
  /** The node that runs the MCP server. Default: the one running this code. */
  nodePath?: string;
  killAfterMs?: number;
}

export async function runOwnerAgent(
  input: OwnerAgentRunInput,
  deps: OwnerAgentRunnerDeps = {},
): Promise<OwnerAgentRunResult> {
  const parsed = runInputSchema.safeParse(input);
  if (!parsed.success) throw new OwnerAgentRunError('invalid_input');
  const run = parsed.data;

  const paths = ownerAgentPaths(deps.repoDir ?? process.cwd());

  // run-role.sh's preflight, for the same reason: a mis-wired runner is its
  // own failure, not a model failure. The CLI would silently IGNORE a
  // settings file it cannot load in print mode (its --help says so for one
  // that fails validation), so a missing file is refused here.
  try {
    await Promise.all([access(paths.settingsFile), access(paths.mcpEntry)]);
    await mkdir(paths.cwd, { recursive: true });
  } catch {
    throw new OwnerAgentRunError('runner_misconfigured');
  }
  const token = await loadOauthToken(paths.tokenFile);

  const permissions = [...new Set(run.permissions)].sort();
  // The same filter the server applies, so the permission layer names exactly
  // the tools the server will register this run.
  const allowedTools = Object.keys(toolsForPermissions(new Set(permissions))).sort().map(mcpToolName);

  const outcome = await (deps.exec ?? nodeExec)({
    file: 'claude',
    args: buildOwnerAgentArgs({
      settingsFile: paths.settingsFile,
      mcpConfig: buildMcpConfig({
        nodePath: deps.nodePath ?? process.execPath,
        envFile: paths.envFile,
        mcpEntry: paths.mcpEntry,
        permissions,
      }),
      allowedTools,
      systemPrompt: run.systemPrompt,
      model: run.model,
      maxTurns: run.maxTurns,
      resumeSessionId: run.resumeSessionId,
    }),
    cwd: paths.cwd,
    env: buildCliEnv(paths.hostDir, token),
    input: run.prompt,
    timeoutMs: run.timeoutMs,
    killAfterMs: deps.killAfterMs ?? KILL_AFTER_MS,
    maxBuffer: MAX_BUFFER,
  });

  if (!outcome.ok) {
    switch (outcome.failure) {
      case 'timeout':
        throw new OwnerAgentRunError('timeout');
      case 'not_found':
        throw new OwnerAgentRunError('cli_not_found');
      case 'too_large':
        throw new OwnerAgentRunError('output_too_large');
      case 'spawn':
        throw new OwnerAgentRunError('cli_failed');
      case 'exit': {
        // The CLI writes its result record before a non-zero exit, so the
        // specific reason (max turns, a model error) is read first.
        const trace = parseStreamJson(outcome.stdout);
        throw new OwnerAgentRunError(
          trace.ok || trace.code === 'unparsable_output' ? 'cli_failed' : trace.code,
        );
      }
    }
  }

  const trace = parseStreamJson(outcome.stdout);
  if (!trace.ok) throw new OwnerAgentRunError(trace.code);
  return {
    // The output filter (plan §3.5): nothing phone-shaped leaves the runner.
    text: redactPhoneNumbers(trace.text),
    costUsd: trace.costUsd,
    sessionId: trace.sessionId,
    toolNames: trace.toolNames,
    turns: trace.turns,
  };
}
