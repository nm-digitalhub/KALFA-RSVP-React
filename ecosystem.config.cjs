// PM2 process definitions — the single, reproducible source of the production
// runtime environment.
//
// Both apps load their own configuration/secrets from `.env.local` at boot
// (`next start` natively; `worker/main.ts` has its own loadEnv), so the
// PROCESS environment stays minimal and explicit. This exists because
// `pm2 restart --update-env` used to copy the DEPLOYING shell's environment
// into production (Claude-session variables, FORCE_COLOR/NO_COLOR conflicts,
// a plugin-laden PATH — documented 2026-07-06). The deploy script therefore
// uses PLAIN `pm2 restart` (no --update-env): the env captured at the last
// clean `pm2 start` is preserved forever.
//
// One-time clean (re)start, from a scrubbed shell:
//   pm2 delete kalfa-beta kalfa-worker
//   env -i HOME="$HOME" USER="$USER" PATH=/usr/local/bin:/usr/bin:/bin \
//     pm2 start ecosystem.config.cjs
//   pm2 save
//
// TZ is declared here rather than inherited from the host (host set to
// Asia/Jerusalem on 2026-07-28). KALFA is an Israel-only product: every date the
// owner and every guest sees is Israel wall-clock, so the runtime must not
// depend on how the machine happens to be configured. Declaring it means a
// rebuilt host, a migration to another server, or a stray `timedatectl` cannot
// shift application behaviour silently.
//
// It changes almost nothing in the app itself — the server code formats through
// src/lib/date.ts and parses with an explicit `Z`, and pg-boss reads each
// schedule's own timezone column, not the process one. What it does fix is
// everything OUTSIDE that discipline: log lines, stack-trace timestamps, and any
// future code that reaches for a bare `new Date()` and assumes local means
// Israel.
//
// NOTE: a plain `pm2 restart` REUSES the env captured at the last clean start —
// exactly the property described above — so adding a variable here does NOT
// reach a running process. It requires the one-time clean restart shown above.
module.exports = {
  apps: [
    {
      name: 'kalfa-beta',
      cwd: '/var/www/vhosts/kalfa.me/beta',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3002',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      env: { NODE_ENV: 'production', TZ: 'Asia/Jerusalem' },
    },
    {
      name: 'kalfa-worker',
      cwd: '/var/www/vhosts/kalfa.me/beta',
      // Wrapper, not the bundle directly — see worker/start.mjs's header for why.
      script: 'worker/start.mjs',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      env: { NODE_ENV: 'production', TZ: 'Asia/Jerusalem' },
    },
    // pg-boss ops dashboard, base-path build (source build, base "/admin/jobs"),
    // loopback-only and WITHOUT its own auth: access is gated by requireAdmin()
    // in src/app/(admin)/admin/jobs/[[...path]]/route.ts, which reverse-proxies
    // here. This keeps the dashboard off the public internet — the only way in
    // is an authenticated KALFA admin session. Bind config in .env.pgboss-ui
    // (600, not committed): PORT=3011, HOST=127.0.0.1, PGBOSS_DASHBOARD_BASE_PATH.
    {
      name: 'kalfa-pgboss-ui',
      script: 'build/server.js',
      cwd: '/var/www/vhosts/kalfa.me/pgboss-dashboard-ui/packages/dashboard',
      node_args:
        '--env-file=/var/www/vhosts/kalfa.me/pgboss-dashboard-ui/packages/dashboard/.env.pgboss-ui',
      autorestart: true,
      // `time: true` removed 2026-07-31 — it unconditionally overwrites
      // log_date_format with a fixed 'YYYY-MM-DDTHH:mm:ss' (no ms, no offset),
      // per pm2's lib/Common.js. The explicit format below is strictly more
      // precise, so `time` was pure loss once this field existed.
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      env: { NODE_ENV: 'production', TZ: 'Asia/Jerusalem' },
    },
    // The agent-fleet scheduler: a minute-tick loop that spawns
    // .claude/fleet/bin/run-role.sh for scheduled slots, for owner answers, and
    // for reactive triggers. Added here 2026-07-28 — it had been started
    // ad-hoc, and pm2 had therefore captured the environment of the Claude Code
    // session that launched it (CLAUDECODE, CLAUDE_CODE_SESSION_ID and ~50
    // others, from a session long since ended). Harmless in itself — the script
    // reads NOTHING from process.env, verified — but it meant the fleet was the
    // one production process outside this file, so it had no declared TZ and no
    // guarantee of coming back correctly after a reboot.
    //
    // It needs no secrets of its own: run-role.sh sources .claude/fleet/.token.env
    // for the Claude token, and the CLI it calls runs under `node
    // --env-file=.env.local`. Both children fetch their own credentials, which
    // is why a scrubbed environment is safe here.
    //
    // Adopting this definition requires the one-time clean restart at the top of
    // this file (delete + start from a scrubbed shell) — a plain `pm2 restart`
    // keeps the environment pm2 already captured, which is the polluted one.
    //
    // PATH is DECLARED here, and that is not cosmetic. The scheduler spawns
    // run-role.sh, which runs `claude` — installed at
    // ~/.local/bin/claude, outside the default system path. Adopting this
    // definition on 2026-07-28 with the scrubbed-shell recipe above
    // (PATH=/usr/local/bin:/usr/bin:/bin) removed exactly that directory, and
    // every role began failing with `timeout: failed to run command 'claude':
    // No such file or directory` — silently, since a spawn that dies is not a
    // spawn that reports. It was caught only because a reactive role was
    // triggered by hand minutes later; the next scheduled run was 02:30, so the
    // whole fleet would otherwise have been mute until morning.
    //
    // ~/.supabase/bin is declared for exactly the same reason, added
    // 2026-07-29. The Tier-2 `main` role's only live-DB door is
    // `supabase db query --linked`, and the CLI installs to ~/.supabase/bin —
    // also outside the default path. Measured before this line existed:
    // `env -i PATH=<the four directories above> supabase --version` exits 127
    // (control: `jq --version` exits 0 in the same environment), so the door
    // answered "command not found" on every attempt and — like the failure
    // above — reported nothing. It needs no environment of its own: the CLI
    // authenticates from ~/.supabase/access-token, verified by running
    // `supabase projects list` under `env -i` with only PATH and HOME set.
    //
    // The lesson is the reason this file exists: an inherited environment is
    // not a dependency you can scrub without declaring what was in it.
    {
      name: 'kalfa-fleet',
      cwd: '/var/www/vhosts/kalfa.me/beta',
      script: '.claude/fleet/bin/scheduler.mjs',
      autorestart: true,
      // `time: true` removed 2026-07-31 — see kalfa-pgboss-ui's comment above.
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Jerusalem',
        // Defense-in-depth, added 2026-07-30: src/lib/url.ts:50 throws in
        // production when APP_ORIGIN is unset. scheduler.mjs itself never
        // touches it (verified — no reference in scheduler.mjs/run-role.sh),
        // and dist/fleet-agent-cli.cjs already loads its own copy via
        // `--env-file=.env.local`. This exists only so a FUTURE Bash command
        // a role runs, that reaches app code outside that one CLI process,
        // does not fail on a missing value that .env.local already answers.
        APP_ORIGIN: 'https://beta.kalfa.me',
        PATH: '/var/www/vhosts/kalfa.me/.local/bin:/var/www/vhosts/kalfa.me/.supabase/bin:/usr/local/bin:/usr/bin:/bin',
      },
    },
    // Debug Mode's read-only system-probe sidecar (ops/probe-server.mjs, NOT
    // part of the .claude/fleet/ agent system — see that file's header
    // comment). Loopback-only on :3012, gated by a bearer token
    // (OPS_AGENT_TOKEN, .env.local) and never reachable outside this machine
    // — same shape as kalfa-pgboss-ui above: an unauthenticated-by-itself
    // backend exposed to the internet only via src/app/(admin)/admin/debug/*,
    // which calls requirePlatformOwner() before ever reverse-proxying here.
    //
    // Exists as its own process specifically so kalfa-beta (the Next.js
    // server) never has to shell out — every system probe (pm2 jlist, df, du,
    // git) runs here via execFile with fixed arguments, never in the web
    // request path. PATH is declared explicitly for the same reason
    // documented at the top of this file: pm2 is in /usr/local/bin; df, du,
    // and git are in /usr/bin. Added new — start with
    // `pm2 start ecosystem.config.cjs --only kalfa-ops-agent`, which (per
    // pm2's own --only filter) starts only this entry and does not touch any
    // already-running app in this file.
    {
      name: 'kalfa-ops-agent',
      cwd: '/var/www/vhosts/kalfa.me/beta',
      script: 'ops/probe-server.mjs',
      node_args: '--env-file=.env.local',
      autorestart: true,
      // `time: true` removed 2026-07-31 — see kalfa-pgboss-ui's comment above.
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Jerusalem',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      },
    },
    // Admin-only file browser (SSH-tunnel access, see beta's filebrowser
    // notes) — previously started ad-hoc and undeclared here, so it had no
    // TZ/log_date_format and no guarantee of coming back correctly after a
    // reboot. Adopted 2026-07-31, args copied verbatim from the running
    // process (`pm2 describe kalfa-filebrowser`). Not a Node script —
    // `interpreter: 'none'` runs the binary directly, same as pm2 already
    // does for it.
    {
      name: 'kalfa-filebrowser',
      cwd: '/var/www/vhosts/kalfa.me/beta',
      script: '/usr/local/bin/filebrowser',
      args: '-r /var/www/vhosts/kalfa.me/beta -d /var/www/vhosts/kalfa.me/beta/filebrowser.db -a 127.0.0.1 -p 8082',
      interpreter: 'none',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
    },
  ],
};
