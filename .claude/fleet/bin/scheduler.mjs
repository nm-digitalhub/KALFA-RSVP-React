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

// --- inquiry-watcher (reactive roles) ---------------------------------------
// Event-ish triggering: instead of waiting for a scheduled slot, spawn a role
// within one tick (~60s) of work landing for it. Each role opts in by naming a
// TRIGGER in fleet.json:
//
//   "support-drafter": { "reactive": "contact_messages_new" }
//
// Bounded per role by:
//   - a cheap read-only count (only spawns when there IS work),
//   - a cooldown marker (no re-spawn while a run is likely still in flight —
//     run-role.sh's `flock -n` already makes a concurrent spawn a cheap
//     lock-skip, but the cooldown avoids burning the daily cap on those),
//   - the shared daily_run_cap.
// Scheduled slots stay as a fallback that catches anything this misses.
//
// The SQL lives HERE, in code, and fleet.json only SELECTS from this catalog.
// Putting queries in the config would turn an edited-by-hand file into one that
// runs SQL against production — the CLI's read-only wrapper bounds the damage,
// but the decision would have moved out of reviewed code, which is the part
// that matters.
//
// Adding a trigger is a code change; WIRING a role to an existing one is a
// one-line config change. That asymmetry is deliberate.
const TRIGGERS = {
  contact_messages_new: {
    query:
      "select count(*)::int as n from contact_messages where status = 'new' and draft_reply is null",
    // A run writes draft_reply, which drops those rows out of this count — so
    // once a run finishes the count returns to 0 on its own and this goes quiet.
    describe: (n) => `${n} new undrafted inquiry(ies)`,
  },
  callback_requests_pending: {
    query:
      "select count(*)::int as n from callback_requests where triage_status = 'pending' and status in ('new','in_progress')",
    // A run claims and finishes rows, which moves them out of 'pending' — so the
    // count falls to 0 on its own and this goes quiet. The scheduler's 15-minute
    // grace period means a request left un-triaged is still scheduled, just
    // without constraints; this trigger is what makes that the rare case.
    describe: (n) => `${n} callback request(s) awaiting triage`,
  },
  webhook_inbox_errors: {
    query:
      'select count(*)::int as n from webhook_inbox where last_error is not null and processed_at is null',
    describe: (n) => `${n} unprocessed webhook(s) with errors`,
  },
  // The owner opening a conversation from /admin/fleet. Unlike every other
  // trigger this one is PER-ROLE: `{{role}}` is substituted below, because a
  // global count would spawn every reactive role for a request addressed to
  // one of them. payload.origin='owner' is what separates an owner-initiated
  // ask from an agent-filed one — without it a role would be spawned to answer
  // its own question. The row leaves this count the moment the role acts on it
  // (ack -> consumed, or complete -> completed), so it goes quiet on its own.
  owner_direct_request: {
    query:
      "select count(*)::int as n from fleet_requests where role = '{{role}}' and status = 'pending' and payload->>'origin' = 'owner'",
    describe: (n) => `${n} direct request(s) from the owner`,
  },
  // A persistent, self-scheduling goal (plan: fleet_goals, §3.1). Per-role
  // like owner_direct_request, and for the same reason — a global count would
  // spawn every goal_due-reactive role for a goal belonging to one of them.
  // The row leaves this count the moment the agent moves next_wake_at forward
  // (goal-progress) or closes it (goal-close), so it goes quiet on its own.
  goal_due: {
    query:
      "select count(*)::int as n from fleet_goals where role = '{{role}}' and status = 'active' and next_wake_at <= now()",
    describe: (n) => `${n} goal(s) due`,
  },
};

// Trigger queries may carry `{{role}}`. Substitution is a plain replace, so the
// role name is validated first: it comes from fleet.json (owner-controlled),
// but a config typo must not become a SQL fragment. Fleet role names are
// lowercase-and-dashes by convention; anything else is refused loudly.
const ROLE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

function resolveTriggerQuery(query, role) {
  if (!query.includes('{{role}}')) return query;
  if (!ROLE_NAME_RE.test(role)) {
    throw new Error(`role name "${role}" is not safe to interpolate into a trigger query`);
  }
  return query.replaceAll('{{role}}', role);
}

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
  const now = nowIn(config.timezone || 'Asia/Jerusalem');
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

    // The daily cap applies HERE too. It used to be checked only in the
    // scheduled and inquiry paths, which left this one — the busiest, since
    // every owner answer to every role passes through it — able to spawn
    // without bound. The cap exists to bound runaway config errors; a path
    // that ignores it is a hole in exactly the case the cap was written for.
    //
    // Checked BEFORE the marker is written, deliberately: the marker means
    // "this verdict has been spawned, never again". Writing it and then
    // declining to spawn would strand the verdict permanently. Leaving it
    // unwritten means the next tick (or tomorrow, once the count rolls over)
    // picks the same verdict up again.
    const cap = config.daily_run_cap ?? 14;
    if (dailyCount(now.dateKey) >= cap) {
      log(`answer-watcher: daily cap ${cap} reached — deferring "${v.title}" (${v.role})`);
      break;
    }

    writeFileSync(marker, 'spawned');
    log(`answer-watcher: spawning ${v.role} to consume "${v.title}"`);
    bumpDailyCount(now.dateKey);
    const out = openSync(join(LOCKS_DIR, `spawn-${v.role}.log`), 'a');
    const child = spawn(join(FLEET_DIR, 'bin', 'run-role.sh'), [v.role], {
      cwd: REPO_DIR,
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();
  }
}

/** Every enabled role paired with ALL of its named triggers (a role may name
 * more than one — e.g. callback-triage answers callback_requests_pending AND
 * advances a persistent goal via goal_due). fleet.json may write either a
 * bare string (one trigger) or an array (several); both are accepted here so
 * a one-trigger role's config stays as simple as it was before this existed. */
function reactiveRoles(config) {
  const out = [];
  for (const [role, rc] of Object.entries(config.roles ?? {})) {
    if (!rc?.enabled || !rc.reactive) continue;

    // `reactive: true` was the shape before triggers were named, when the role
    // was hardcoded here. Refused rather than guessed at, same as before:
    // silently mapping it to a trigger would mean this file decides which
    // table a role watches, which is the coupling the catalog exists to
    // remove. Loud and harmless — the role keeps its scheduled slots and
    // loses only the reactive path.
    let names;
    if (typeof rc.reactive === 'string') {
      names = [rc.reactive];
    } else if (Array.isArray(rc.reactive) && rc.reactive.every((n) => typeof n === 'string')) {
      names = rc.reactive;
    } else {
      log(
        `inquiry-watcher: ${role} has reactive:${JSON.stringify(rc.reactive)} — expected a trigger name or an array of names (${Object.keys(TRIGGERS).join(' | ')}); reactive spawning is OFF for it until fleet.json names one`,
      );
      continue;
    }

    const triggers = [];
    for (const name of names) {
      const trigger = TRIGGERS[name];
      if (!trigger) {
        log(`inquiry-watcher: ${role} names unknown trigger "${name}" — ignored`);
        continue;
      }
      triggers.push({ name, trigger });
    }
    if (triggers.length === 0) continue;
    out.push({ role, triggers });
  }
  return out;
}

async function inquiryWatcherTick(config) {
  if (!existsSync(CLI)) return; // same guard as answer-watcher

  const now = nowIn(config.timezone || 'Asia/Jerusalem');
  const cap = config.daily_run_cap ?? 14;

  for (const { role, triggers } of reactiveRoles(config)) {
    // Re-read per role: an earlier role in this same loop may have spawned.
    if (dailyCount(now.dateKey) >= cap) {
      log(`inquiry-watcher: daily cap ${cap} reached — not spawning ${role}`);
      break;
    }

    // One cooldown per ROLE, not per trigger: a role just spawned reactively
    // doesn't need ANY of its triggers re-checked for the same window,
    // whichever one fired. Checked first because it is a file check, the
    // count below is a database round-trip.
    const marker = join(LOCKS_DIR, `reactive-${role}`);
    if (existsSync(marker)) {
      const last = Number(readFileSync(marker, 'utf8').trim()) || 0;
      if (Date.now() - last < REACTIVE_COOLDOWN_MS) continue;
    }

    // Check this role's triggers in order; the first one with pending work
    // spawns it and stops — at most one spawn per role per tick, even when
    // more than one of its triggers has pending work simultaneously (two
    // spawns in the same tick would both count against daily_run_cap while
    // the second only ever hits run-role.sh's lock-skip).
    for (const { name, trigger } of triggers) {
      let query;
      try {
        query = resolveTriggerQuery(trigger.query, role);
      } catch (e) {
        log(`inquiry-watcher: ${name} for ${role}: ${e.message} — skipped`);
        continue;
      }

      const { err, stdout } = await runCli(['sql', '--query', query]);
      if (err) {
        log(`inquiry-watcher: ${name} count failed: ${err.message}`);
        continue;
      }
      let pending = 0;
      try {
        pending = JSON.parse(stdout).rows?.[0]?.n ?? 0;
      } catch {
        log(`inquiry-watcher: ${name} unparsable count output`);
        continue;
      }
      if (pending <= 0) continue; // no work on this trigger — try the next

      mkdirSync(LOCKS_DIR, { recursive: true });
      writeFileSync(marker, String(Date.now()));
      bumpDailyCount(now.dateKey);
      log(`inquiry-watcher: ${trigger.describe(pending)} — spawning ${role}`);
      indexLine({ ts: new Date().toISOString(), role, reactive: name, pending });
      const out = openSync(join(LOCKS_DIR, `spawn-${role}.log`), 'a');
      const child = spawn(join(FLEET_DIR, 'bin', 'run-role.sh'), [role], {
        cwd: REPO_DIR,
        detached: true,
        stdio: ['ignore', out, out],
      });
      child.unref();
      break;
    }
  }
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
