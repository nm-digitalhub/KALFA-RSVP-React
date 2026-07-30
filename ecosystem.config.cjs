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
      env: { NODE_ENV: 'production', TZ: 'Asia/Jerusalem' },
    },
    {
      name: 'kalfa-worker',
      cwd: '/var/www/vhosts/kalfa.me/beta',
      script: 'dist/worker.cjs',
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
      time: true,
      autorestart: true,
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
      time: true,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Jerusalem',
        PATH: '/var/www/vhosts/kalfa.me/.local/bin:/var/www/vhosts/kalfa.me/.supabase/bin:/usr/local/bin:/usr/bin:/bin',
      },
    },
  ],
};
