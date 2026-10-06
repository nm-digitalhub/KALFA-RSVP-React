// Settle how a Shared-folder scenario can become application-scoped, measuring
// each candidate on a subject nothing in production uses.
//
// WHY. voxengine-ci <= 35 never passes application_id to AddScenario, so every
// scenario it deployed for this account sits in the account-wide "Shared
// folder". voxengine-ci 36 filters scenarios by application_id and therefore
// sees almost none of them — measured 1 of 11. Upgrading blind would make
// `upload` treat live scenarios as new. See
// docs/voximplant/voxengine-ci-36-upgrade-blocked.md.
//
// PHASE A — does BindScenario move it?
//   Probe v1 (2026-09-14) said no, but only checked that the call returned no
//   `error`. Voximplant returns {result: 1} on success, so a silent {result: 0}
//   is indistinguishable from that. v2 asserts result === 1 AND reads the rule
//   back with_scenarios to prove the bind actually attached, before concluding
//   anything about the move.
//
// PHASE B — does AddScenario(application_id) move, duplicate, or reject?
//   This is the call voxengine-ci 36 makes on upload. If it MOVES, then
//   `voxengine-ci 36 upload` is itself the migration tool and nothing has to be
//   hand-written. If it DUPLICATES, that is the production hazard, confirmed.
//   If it REJECTS, upload fails cleanly and migration must happen in the
//   control panel. The current deployed text is read first and passed back
//   unchanged, so even a successful rewrite is content-neutral.
//
// SAFETY. Subject is a Shared scenario bound to NO rule (asserted at runtime).
// The probe rule's pattern cannot match a dialed number and is appended after
// two existing `.*` rules, so it is doubly unreachable. The rule is deleted in
// a `finally` and the rule set is read back and asserted. Any DUPLICATE
// scenario Phase B creates is deleted by its new id — never the original.
//
// NOTE: if Phase B turns out to MOVE the subject, that move is not undone (no
// API reverses it). The subject is unused, and that is the outcome we want for
// the real scenarios anyway.
//
// Run (owner): npm run vox:probe-binding -- --confirm
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
// Shared scenarios bound to no rule — see the rules table in the doc above.
const CANDIDATES = ['RSVPPreview', 'VoiceABTest', 'VoiceAgentTest'];
const PROBE_RULE_NAME = `zz-probe-binding-${new Date().toISOString().slice(0, 10)}`;
const PROBE_RULE_PATTERN = 'zzz-probe-never-matches';

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
  s.map((x) => `${x.scenario_name}(${x.scenario_id})`).sort().join(', ');
const ruleNames = (r: RuleInfo[]): string =>
  r.map((x) => `${x.rule_name}(${x.rule_id})`).sort().join(', ');

async function appScoped(cfg: VoximplantConfig, applicationId: number): Promise<ScenarioInfo[]> {
  const r = await voxRetry(() => listScenarios(cfg, { application_id: applicationId }));
  return r.result;
}
async function accountWide(cfg: VoximplantConfig): Promise<ScenarioInfo[]> {
  const r = await voxRetry(() => listScenarios(cfg, {}));
  return r.result;
}

// voxRequest THROWS VoximplantApiError on a top-level {error:{code,msg}} — it
// never returns the error as a value. Probe v2's first run lost Phase B to that:
// the AddScenario rejection propagated out before the rewrite variant could be
// tried. Capture it instead.
interface ApiOutcome<T> {
  ok: boolean;
  value?: T;
  code?: number | null;
  msg?: string;
}
async function attempt<T>(label: string, fn: () => Promise<T>): Promise<ApiOutcome<T>> {
  try {
    const value = await fn();
    console.log(`${label}: OK ${JSON.stringify(value)}`);
    return { ok: true, value };
  } catch (e) {
    if (e instanceof VoximplantApiError) {
      console.log(`${label}: REJECTED code=${e.code} msg="${e.message}"`);
      return { ok: false, code: e.code, msg: e.message };
    }
    throw e;
  }
}

const HELP = `Voximplant scenario-binding probe — measures how a Shared-folder scenario
can be made application-scoped. Read-only unless --confirm is passed.

usage: npm run vox:probe-binding [-- <flags>]
       (the bare "--" is required: without it npm eats the flags itself)

flags:
  --confirm    Actually write to the platform. Without it this is a DRY RUN that
               only lists scenarios, app-scoped scenarios and rules.
  --help       Show this text (no credentials required).

what --confirm does, on subject ${CANDIDATES.join(' / ')} — whichever is both in
the Shared folder AND bound to no rule (asserted at runtime; it refuses if none is):

  Phase 0  BindScenario(scenario, application) with NO rule
  Phase A  AddRule(pattern "${PROBE_RULE_PATTERN}") + BindScenario(scenario, rule, application)
           then reads the rule back to prove the bind attached
  Phase B  AddScenario(scenario, application) and the same with rewrite=true
  Phase C  SetScenarioInfo to rename the scenario (freeing its name), then
           AddScenario(scenario, application) again. Undone in full: the new
           scenario is deleted and the original name restored, in that order.

The probe rule cannot match any dialed number and is appended after the existing
".*" rules. It is deleted in a finally, and the rule set is read back and asserted
byte-identical. No live rule or live scenario is touched.

On exit the full scenario set — account-wide AND app-scoped — is read back and
asserted identical to the pre-probe set; the run fails loudly if anything differs.

results so far (2026-09-14): Phase 0 rejected 147, Phase A binds but does not move,
Phase B rejected 133 both ways. See docs/voximplant/voxengine-ci-36-upgrade-blocked.md
`;

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(HELP);
    return;
  }
  const cfg = loadConfig();
  const apps = await voxRetry(() => getApplications(cfg));
  const app = apps.result.find((a) => a.application_name === APP_NAME);
  if (!app) throw new Error(`application not found: ${APP_NAME}`);
  const applicationId = app.application_id;

  const accountBefore = await accountWide(cfg);
  const appBefore = await appScoped(cfg, applicationId);
  const rulesBefore = await voxRetry(() => getRules(cfg, applicationId));

  console.log(`account-wide scenarios (${accountBefore.length}): ${names(accountBefore)}`);
  console.log(`app-scoped scenarios   (${appBefore.length}): ${names(appBefore)}`);
  console.log(`rules                  (${rulesBefore.result.length}): ${ruleNames(rulesBefore.result)}`);

  const boundNames = new Set(
    rulesBefore.result.flatMap((r) => (r.scenarios ?? []).map((s) => s.scenario_name)),
  );
  const appScopedNames = new Set(appBefore.map((s) => s.scenario_name));
  const subject = CANDIDATES.map((n) => accountBefore.find((s) => s.scenario_name === n)).find(
    (s): s is ScenarioInfo =>
      !!s && !appScopedNames.has(s.scenario_name) && !boundNames.has(s.scenario_name),
  );
  if (!subject) {
    throw new Error(
      `no safe probe subject: none of [${CANDIDATES.join(', ')}] is both Shared and rule-unbound`,
    );
  }
  console.log(`\nsubject: ${subject.scenario_name} (scenario_id=${subject.scenario_id})`);

  if (rulesBefore.result.some((r) => r.rule_name === PROBE_RULE_NAME)) {
    throw new Error(`probe rule ${PROBE_RULE_NAME} already exists — clean it up first`);
  }

  if (!process.argv.includes('--confirm')) {
    console.log('\n[probe] dry run — re-run with --confirm to apply');
    return;
  }

  let probeRuleId: number | undefined;
  let duplicateId: number | undefined;
  // Phase C state — both must be undone in the finally, in this order:
  // delete the new scenario FIRST (to free the name), then restore the old name.
  let phaseCNewId: number | undefined;
  let phaseCRenamed = false;
  try {
    // ============ PHASE 0 — bind to the APPLICATION, with NO rule ==========
    // The control panel's action is "bind scenario to application". The API
    // reference says BindScenario needs a rule, but that page is demonstrably
    // stale, so ask the API directly instead of ruling it out.
    console.log('\n===== PHASE 0: BindScenario with application_id and NO rule =====');
    const appOnly = await attempt('BindScenario(application_id, no rule)', () =>
      bindScenario(cfg, { scenarioIds: [subject.scenario_id], applicationId, bind: true }),
    );
    const appAfterPhase0 = await appScoped(cfg, applicationId);
    const movedByAppOnly = appAfterPhase0.some((s) => s.scenario_id === subject.scenario_id);
    console.log(`app-scoped count                 : ${appBefore.length} -> ${appAfterPhase0.length}`);
    console.log(`subject now app-scoped           : ${movedByAppOnly ? 'YES' : 'NO'}`);
    if (appOnly.ok && movedByAppOnly) {
      console.log('PHASE 0 VERDICT: *** THIS IS THE BUILT-IN MOVE COMMAND ***');
      console.log(`  BindScenario(scenario_id=${subject.scenario_id}, application_id=${applicationId}, bind=true)`);
      console.log('  Same scenario_id, no rule needed, no recreation. The migration is 7 of these.');
      return;
    }
    console.log(
      appOnly.ok
        ? 'PHASE 0 VERDICT: accepted but did NOT move — continue to the other phases.'
        : 'PHASE 0 VERDICT: rejected — a rule really is required; continue.',
    );

    // ================= PHASE A — BindScenario =============================
    console.log('\n===== PHASE A: does BindScenario move a Shared scenario? =====');
    const added = await addRule(cfg, {
      applicationId,
      ruleName: PROBE_RULE_NAME,
      rulePattern: PROBE_RULE_PATTERN,
    });
    if (added.error || !added.rule_id) {
      throw new Error(`AddRule failed (code=${added.error?.code ?? 'none'})`);
    }
    probeRuleId = added.rule_id;
    console.log(`created probe rule ${PROBE_RULE_NAME}(${probeRuleId}) pattern=${PROBE_RULE_PATTERN}`);

    const bound = await bindScenario(cfg, {
      scenarioIds: [subject.scenario_id],
      ruleId: probeRuleId,
      applicationId,
      bind: true,
    });
    console.log(`BindScenario raw response: ${JSON.stringify(bound)}`);
    // v1's gap: no-error is NOT success. Assert the documented success value.
    const bindReportedSuccess = bound.result === 1;
    console.log(`BindScenario result === 1        : ${bindReportedSuccess ? 'YES' : 'NO'}`);

    // The real proof the bind took effect: read the rule back with its scenarios.
    const rulesWithScenarios = await voxRetry(() => getRules(cfg, applicationId));
    const probeRule = rulesWithScenarios.result.find((r) => r.rule_id === probeRuleId);
    const attached = (probeRule?.scenarios ?? []).some((s) => s.scenario_id === subject.scenario_id);
    console.log(
      `probe rule scenarios             : [${(probeRule?.scenarios ?? []).map((s) => `${s.scenario_name}(${s.scenario_id})`).join(', ')}]`,
    );
    console.log(`bind actually attached           : ${attached ? 'YES' : 'NO'}`);

    const appAfterBind = await appScoped(cfg, applicationId);
    const movedByBind = appAfterBind.some((s) => s.scenario_id === subject.scenario_id);
    console.log(`app-scoped count                 : ${appBefore.length} -> ${appAfterBind.length}`);
    console.log(`subject now app-scoped           : ${movedByBind ? 'YES' : 'NO'}`);
    console.log(
      attached && !movedByBind
        ? 'PHASE A VERDICT: bind PROVEN to attach, and it does NOT move the scenario out of Shared.'
        : attached && movedByBind
          ? 'PHASE A VERDICT: BindScenario MOVES the scenario into the application.'
          : 'PHASE A VERDICT: INCONCLUSIVE — the bind did not attach, so nothing about the move was measured.',
    );

    // ================= PHASE B — AddScenario =============================
    console.log('\n===== PHASE B: what does AddScenario(application_id) do to an existing Shared name? =====');
    const withScript = await voxRetry(() =>
      getScenarios(cfg, subject.scenario_id, { with_script: true }),
    );
    const row = withScript.result.find((s) => s.scenario_id === subject.scenario_id);
    const currentScript = row?.scenario_script;
    if (!currentScript) throw new Error(`could not read deployed text of ${subject.scenario_name}`);
    console.log(`captured deployed text: ${currentScript.length} chars (passed back unchanged)`);

    // Exactly the call voxengine-ci 36 makes on upload — no rewrite flag.
    const asPlain = await attempt('AddScenario(application_id, no rewrite)', () =>
      addScenario(cfg, {
        scenarioName: subject.scenario_name,
        scenarioScript: currentScript,
        applicationId,
      }),
    );

    // The documented flag whose interaction with application_id is unspecified.
    const asRewrite = asPlain.ok
      ? undefined
      : await attempt('AddScenario(application_id, rewrite=true)', () =>
          addScenario(cfg, {
            scenarioName: subject.scenario_name,
            scenarioScript: currentScript,
            applicationId,
            rewrite: true,
          }),
        );

    const appAfterAdd = await appScoped(cfg, applicationId);
    const accountAfterAdd = await accountWide(cfg);
    console.log(`\napp-scoped scenarios   (${appAfterAdd.length}): ${names(appAfterAdd)}`);
    console.log(`account-wide scenarios (${accountAfterAdd.length}): ${names(accountAfterAdd)}`);

    const appCopy = appAfterAdd.find((s) => s.scenario_name === subject.scenario_name);
    const originalStillExists = accountAfterAdd.some((s) => s.scenario_id === subject.scenario_id);
    const newId = appCopy && appCopy.scenario_id !== subject.scenario_id ? appCopy.scenario_id : undefined;

    console.log('\n--- PHASE B RESULT ---');
    console.log(`AddScenario (no rewrite)         : ${asPlain.ok ? 'ACCEPTED' : `REJECTED (${asPlain.code}) ${asPlain.msg}`}`);
    if (asRewrite) {
      console.log(`AddScenario (rewrite=true)       : ${asRewrite.ok ? 'ACCEPTED' : `REJECTED (${asRewrite.code}) ${asRewrite.msg}`}`);
    }
    console.log(`subject name now app-scoped      : ${appCopy ? `YES (${appCopy.scenario_id})` : 'NO'}`);
    console.log(`original id ${subject.scenario_id} still exists : ${originalStillExists ? 'YES' : 'NO'}`);
    console.log(`account-wide count               : ${accountBefore.length} -> ${accountAfterAdd.length}`);

    if (appCopy && !newId) {
      console.log('VERDICT: AddScenario(application_id) MOVED the scenario in place (id preserved).');
      console.log('  => `voxengine-ci 36 upload` is itself the migration tool. Nothing hand-written needed.');
    } else if (appCopy && newId && originalStillExists) {
      duplicateId = newId;
      console.log(`VERDICT: AddScenario(application_id) CREATED A DUPLICATE (${subject.scenario_id} -> ${newId}).`);
    } else if (!asPlain.ok && (!asRewrite || !asRewrite.ok)) {
      console.log('VERDICT: AddScenario(application_id) is REJECTED for a name that already exists.');
      console.log('  => Scenario names are unique ACCOUNT-WIDE, across the Shared folder and every application.');
      console.log('  => Under voxengine-ci 36, `upload` cannot create the app-scoped copy at all.');
      console.log('  => No API route exists. Migration must use the control panel (right-click -> bind to application).');
    } else {
      console.log('VERDICT: unexpected combination — see the raw outcomes above.');
    }

    // ================= PHASE C — free the name, then create ==============
    // No single API call moves a scenario. But 133 fires ONLY because the name
    // is taken, and SetScenarioInfo can rename ("You can edit the scenario's
    // name and body"). So: free the name, then AddScenario with application_id.
    // Fully reversible, and the subject is bound to no live rule.
    console.log('\n===== PHASE C: rename to free the name, then create app-scoped =====');
    const legacyName = `${subject.scenario_name}-legacy`.slice(0, 29);
    const renamed = await attempt(`SetScenarioInfo(${subject.scenario_id} -> "${legacyName}")`, () =>
      setScenarioInfo(cfg, { scenarioId: subject.scenario_id, scenarioName: legacyName }),
    );
    if (!renamed.ok) {
      console.log('PHASE C VERDICT: rename itself was rejected — the flow is not available.');
    } else {
      phaseCRenamed = true;
      // Prove the rename landed, and that the id is unchanged.
      const afterRename = await accountWide(cfg);
      const row = afterRename.find((x) => x.scenario_id === subject.scenario_id);
      console.log(`rename landed                    : ${row?.scenario_name === legacyName ? 'YES' : `NO (${row?.scenario_name ?? 'absent'})`}`);
      console.log(`scenario_id unchanged            : ${row ? `YES (${row.scenario_id})` : 'NO'}`);
      // A rename must NOT detach the scenario from the rule it is bound to.
      if (probeRuleId !== undefined) {
        const rr = await voxRetry(() => getRules(cfg, applicationId));
        const pr = rr.result.find((r) => r.rule_id === probeRuleId);
        const stillBound = (pr?.scenarios ?? []).some((x) => x.scenario_id === subject.scenario_id);
        console.log(`still bound to its rule after rename: ${stillBound ? 'YES — rules bind by id, not name' : 'NO — rename DETACHED it'}`);
      }

      const created = await attempt(
        `AddScenario("${subject.scenario_name}", application_id=${applicationId}) with the name now free`,
        () =>
          addScenario(cfg, {
            scenarioName: subject.scenario_name,
            scenarioScript: currentScript,
            applicationId,
          }),
      );
      const appAfterC = await appScoped(cfg, applicationId);
      const accountAfterC = await accountWide(cfg);
      const madeIt = appAfterC.find((x) => x.scenario_name === subject.scenario_name);
      if (madeIt) phaseCNewId = madeIt.scenario_id;

      console.log(`\napp-scoped scenarios   (${appAfterC.length}): ${names(appAfterC)}`);
      console.log('\n--- PHASE C RESULT ---');
      console.log(`AddScenario after freeing name   : ${created.ok ? 'ACCEPTED' : `REJECTED (${created.code}) ${created.msg}`}`);
      console.log(`app-scoped count                 : ${appBefore.length} -> ${appAfterC.length}`);
      console.log(`account-wide count               : ${accountBefore.length} -> ${accountAfterC.length}`);
      console.log(`new app-scoped scenario          : ${madeIt ? `${madeIt.scenario_name}(${madeIt.scenario_id})` : 'none'}`);
      console.log(
        created.ok && madeIt
          ? 'PHASE C VERDICT: *** THE FLOW WORKS *** rename -> AddScenario(application_id) produces an application-scoped scenario.\n  => A panel-free migration is possible: rename, create+bind, unbind old, delete old. Per scenario.'
          : 'PHASE C VERDICT: freeing the name did NOT unblock it — see the rejection above.',
      );
    }

  } finally {
    // ================= CLEANUP ===========================================
    // --- Phase C undo, in order: delete the new one (frees the name), then
    // restore the original name. Reversed, the rename would hit 133.
    if (phaseCNewId !== undefined) {
      const d = await delScenario(cfg, phaseCNewId);
      console.log(
        d.error
          ? `CLEANUP FAILED: DelScenario(${phaseCNewId}) — remove it by hand`
          : `\ndeleted phase-C scenario ${phaseCNewId}`,
      );
    }
    if (phaseCRenamed) {
      try {
        await setScenarioInfo(cfg, {
          scenarioId: subject.scenario_id,
          scenarioName: subject.scenario_name,
        });
        console.log(`restored name of ${subject.scenario_id} to "${subject.scenario_name}"`);
      } catch (e) {
        console.error(
          `CLEANUP FAILED: could not restore the name of ${subject.scenario_id} to "${subject.scenario_name}" — do it by hand. ${e instanceof Error ? e.message : ''}`,
        );
      }
    }
    if (duplicateId !== undefined) {
      const d = await delScenario(cfg, duplicateId);
      console.log(
        d.error
          ? `CLEANUP FAILED: DelScenario(${duplicateId}) code=${d.error.code} — remove it by hand`
          : `\ndeleted duplicate scenario ${duplicateId}`,
      );
    }
    if (probeRuleId !== undefined) {
      const del = await delRule(cfg, probeRuleId);
      console.log(
        del.error
          ? `CLEANUP FAILED: DelRule(${probeRuleId}) code=${del.error.code} — remove it by hand`
          : `deleted probe rule ${probeRuleId}`,
      );
      const rulesAfter = await voxRetry(() => getRules(cfg, applicationId));
      console.log(`rules (${rulesAfter.result.length}): ${ruleNames(rulesAfter.result)}`);
      if (ruleNames(rulesAfter.result) !== ruleNames(rulesBefore.result)) {
        throw new Error('post-cleanup verification: rule set does not match the pre-probe set');
      }
      console.log('rule set verified unchanged');
    }
    const finalAccount = await accountWide(cfg);
    console.log(`final account-wide scenarios (${finalAccount.length}): ${names(finalAccount)}`);
    const finalApp = await appScoped(cfg, applicationId);
    console.log(`final app-scoped scenarios   (${finalApp.length}): ${names(finalApp)}`);
    if (names(finalAccount) !== names(accountBefore)) {
      throw new Error(
        `post-cleanup verification: account scenarios differ from the pre-probe set.\n  before: ${names(accountBefore)}\n  after : ${names(finalAccount)}`,
      );
    }
    if (names(finalApp) !== names(appBefore)) {
      throw new Error('post-cleanup verification: app-scoped scenarios differ from the pre-probe set');
    }
    console.log('scenario set verified unchanged');
  }
}

main().catch((e) => {
  console.error('[probe] failed:', e instanceof Error ? e.message : 'unknown error');
  process.exit(1);
});
