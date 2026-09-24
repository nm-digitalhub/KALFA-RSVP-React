// PM2 definition of ONE process: kalfa-owner-agent, the owner WhatsApp agent's
// reply consumer (plans/owner-whatsapp-agent-plan.md §6, §8 stages 6b and 8).
//
// ⚠️ ITS OWN FILE, NOT AN ENTRY IN ecosystem.config.cjs — review 2026-09-24.
// Two generic paths start ecosystem.config.cjs with no --only: that file's own
// one-time clean-restart recipe, and the relocation wizard's step I7
// (src/lib/relocation/install-steps.ts). Either would have started this
// consumer too, and a started consumer answers WhatsApp at once whenever a
// number is chosen and the switch is on. Its first start is a go-live decision,
// so it is kept out of every generic start rather than guarded by an --only
// list that the next generic command would have to remember.
// src/lib/owner-agent/consumer/budgets.test.ts asserts both halves: this file
// defines exactly kalfa-owner-agent, and ecosystem.config.cjs does not.
//
// What it runs: works QUEUES.ownerAgentReply one job at a time, answering
// through `claude -p` (src/lib/owner-agent/runner.ts), plus its intake sweep
// and daily retention. Its own process, not kalfa-worker: a model run of up to
// two minutes must not sit in the process that drives billing. It does not
// use the fleet's global flock either.
//
// Modelled on kalfa-ops-agent (node --env-file) and kalfa-worker
// (kill_timeout). .env.local is loaded by Node before any module runs; the
// runner builds the `claude` child's environment itself (HOME, PATH, the token
// from .claude/fleet/.token.env) and never hands it this one.
//
// kill_timeout is the last link of a budget chain pinned by
// src/lib/owner-agent/consumer/budgets.test.ts: one answer (≤255s) < job
// expiry (300s) < the graceful stop (310s) < this (330s), so a restart lets an
// answer in flight finish instead of paying for it twice. ⚠️ `pm2 restart`
// keeps the kill_timeout it stored at the first start; a changed value needs
// `pm2 delete kalfa-owner-agent` + a fresh `pm2 start` of this file.
//
// MASTRA_TELEMETRY_DISABLED: @mastra/core reports usage to PostHog unless it
// is set (plan §3.6). A plain `pm2 restart` keeps the env captured at the last
// clean start (ecosystem.config.cjs header), so a change here needs the clean
// start below.
//
// FIRST START (and any clean restart) — by hand, from a scrubbed shell, with
// the agent switch OFF; never by `npm run deploy`:
//   env -i HOME="$HOME" USER="$USER" PATH=/usr/local/bin:/usr/bin:/bin \
//     pm2 start ecosystem.owner-agent.config.cjs
//   pm2 save
// After that, scripts/owner-agent-build-restart.mjs restarts it by name on
// deploy when its bundle changed or it is not online.
module.exports = {
  apps: [
    {
      name: 'kalfa-owner-agent',
      cwd: '/var/www/vhosts/kalfa.me/beta',
      script: 'dist/owner-agent.cjs',
      node_args: '--env-file=.env.local',
      autorestart: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      kill_timeout: 330000,
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Jerusalem',
        MASTRA_TELEMETRY_DISABLED: 'true',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      },
    },
  ],
};
