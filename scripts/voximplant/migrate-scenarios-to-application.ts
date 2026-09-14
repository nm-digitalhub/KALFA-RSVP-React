// Move every Shared-folder scenario into the kalfa-rsvp application, so that
// voxengine-ci 36 can see it — the one thing standing between us and the
// upgrade.
//
// WHY THIS IS HAND-WRITTEN. Per the standing rule, a built-in flow was looked
// for first and does not exist. MEASURED live 2026-09-14 by
// scripts/voximplant/probe-scenario-binding.ts:
//   - BindScenario(scenario, rule, application) binds but does NOT move
//     (app-scoped count unchanged; the bind itself was proved by reading the
//     rule back).
//   - BindScenario with application and no rule -> error 147, rule is mandatory.
//   - AddScenario(name, script, application) -> error 133
//     SCENARIO_NAME_ISNT_UNIQUE, with and without rewrite. Names are unique
//     ACCOUNT-WIDE, across the Shared folder and every application.
//   - voxengine-ci's own `init` performs zero platform writes, so it cannot
//     migrate either.
// The one opening is that 133 fires only because the NAME is taken, and
// SetScenarioInfo can rename. Free the name and AddScenario(application)
// succeeds — that is this script.
//
// THE SEQUENCE, per scenario, in this order and no other:
//   1. read the DEPLOYED script (migration must move code, never change it)
//   2. rename old -> "<name>-legacy"   (frees the account-wide-unique name; id
//                                       and rule bindings survive, because
//                                       rules bind by id — so the old scenario
//                                       keeps serving normally right here)
//   3. AddScenario(<name>, script, application) with NO rule -> new app-scoped id
//   4. VERIFY the new id really is application-scoped
//   5. per rule: unbind old, bind new   (back to back, one rule at a time)
//   6. verify each rule now resolves to the new id, and only to it
//   7. delete the old scenario
//
// WHY THE NEW SCENARIO IS BUILT BEFORE ANYTHING IS UNBOUND. Step 3-4 is the
// only part of this that was never measured end to end: the probe proved
// AddScenario SUCCEEDS once the name is free, but not that the result lands
// inside the application rather than back in the Shared folder. Doing it while
// the old scenario is still bound and serving means a failure there costs
// nothing — rename back and walk away, no call ever routed differently.
//
// WHY UNBIND BEFORE BIND, PER RULE (step 5). The routing reference states a
// rule "executes all the attached scenarios sequentially within a single
// context". Binding the new one while the old is still attached would make a
// call run BOTH — a live malfunction, not a harmless duplicate. Unbinding first
// instead leaves a window of one API call in which the rule resolves to NO
// scenario. For the outbound rules that is inert: they fire only when our own
// dispatcher calls StartScenarios, so not dispatching closes the window
// entirely. `incoming` (1494687) is the one rule a stranger can trigger at any
// moment.
//
// (AddScenario also accepts a ruleId, which would bind at creation — but that
// would put the new scenario on a rule the old one is still attached to, i.e.
// exactly the both-run state above. Deliberately unused.)
//
// FAILURE POLICY. There is no transaction. The old scenario is deleted only
// after step 6 has proved the new one is bound everywhere the old one was. Any
// earlier failure aborts with the old scenario still present (as "<name>-legacy")
// and prints the exact commands to put it back. Nothing is ever deleted on a
// path where verification did not pass.

import { readFileSync } from 'node:fs';

import {
  getApplications,
  getRules,
  getScenarios,
  listScenarios,
  VoximplantApiError,
  voxRetry,
  type RuleInfo,
  type ScenarioInfo,
  type VoximplantConfig,
} from '@/lib/voximplant/core';
import {
  addRule,
  addScenario,
  bindScenario,
  delRule,
  delScenario,
  setScenarioInfo,
} from '@/lib/voximplant/mutations';

const APP_NAME = 'kalfa-rsvp.kalfarsvp.voximplant.com';

// Rule 1494311 (OutCall, the DTMF RSVP flow) is excluded by default and by
// standing instruction: it requires its own owner sign-off and must never be
// swept along with the voice-agent work. Passing --include-outcall is the only
// way to reach it, and the script still names it explicitly before acting.
const OUTCALL_RULE_ID = 1494311;

// Rehearsal subject: Shared AND bound to no live rule (asserted at runtime, not
// trusted from this constant).
const REHEARSAL_SCENARIO = 'RSVPPreview';
const REHEARSAL_RULE_NAME = `zz-migrate-rehearsal-${new Date().toISOString().slice(0, 10)}`;
// Cannot match a dialed number, and AddRule appends — so it lands after the
// existing ".*" rules and is unreachable even if the pattern somehow matched.
const REHEARSAL_RULE_PATTERN = 'zzz-migrate-rehearsal-never-matches';

const LEGACY_SUFFIX = '-legacy';
// AddScenario/SetScenarioInfo reject a name of 30 chars or more (API limit,
// enforced in the wrappers too). Checked up front so a rename cannot fail
// halfway through a migration.
const NAME_LIMIT = 30;

function loadConfig(): VoximplantConfig {
  const path =
    process.env.VOXIMPLANT_CREDENTIALS_FILE ??
    process.env.VOX_CI_CREDENTIALS ??
    'vox_ci_credentials.json';
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    account_id: number | string;
    key_id: string;
    private_key: string;
  };
  return { accountId: raw.account_id, keyId: raw.key_id, privateKey: raw.private_key };
}

const names = (s: ScenarioInfo[]): string =>
  s
    .map((x) => `${x.scenario_name}(${x.scenario_id})`)
    .sort()
    .join(', ');

async function appScoped(cfg: VoximplantConfig, applicationId: number): Promise<ScenarioInfo[]> {
  const r = await voxRetry(() => listScenarios(cfg, { application_id: applicationId }));
  return r.result;
}
async function accountWide(cfg: VoximplantConfig): Promise<ScenarioInfo[]> {
  const r = await voxRetry(() => listScenarios(cfg, {}));
  return r.result;
}
async function rules(cfg: VoximplantConfig, applicationId: number): Promise<RuleInfo[]> {
  const r = await voxRetry(() => getRules(cfg, applicationId, { with_scenarios: true }));
  return r.result;
}

// voxRequest THROWS VoximplantApiError on {error:{code,msg}} — it never returns
// it as a value. Every mutating call goes through here so a rejection becomes a
// decision point instead of an unwind.
interface Outcome<T> {
  ok: boolean;
  value?: T;
  code?: number | null;
  msg?: string;
}
async function attempt<T>(label: string, fn: () => Promise<T>): Promise<Outcome<T>> {
  try {
    const value = await fn();
    console.log(`    ${label}: OK ${JSON.stringify(value)}`);
    return { ok: true, value };
  } catch (e) {
    if (e instanceof VoximplantApiError) {
      console.log(`    ${label}: REJECTED code=${e.code} msg="${e.message}"`);
      return { ok: false, code: e.code, msg: e.message };
    }
    throw e;
  }
}

// A Voximplant mutation answers {result: 1}. A {result: 0} carries no `error`
// key, so "no exception thrown" is NOT success — assert the value.
function assertResult1(label: string, o: Outcome<{ result?: number }>): void {
  if (!o.ok) throw new Error(`${label} failed: code=${o.code} msg=${o.msg}`);
  if (o.value?.result !== 1) {
    throw new Error(`${label} returned result=${o.value?.result} (expected 1) — treating as failure`);
  }
}

interface Target {
  scenarioName: string;
  scenarioId: number;
  ruleIds: number[];
  ruleNames: string[];
}

// Build the work list from the PLATFORM, never from a hardcoded table: the
// rule->scenario map is read live and is the only input that decides what moves.
function planFrom(ruleList: RuleInfo[], appScopedIds: Set<number>): Target[] {
  const byScenario = new Map<number, Target>();
  for (const rule of ruleList) {
    for (const s of rule.scenarios ?? []) {
      // Already application-scoped: nothing to migrate, and touching it would
      // only risk a working binding.
      if (appScopedIds.has(s.scenario_id)) continue;
      const existing = byScenario.get(s.scenario_id);
      if (existing) {
        existing.ruleIds.push(rule.rule_id);
        existing.ruleNames.push(rule.rule_name);
      } else {
        byScenario.set(s.scenario_id, {
          scenarioName: s.scenario_name,
          scenarioId: s.scenario_id,
          ruleIds: [rule.rule_id],
          ruleNames: [rule.rule_name],
        });
      }
    }
  }
  return [...byScenario.values()].sort((a, b) => a.scenarioName.localeCompare(b.scenarioName));
}

// The migration proper. Returns the new scenario id. Throws with a repair hint
// if anything fails; the caller does not catch — a half-done scenario must stop
// the run, not roll on to the next one.
async function migrateOne(
  cfg: VoximplantConfig,
  applicationId: number,
  target: Target,
): Promise<number> {
  const { scenarioName, scenarioId, ruleIds, ruleNames } = target;
  const legacyName = `${scenarioName}${LEGACY_SUFFIX}`;
  console.log(
    `\n  == ${scenarioName}(${scenarioId}) -> application ${applicationId}, rules ${ruleNames.join('/')} ==`,
  );

  // 1. The DEPLOYED text. A migration that also changes code is two changes
  //    wearing one commit; this passes the bytes straight back.
  const read = await voxRetry(() => getScenarios(cfg, scenarioId, { with_script: true }));
  const row = read.result.find((s) => s.scenario_id === scenarioId);
  const script = row?.scenario_script;
  if (typeof script !== 'string' || script.length === 0) {
    throw new Error(`${scenarioName}: GetScenarios returned no script body — refusing to migrate`);
  }
  console.log(`    deployed script: ${Buffer.byteLength(script)} bytes`);

  // 2. Free the name. Rules bind by id, so this detaches nothing — the old
  //    scenario keeps serving every one of its rules throughout steps 2-4.
  assertResult1(
    `SetScenarioInfo(rename -> ${legacyName})`,
    await attempt(`SetScenarioInfo(rename -> ${legacyName})`, () =>
      setScenarioInfo(cfg, { scenarioId, scenarioName: legacyName }),
    ),
  );

  // Any failure from here until the first unbind is free to undo: nothing has
  // been detached yet, so restoring the name puts the account back exactly.
  const renameOnlyRepair =
    `REPAIR (nothing was unbound — the old scenario is still serving every rule): ` +
    `rename ${scenarioId} back with SetScenarioInfo(scenarioId:${scenarioId}, scenarioName:"${scenarioName}").`;

  // 3. Create it inside the application under the freed name, bound to NO rule
  //    yet. AddScenario would accept a ruleId, but using it here would attach
  //    the new scenario to a rule the old one still serves — the both-run state
  //    this ordering exists to avoid.
  const added = await attempt(`AddScenario(${scenarioName}, application ${applicationId})`, () =>
    addScenario(cfg, { scenarioName, scenarioScript: script, applicationId }),
  );
  if (!added.ok || added.value?.result !== 1 || !added.value?.scenario_id) {
    throw new Error(
      `${scenarioName}: AddScenario failed (code=${added.code} msg=${added.msg}). ${renameOnlyRepair}`,
    );
  }
  const newId = added.value.scenario_id;
  console.log(`    new scenario id: ${newId}`);

  // 4. THE ASSUMPTION THIS WHOLE MIGRATION RESTS ON, checked before a single
  //    binding is touched: the probe proved AddScenario succeeds once the name
  //    is free, never that the result lands inside the application. If it went
  //    to the Shared folder instead, the migration is pointless — stop here,
  //    while stopping is still free.
  const scopedNow = await appScoped(cfg, applicationId);
  if (!scopedNow.some((s) => s.scenario_id === newId)) {
    await attempt(`rollback DelScenario(${newId})`, () => delScenario(cfg, newId));
    throw new Error(
      `${scenarioName}: AddScenario(application_id) produced ${newId} but it is NOT ` +
        `application-scoped — it went to the Shared folder. The migration approach does not ` +
        `work; the new scenario was deleted. ${renameOnlyRepair}`,
    );
  }
  console.log(`    confirmed application-scoped: ${newId}`);

  // 5. Swap rule by rule: unbind the old, then bind the new. See the header on
  //    why this order and not the reverse.
  for (const ruleId of ruleIds) {
    assertResult1(
      `BindScenario(old ${scenarioId} <- rule ${ruleId}, bind=false)`,
      await attempt(`BindScenario(old ${scenarioId}, rule ${ruleId}, bind=false)`, () =>
        bindScenario(cfg, { scenarioIds: [scenarioId], ruleId, applicationId, bind: false }),
      ),
    );
    assertResult1(
      `BindScenario(new ${newId} -> rule ${ruleId})`,
      await attempt(`BindScenario(new ${newId}, rule ${ruleId}, bind=true)`, () =>
        bindScenario(cfg, { scenarioIds: [newId], ruleId, applicationId, bind: true }),
      ),
    );
  }

  // 6. Prove it from the platform before anything is deleted: every rule must
  //    resolve to exactly the new id.
  const afterRules = await rules(cfg, applicationId);
  for (const ruleId of ruleIds) {
    const rule = afterRules.find((r) => r.rule_id === ruleId);
    const bound = (rule?.scenarios ?? []).map((s) => s.scenario_id);
    if (bound.length !== 1 || bound[0] !== newId) {
      throw new Error(
        `${scenarioName}: rule ${ruleId} resolves to [${bound.join(',')}], expected exactly [${newId}]. ` +
          `NOTHING DELETED — the original is still "${legacyName}" (${scenarioId}).`,
      );
    }
  }
  console.log(`    verified: rules ${ruleIds.join('/')} -> ${newId}`);

  // 7. Only now.
  assertResult1(
    `DelScenario(old ${scenarioId})`,
    await attempt(`DelScenario(old ${scenarioId} "${legacyName}")`, () =>
      delScenario(cfg, scenarioId),
    ),
  );
  return newId;
}

// Full end-to-end rehearsal of the same code path, on a scenario bound to no
// live rule plus a rule that cannot fire. Proves the sequence before it is
// pointed at production, then puts the account back exactly as it was.
async function rehearse(cfg: VoximplantConfig, applicationId: number): Promise<void> {
  console.log(`\n=== REHEARSAL on ${REHEARSAL_SCENARIO} + an inert rule ===`);
  const beforeAccount = await accountWide(cfg);
  const beforeScoped = await appScoped(cfg, applicationId);
  const beforeRules = await rules(cfg, applicationId);

  const subject = beforeAccount.find((s) => s.scenario_name === REHEARSAL_SCENARIO);
  if (!subject) throw new Error(`rehearsal subject ${REHEARSAL_SCENARIO} not found`);
  if (beforeScoped.some((s) => s.scenario_id === subject.scenario_id)) {
    throw new Error(`${REHEARSAL_SCENARIO} is already application-scoped — pick another subject`);
  }
  const boundSomewhere = beforeRules.some((r) =>
    (r.scenarios ?? []).some((s) => s.scenario_id === subject.scenario_id),
  );
  if (boundSomewhere) {
    throw new Error(`${REHEARSAL_SCENARIO} is bound to a live rule — refusing to rehearse on it`);
  }

  let ruleId: number | undefined;
  let newId: number | undefined;
  try {
    const rule = await attempt(`AddRule(${REHEARSAL_RULE_NAME})`, () =>
      addRule(cfg, {
        applicationId,
        ruleName: REHEARSAL_RULE_NAME,
        rulePattern: REHEARSAL_RULE_PATTERN,
      }),
    );
    if (!rule.ok || !rule.value?.rule_id) throw new Error('rehearsal AddRule failed');
    ruleId = rule.value.rule_id;

    assertResult1(
      'BindScenario(subject -> rehearsal rule)',
      await attempt('BindScenario(subject -> rehearsal rule)', () =>
        bindScenario(cfg, {
          scenarioIds: [subject.scenario_id],
          ruleId,
          applicationId,
          bind: true,
        }),
      ),
    );

    newId = await migrateOne(cfg, applicationId, {
      scenarioName: subject.scenario_name,
      scenarioId: subject.scenario_id,
      ruleIds: [ruleId],
      ruleNames: [REHEARSAL_RULE_NAME],
    });
    console.log(`\n  REHEARSAL PASSED — the sequence works end to end (new id ${newId}).`);
  } finally {
    // Put the account back: delete the migrated copy, restore the original as a
    // Shared scenario under its own name, drop the inert rule.
    //
    // PARTIAL-FAILURE PATH FIRST. If migrateOne threw, newId is undefined and
    // the branch below never runs — but the subject may already be renamed to
    // "<name>-legacy" and unbound. Undo that before anything else, or the
    // rehearsal leaves the account dirtier than it found it, which is the one
    // thing a rehearsal must never do.
    const strays = (await accountWide(cfg)).filter(
      (s) => s.scenario_name === `${REHEARSAL_SCENARIO}${LEGACY_SUFFIX}`,
    );
    for (const stray of strays) {
      if (newId !== undefined) {
        // The happy path already created a replacement under the real name, so
        // the stray is the old copy migrateOne would have deleted. Drop it.
        await attempt(`cleanup DelScenario(stray ${stray.scenario_id})`, () =>
          delScenario(cfg, stray.scenario_id),
        );
      } else {
        await attempt(`cleanup rename ${stray.scenario_id} back to ${REHEARSAL_SCENARIO}`, () =>
          setScenarioInfo(cfg, {
            scenarioId: stray.scenario_id,
            scenarioName: REHEARSAL_SCENARIO,
          }),
        );
      }
    }

    if (newId !== undefined) {
      const back = await voxRetry(() => getScenarios(cfg, newId!, { with_script: true }));
      const script = back.result.find((s) => s.scenario_id === newId)?.scenario_script;
      await attempt(`cleanup DelScenario(${newId})`, () => delScenario(cfg, newId!));
      if (typeof script === 'string' && script.length > 0) {
        await attempt(`cleanup restore ${REHEARSAL_SCENARIO} as Shared`, () =>
          addScenario(cfg, { scenarioName: REHEARSAL_SCENARIO, scenarioScript: script }),
        );
      } else {
        console.error(
          `  !! could not read back ${newId} to restore ${REHEARSAL_SCENARIO} — RESTORE IT BY HAND`,
        );
      }
    }
    if (ruleId !== undefined) {
      await attempt(`cleanup DelRule(${ruleId})`, () => delRule(cfg, ruleId!));
    }
    const afterRules = await rules(cfg, applicationId);
    if (afterRules.length !== beforeRules.length) {
      throw new Error(
        `rehearsal cleanup left the rule set changed: ${beforeRules.length} -> ${afterRules.length}`,
      );
    }
    // The subject must exist again under its own name, and nothing may be left
    // wearing the -legacy suffix.
    const afterAccount = await accountWide(cfg);
    const restored = afterAccount.find((s) => s.scenario_name === REHEARSAL_SCENARIO);
    if (!restored) {
      console.error(
        `  !! ${REHEARSAL_SCENARIO} is MISSING after cleanup. Its source is committed at ` +
          `voxfiles/scenarios/src/${REHEARSAL_SCENARIO}.voxengine.js — restore it from there.`,
      );
    } else if (restored.scenario_id !== subject.scenario_id) {
      // Expected on the happy path: the original id was deleted by migrateOne
      // and the restore created a fresh one. Say it out loud rather than let it
      // surface later as a surprise.
      console.log(
        `  note: ${REHEARSAL_SCENARIO} came back with a NEW id ` +
          `(${subject.scenario_id} -> ${restored.scenario_id}). It is bound to no rule, so nothing references it.`,
      );
    }
    if (afterAccount.length !== beforeAccount.length) {
      throw new Error(
        `rehearsal cleanup left the scenario count changed: ${beforeAccount.length} -> ${afterAccount.length}`,
      );
    }
    console.log('  rehearsal cleanup verified: rule set restored');
  }
}

const HELP = `Move Shared-folder scenarios into the kalfa-rsvp application, which is what
voxengine-ci 36 requires in order to see them at all.

usage: npm run vox:migrate-scenarios [-- <flags>]
       (the bare "--" is required: without it npm eats the flags itself)

flags:
  --confirm            Actually write to the platform. Without it this is a DRY
                       RUN that reads the live rule->scenario map and prints the
                       exact plan, touching nothing.
  --rehearse           Run the WHOLE sequence end to end on ${REHEARSAL_SCENARIO}
                       (Shared, bound to no live rule — both asserted) plus a
                       temporary rule that cannot match a dialed number, then
                       reverse it and assert the account is unchanged. Needs
                       --confirm. Do this before the real run.
  --only <name>        Migrate just this scenario (repeatable).
  --include-outcall    Permit rule ${OUTCALL_RULE_ID} (OutCall, the DTMF flow).
                       Excluded by default: it needs its own owner sign-off.
  --help               Show this text (no credentials required).

AFTERWARDS — THE TRAP. Local metadata still holds the old scenario ids, and
voxengine-ci's own reconciliation for that is \`init --force\`. Read what it does
first: projectCleanup() calls rm(voxfiles/scenarios, {recursive:true, force:true})
— src/ included — and projectInit() then rewrites src/ from the PLATFORM copy,
which is tsc build output with every comment stripped. The sources are all
git-tracked, so follow it immediately with
\`git checkout -- voxfiles/scenarios/src/\`.

ORDER OF OPERATIONS, per scenario:
  rename old -> "<name>${LEGACY_SUFFIX}"  (frees the account-wide-unique name;
                                  rules bind by id, so nothing detaches)
  unbind old from every rule it serves
  AddScenario(<name>, deployed script, application)   -> new app-scoped id
  bind new to every one of those rules
  verify from the platform that each rule now resolves to exactly the new id
  delete the old one  <- only after that verification passes

The deployed script is read and passed back unchanged, so the migration moves
code without editing it.

WINDOW. Between the unbind and the bind a rule resolves to no scenario for well
under a second. The outbound rules only ever fire when our own dispatcher calls
StartScenarios, so pausing dispatch closes that window completely. "incoming"
(1494687) is the one rule an outside caller can trigger at any moment — run it
at a quiet hour.

Nothing is deleted unless verification passed. Any earlier failure aborts with
the original still present as "<name>${LEGACY_SUFFIX}" and prints how to restore it.
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }
  const confirm = argv.includes('--confirm');
  const doRehearse = argv.includes('--rehearse');
  const includeOutcall = argv.includes('--include-outcall');
  const only: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--only' && argv[i + 1]) only.push(argv[i + 1]);
  }

  const cfg = loadConfig();
  const apps = await voxRetry(() => getApplications(cfg, { application_name: APP_NAME }));
  const app = apps.result.find((a) => a.application_name === APP_NAME);
  if (!app) throw new Error(`application ${APP_NAME} not found`);
  const applicationId = app.application_id;
  console.log(`application: ${APP_NAME} (${applicationId})`);

  const scopedBefore = await appScoped(cfg, applicationId);
  const accountBefore = await accountWide(cfg);
  const ruleList = await rules(cfg, applicationId);
  console.log(`account-wide scenarios (${accountBefore.length}): ${names(accountBefore)}`);
  console.log(`application-scoped  (${scopedBefore.length}): ${names(scopedBefore)}`);

  if (doRehearse) {
    if (!confirm) {
      console.log('\n--rehearse needs --confirm (it writes). Nothing done.');
      return;
    }
    await rehearse(cfg, applicationId);
    return;
  }

  const scopedIds = new Set(scopedBefore.map((s) => s.scenario_id));
  let plan = planFrom(ruleList, scopedIds);

  if (!includeOutcall) {
    plan = plan
      .map((t) => {
        const keepIdx = t.ruleIds
          .map((id, i) => (id === OUTCALL_RULE_ID ? -1 : i))
          .filter((i) => i >= 0);
        if (keepIdx.length === t.ruleIds.length) return t;
        console.log(
          `  excluding rule ${OUTCALL_RULE_ID} (OutCall) from ${t.scenarioName} — pass --include-outcall to reach it`,
        );
        return {
          ...t,
          ruleIds: keepIdx.map((i) => t.ruleIds[i]),
          ruleNames: keepIdx.map((i) => t.ruleNames[i]),
        };
      })
      .filter((t) => t.ruleIds.length > 0);
  }
  if (only.length > 0) plan = plan.filter((t) => only.includes(t.scenarioName));

  // A rename must be possible before a single write happens.
  for (const t of plan) {
    if (t.scenarioName.length + LEGACY_SUFFIX.length >= NAME_LIMIT) {
      throw new Error(
        `${t.scenarioName}: "${t.scenarioName}${LEGACY_SUFFIX}" is ${t.scenarioName.length + LEGACY_SUFFIX.length} chars, ` +
          `the API limit is <${NAME_LIMIT}. Pick a shorter suffix before running.`,
      );
    }
  }

  console.log(`\nPLAN — ${plan.length} scenario(s) to move:`);
  for (const t of plan) {
    console.log(
      `  ${t.scenarioName}(${t.scenarioId})  rules: ${t.ruleNames.map((n, i) => `${n}(${t.ruleIds[i]})`).join(', ')}`,
    );
  }
  if (plan.length === 0) {
    console.log('  nothing to do — every rule-bound scenario is already application-scoped.');
    return;
  }

  if (!confirm) {
    console.log('\nDRY RUN — nothing was written. Re-run with --confirm to execute.');
    console.log('Strongly recommended first: npm run vox:migrate-scenarios -- --rehearse --confirm');
    return;
  }

  const moved: Array<{ name: string; from: number; to: number }> = [];
  for (const t of plan) {
    const newId = await migrateOne(cfg, applicationId, t);
    moved.push({ name: t.scenarioName, from: t.scenarioId, to: newId });
  }

  // Whole-account read-back. Every migrated scenario must now be app-scoped,
  // and the account must hold exactly as many scenarios as before (one deleted
  // per one created).
  const scopedAfter = await appScoped(cfg, applicationId);
  const accountAfter = await accountWide(cfg);
  console.log(`\napplication-scoped after (${scopedAfter.length}): ${names(scopedAfter)}`);
  for (const m of moved) {
    if (!scopedAfter.some((s) => s.scenario_id === m.to)) {
      throw new Error(`${m.name}: ${m.to} is missing from the app-scoped set after migration`);
    }
    if (accountAfter.some((s) => s.scenario_id === m.from)) {
      throw new Error(`${m.name}: old id ${m.from} still exists after migration`);
    }
  }
  if (accountAfter.length !== accountBefore.length) {
    console.warn(
      `  !! account-wide scenario count changed ${accountBefore.length} -> ${accountAfter.length} — inspect before upgrading`,
    );
  }

  console.log('\nMIGRATED:');
  for (const m of moved) console.log(`  ${m.name}: ${m.from} -> ${m.to}`);
  console.log(
    '\nNEXT — the 36 upgrade, in this order:\n' +
      '  36 changes the LOCAL layout too: scenarios move from voxfiles/scenarios/src/ to\n' +
      '  voxfiles/applications/<application-name>/scenarios/src/ (36 README, "Breaking change\n' +
      '  in 36.0.0"). Its upload also looks every scenario up APPLICATION-SCOPED, which is why\n' +
      '  the platform move above had to happen first.\n' +
      '\n' +
      '      npm i @voximplant/voxengine-ci@36.0.0\n' +
      '      git mv voxfiles/scenarios \\\n' +
      '             voxfiles/applications/' + APP_NAME + '/scenarios\n' +
      '      rm -rf voxfiles/.voxengine-ci/scenarios\n' +
      '      npm run vox:upload -- --rule-name OutCallAgent --dry-run\n' +
      '\n' +
      '  Do NOT use `init --force` for this. It deletes voxfiles/scenarios recursively and\n' +
      '  rewrites src/ from the platform build output, losing every comment. `git mv` keeps the\n' +
      '  real sources and their history; the metadata rebuilds itself on the first upload\n' +
      '  (vox-scenario.service.js: no metadata + scenario found on platform -> adopt it).',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
