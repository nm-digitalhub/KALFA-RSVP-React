#!/usr/bin/env node
// kalfa-fleet scheduler — the pm2-hosted replacement for cron (crontab is
// blocked for this OS user by Plesk hardening; pm2 already survives reboots
// here, same as kalfa-beta / kalfa-worker).
//
// Every 60s: reload fleet.json, and for each enabled role whose schedule
// matches the current Asia/Jerusalem day+HH:MM, spawn bin/run-role.sh <role>
// (detached). run-role.sh holds the single global flock, so concurrent slots
// serialize there — this process only decides WHEN, never runs work itself.
//
// Safety here: KILLSWITCH file stops all spawns; per-slot dedup markers stop
// double-fires; a daily spawn cap bounds runaway config errors; dry_run mode
// logs what would run without spawning anything.
//
// Zero dependencies on purpose — must never break with repo installs.

import { execFile, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FLEET_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_DIR = dirname(dirname(FLEET_DIR));
const LOGS_DIR = join(REPO_DIR, '.fleet-logs');
const LOCKS_DIR = join(LOGS_DIR, 'locks');
const RUNS_DIR = join(LOGS_DIR, 'runs');
const KILLSWITCH = join(FLEET_DIR, 'KILLSWITCH');
const CONFIG = join(FLEET_DIR, 'fleet.json');
const INDEX = join(RUNS_DIR, 'index.ndjson');

const WEEKDAY_NUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

let lastKillswitchState = null;

function log(msg) {
  console.log(`[fleet-scheduler] ${new Date().toISOString()} ${msg}`);
}

function indexLine(obj) {
  try {
    mkdirSync(RUNS_DIR, { recursive: true });
    appendFileSync(INDEX, JSON.stringify(obj) + '\n');
  } catch (e) {
    log(`index write failed: ${e.message}`);
  }
}

function readConfig() {
  return JSON.parse(readFileSync(CONFIG, 'utf8'));
}

// Current wall-clock in the configured timezone as {day 0-6, hhmm 'HH:MM', dateKey 'YYYYMMDD'}.
function nowIn(timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: WEEKDAY_NUM[get('weekday')],
    hhmm: `${get('hour')}:${get('minute')}`,
    dateKey: `${get('year')}${get('month')}${get('day')}`,
  };
}

// Schedule "days" forms: "*" | "0-4" | "0,2,4" | "3" (0=Sunday, Israel work week Sun-Thu = "0-4").
function dayMatches(daysSpec, day) {
  if (daysSpec === '*') return true;
  return daysSpec.split(',').some((part) => {
    const range = part.split('-');
    if (range.length === 2) return day >= Number(range[0]) && day <= Number(range[1]);
    return Number(part) === day;
  });
}

function dailyCount(dateKey) {
  const file = join(LOCKS_DIR, `count-${dateKey}`);
  if (!existsSync(file)) return 0;
  return Number(readFileSync(file, 'utf8').trim()) || 0;
}

function bumpDailyCount(dateKey) {
  const file = join(LOCKS_DIR, `count-${dateKey}`);
  writeFileSync(file, String(dailyCount(dateKey) + 1));
}

function tick() {
  let config;
  try {
    config = readConfig();
  } catch (e) {
    log(`fleet.json unreadable — skipping tick: ${e.message}`);
    return;
  }

  const killed = existsSync(KILLSWITCH);
  if (killed !== lastKillswitchState) {
    log(killed ? 'KILLSWITCH present — all fleet spawns disabled' : 'KILLSWITCH cleared — fleet active');
    lastKillswitchState = killed;
  }
  if (killed) return;

  const now = nowIn(config.timezone || 'Asia/Jerusalem');
  mkdirSync(LOCKS_DIR, { recursive: true });

  for (const [role, rc] of Object.entries(config.roles || {})) {
    if (!rc.enabled) continue;
    for (const slot of rc.schedule || []) {
      if (slot.time !== now.hhmm || !dayMatches(slot.days ?? '*', now.day)) continue;

      // Per-slot dedup: one spawn per role per calendar slot, ever.
      const marker = join(LOCKS_DIR, `slot-${role}-${now.dateKey}-${now.hhmm.replace(':', '')}`);
      if (existsSync(marker)) continue;

      const cap = config.daily_run_cap ?? 14;
      if (dailyCount(now.dateKey) >= cap) {
        log(`daily cap ${cap} reached — skipping ${role}`);
        indexLine({ ts: new Date().toISOString(), role, skipped: 'daily_cap' });
        writeFileSync(marker, 'capped');
        continue;
      }

      writeFileSync(marker, 'spawned');
      bumpDailyCount(now.dateKey);

      if (config.dry_run) {
        log(`DRY-RUN: would spawn ${role} (tier ${rc.tier}, model ${rc.model})`);
        indexLine({ ts: new Date().toISOString(), role, dry_run: true });
        continue;
      }

      log(`spawning ${role}`);
      const out = openSync(join(LOCKS_DIR, `spawn-${role}.log`), 'a');
      const child = spawn(join(FLEET_DIR, 'bin', 'run-role.sh'), [role], {
        cwd: REPO_DIR,
        detached: true,
        stdio: ['ignore', out, out],
      });
      child.unref();
    }
  }
}

// --- answer-watcher ---------------------------------------------------------
// The autonomy piece that closes the owner->agent loop WITHOUT anyone telling
// the agent "I answered": every tick, scan for answered-but-unconsumed
// verdicts. auto_ack roles get an immediate CLI ack (which also posts the
// threaded "הסוכן קלט" Slack reply); scheduled roles get their headless run
// spawned so the role can act on the verdict, not just mark it consumed.

const inFlightAcks = new Set();
const CLI = join(REPO_DIR, 'dist', 'fleet-agent-cli.cjs');

// --- inquiry-watcher (reactive support-drafter) -----------------------------
// Event-ish triggering: instead of waiting for the 09:30/15:30 slots, spawn
// support-drafter within one tick (~60s) of a new inquiry landing. Gated on the
// role being enabled AND opted-in (`reactive:true` in fleet.json). Bounded by:
//   - a cheap read-only count (only spawns when there IS undrafted work),
//   - a cooldown marker (no re-spawn while a run is likely still in flight —
//     run-role.sh's `flock -n` already makes a concurrent spawn a cheap
//     lock-skip, but the cooldown avoids burning the daily cap on those),
//   - the shared daily_run_cap.
// The scheduled slots stay as a fallback that catches anything this misses.
const REACTIVE_ROLE = 'support-drafter';
const REACTIVE_COOLDOWN_MS = 4 * 60_000;

function runCli(args) {
  return new Promise((resolve) => {
    execFile(
      'node',
      ['--env-file=.env.local', CLI, ...args],
      { cwd: REPO_DIR, timeout: 60_000 },
      (err, stdout) => resolve({ err, stdout: stdout ?? '' }),
    );
  });
}

async function answerWatcherTick(config) {
  if (!config.answer_watcher?.enabled) return;
  if (!existsSync(CLI)) {
    log('answer-watcher: dist/fleet-agent-cli.cjs missing — run `npm run fleet:agent` once to build it');
    return;
  }

  const { err, stdout } = await runCli(['verdicts']);
  if (err) {
    log(`answer-watcher: verdicts scan failed: ${err.message}`);
    return;
  }

  let verdicts;
  try {
    verdicts = JSON.parse(stdout).verdicts ?? [];
  } catch {
    log('answer-watcher: unparsable verdicts output');
    return;
  }

  for (const v of verdicts) {
    const rc = config.roles?.[v.role];
    if (!rc || !rc.enabled) continue;

    if (rc.auto_ack) {
      if (inFlightAcks.has(v.id)) continue;
      inFlightAcks.add(v.id);
      const { err: ackErr } = await runCli(['ack', '--id', v.id]);
      inFlightAcks.delete(v.id);
      // The ack is a server-side CAS — a lost race just returns claimed:false.
      log(
        ackErr
          ? `answer-watcher: ack ${v.id} (${v.role}) not claimed`
          : `answer-watcher: auto-acked "${v.title}" (${v.role})`,
      );
      indexLine({ ts: new Date().toISOString(), role: v.role, auto_ack: v.id, ok: !ackErr });
      continue;
    }

    // Non-auto-ack role: spawn its run so it can ACT on the verdict. One spawn
    // per request id ever (marker file) — the run itself acks after acting.
    const marker = join(LOCKS_DIR, `verdict-${v.id}`);
    if (existsSync(marker)) continue;
    writeFileSync(marker, 'spawned');
    log(`answer-watcher: spawning ${v.role} to consume "${v.title}"`);
    const out = openSync(join(LOCKS_DIR, `spawn-${v.role}.log`), 'a');
    const child = spawn(join(FLEET_DIR, 'bin', 'run-role.sh'), [v.role], {
      cwd: REPO_DIR,
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();
  }
}

async function inquiryWatcherTick(config) {
  const rc = config.roles?.[REACTIVE_ROLE];
  if (!rc || !rc.enabled || !rc.reactive) return;
  if (!existsSync(CLI)) return; // same guard as answer-watcher

  // Cheap read-only signal: is there any new, not-yet-drafted inquiry?
  const { err, stdout } = await runCli([
    'sql',
    '--query',
    "select count(*)::int as n from contact_messages where status = 'new' and draft_reply is null",
  ]);
  if (err) {
    log(`inquiry-watcher: count failed: ${err.message}`);
    return;
  }
  let pending = 0;
  try {
    pending = JSON.parse(stdout).rows?.[0]?.n ?? 0;
  } catch {
    log('inquiry-watcher: unparsable count output');
    return;
  }
  if (pending <= 0) return; // nothing to draft — the common, quiet case

  // Cooldown: don't re-spawn while a run is likely still in flight. A run
  // writes draft_reply, which drops those rows out of the count above — so once
  // a run finishes, `pending` naturally returns to 0 and this goes quiet again.
  const marker = join(LOCKS_DIR, `reactive-${REACTIVE_ROLE}`);
  if (existsSync(marker)) {
    const last = Number(readFileSync(marker, 'utf8').trim()) || 0;
    if (Date.now() - last < REACTIVE_COOLDOWN_MS) return;
  }

  const now = nowIn(config.timezone || 'Asia/Jerusalem');
  const cap = config.daily_run_cap ?? 14;
  if (dailyCount(now.dateKey) >= cap) {
    log(`inquiry-watcher: daily cap ${cap} reached — not spawning (${pending} pending)`);
    return;
  }

  mkdirSync(LOCKS_DIR, { recursive: true });
  writeFileSync(marker, String(Date.now()));
  bumpDailyCount(now.dateKey);
  log(`inquiry-watcher: ${pending} new undrafted inquiry(ies) — spawning ${REACTIVE_ROLE}`);
  indexLine({ ts: new Date().toISOString(), role: REACTIVE_ROLE, reactive: true, pending });
  const out = openSync(join(LOCKS_DIR, `spawn-${REACTIVE_ROLE}.log`), 'a');
  const child = spawn(join(FLEET_DIR, 'bin', 'run-role.sh'), [REACTIVE_ROLE], {
    cwd: REPO_DIR,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
}

function fullTick() {
  tick();
  let config;
  try {
    config = readConfig();
  } catch {
    return;
  }
  if (existsSync(KILLSWITCH) || config.dry_run) return;
  answerWatcherTick(config).catch((e) => log(`answer-watcher: ${e.message}`));
  inquiryWatcherTick(config).catch((e) => log(`inquiry-watcher: ${e.message}`));
}

log(`starting — repo ${REPO_DIR}`);
fullTick();
setInterval(fullTick, 60_000);
