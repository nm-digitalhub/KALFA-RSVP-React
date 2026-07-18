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
module.exports = {
  apps: [
    {
      name: 'kalfa-beta',
      cwd: '/var/www/vhosts/kalfa.me/beta',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3002',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'kalfa-worker',
      cwd: '/var/www/vhosts/kalfa.me/beta',
      script: 'dist/worker.cjs',
      env: { NODE_ENV: 'production' },
    },
    // pg-boss ops dashboard (https://beta.kalfa.me:8444 via nginx → 127.0.0.1:3010).
    // Secrets/bind config live in .env.pgboss-dashboard (600, not committed),
    // injected via --env-file — HOST=127.0.0.1 there is mandatory (the CLI
    // defaults to 0.0.0.0 and the host has no local firewall).
    // NOTE: superseded by kalfa-pgboss-ui (below) + the /admin/jobs proxy; kept
    // temporarily for rollback and decommissioned once the proxy is verified.
    {
      name: 'kalfa-pgboss-dashboard',
      script: './node_modules/@pg-boss/dashboard/bin/cli.js',
      cwd: '/var/www/vhosts/kalfa.me/beta',
      node_args: '--env-file=/var/www/vhosts/kalfa.me/beta/.env.pgboss-dashboard',
      time: true,
      autorestart: true,
      env: { NODE_ENV: 'production' },
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
      env: { NODE_ENV: 'production' },
    },
  ],
};
