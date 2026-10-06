// Owner CLI for remote-desktop access requests. Run on the server as the owner:
//   npm run rdp:access -- watch
//   npm run rdp:access -- list | show <id> | approve <id> | deny <id> | revoke | status
// Runs with the service role (env from .env.local through `node --env-file`, same as the other scripts), so it is
// an owner-only tool: whoever can run it on the server can decide requests. Every decision is recorded with
// attribution hints and mirrored to the security channel (see src/lib/rdp-access/cli/commands.ts).
//
// ESM bundle: commander and ink are ESM-only.

import { hostname, userInfo } from 'node:os';
import { createInterface } from 'node:readline/promises';

import { createAdminClient } from '@/lib/supabase/admin';
import { defaultCliApi, EXIT, type CliContext, type ExitCode } from '@/lib/rdp-access/cli/commands';
import { buildProgram } from '@/lib/rdp-access/cli/program';
import { runWatch } from '@/lib/rdp-access/cli/watch-app';

async function ask(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

function makeContext(): CliContext {
  return {
    admin: createAdminClient(),
    now: () => new Date(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    confirm: ask,
    env: process.env,
    host: {
      osUser: userInfo().username,
      hostname: hostname(),
      pid: process.pid,
      isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    },
    api: defaultCliApi,
  };
}

let exitCode: ExitCode = EXIT.ok;

const program = buildProgram({
  makeContext,
  watch: runWatch,
  setExitCode: (code) => {
    exitCode = code;
  },
});

try {
  await program.parseAsync(process.argv);
  process.exitCode = exitCode;
} catch (error) {
  // Service and query errors carry an operation name only, never a provider message or a secret.
  console.error(error instanceof Error ? error.message : 'unexpected error');
  process.exitCode = EXIT.error;
}
