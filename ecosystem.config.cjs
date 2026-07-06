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
  ],
};
