---
name: deploying-kalfa-beta
description: >
  Use when deploying the KALFA beta app to production — "deploy", "תפרוס",
  "העלה לבטא", restarting pm2 processes (kalfa-beta, kalfa-worker), or
  diagnosing a failed/stuck deploy. Do NOT use for local builds or tests only.
disable-model-invocation: true
---

# Deploying kalfa-beta

Production runs on THIS server: pm2 process `kalfa-beta` (port 3002) behind
`conf.d/beta-proxy.conf` (nginx include — NOT Plesk-managed), plus
`kalfa-worker` (pg-boss). **The deploy script IS the build** — never run
`npm run build` separately first (it fights the deploy's own build and the
shared `.next-verify` lock; a Codex session may also hold that lock — wait,
never compete).

## Current state (verify, don't assume)

!`cd /var/www/vhosts/kalfa.me/beta && git log --oneline -3 && npx pm2 ls | grep -E "kalfa|─" | head -8`

## Procedure

1. **Gates first** (all must pass; no suppressions):
   ```bash
   npm run lint && npx tsc --noEmit && npm test -- --run
   ```
2. **Deploy** (this builds + writes `.deploy-id` pre-build for version-skew
   protection + restarts pm2):
   ```bash
   npm run deploy
   ```
3. **Worker** (only if worker code / queue contracts changed):
   ```bash
   npm run worker:build && npx pm2 restart kalfa-worker
   ```
   Worker DB must stay on the session-pooler host (IPv4) — see `.env` /
   memory `worker-db-session-pooler`; direct `db.<ref>` is IPv6-only and fails.
4. **Verify live**: `npx pm2 ls` (both processes online, uptime reset);
   fetch `https://beta.kalfa.me` — and for /admin surfaces remember the proxy
   buffer sizing already fixed in `beta-proxy.conf` (502 "too big header" =
   Supabase chunked cookies; config already carries 32k/16×16k — don't shrink).
5. Report: deployed commit, processes restarted, verification result.

## Hard rules

- Deploy only from a clean, committed state the user approved.
- Never edit nginx/Plesk/system config as part of a routine deploy.
- A failed deploy = report + rollback options; don't loop restarts blindly.
