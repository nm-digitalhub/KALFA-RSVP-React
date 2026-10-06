# voxengine-ci 36.0.0 — upgrade BLOCKED (investigated 2026-09-14)

**Verdict: do not upgrade. Stay on `^35.0.0`.** The blocker is platform-side
state, not our file layout — so the migration the 36.0.0 README describes is
necessary but *not sufficient*, and performing it would break production.

## What 36.0.0 changes

Two coupled changes, both breaking:

1. **File layout** — scenarios move from an account-wide folder to per-application:

   | Version | Source path | Metadata path |
   | --- | --- | --- |
   | ≤ 35.x | `voxfiles/scenarios/src/` | `voxfiles/.voxengine-ci/scenarios/dist/` |
   | 36.0.0+ | `voxfiles/applications/<app>/scenarios/src/` | `voxfiles/.voxengine-ci/applications/<app>/scenarios/dist/` |

   (`lib/domains/repositories/vox-scenario.persistent.repository.js:203-206`)

2. **Platform scoping** — every scenario call is now application-scoped.
   `getScenarios` / `AddScenario` / `downloadScenarioByName` all take an
   `applicationId`. `init` enumerates scenarios via
   `downloadScenariosByApplicationId(applicationId)` instead of an account-wide
   `downloadScenarios()`.

Dependencies and engines are unchanged between 35.1.0 and 36.0.0 (identical
pinned deps incl. `@voximplant/apiclient-nodejs@4.8.0`; `node >= 20`). The rest
of the delta is ~162 lines of updated `typings/voxengine.d.ts`.

**The upgrade buys nothing on security.** `npm audit --omit=dev` (2026-09-14):

| package | severity | via | fixAvailable |
| --- | --- | --- | --- |
| `@voximplant/apiclient-nodejs` | **critical** | axios, form-data | no |
| `@voximplant/voxengine-ci` | high | apiclient-nodejs, yaml | no |

36.0.0 pins the **same** `apiclient-nodejs@4.8.0` as 35.1.0, so the critical
chain is identical before and after. There is no security argument for moving.
This is also why `src/lib/voximplant/core.ts` talks to the Management API over
`fetch` instead of the SDK — a decision already recorded in that file's header.

## The blocker (MEASURED against the live account)

Our scenarios are **account-scoped legacy scenarios**. They are not bound to
application `kalfa-rsvp.kalfarsvp.voximplant.com` (id `11107202`), so 36.0.0
cannot see them.

Method: ran `36.0.0 init` and `35.1.0 init` against the live account, each into
a throwaway `VOX_CI_ROOT_PATH` outside the repo. `init` is platform-read-only
(downloads only; all writes are local).

| | scenarios returned |
| --- | --- |
| 35.1.0 (account-wide) | **11** — ConsoleCallMeNow, ConsoleDial, ConsoleInbound, MeetingConfirmAgent, Outgoingcall-RSVPAI, RSVP, RSVPAgent, RSVPPreview, SalesCloseAgent, VoiceABTest, VoiceAgentTest |
| 36.0.0 (`applicationId=11107202`) | **1** — `Outgoingcall-RSVPAI` (scenarioId 903860) |

The one application-scoped scenario is bound to **no rule at all**. Every
scenario that actually serves a live rule is invisible to 36.0.0:

| Rule | ruleId | Scenario | scenarioId | app-scoped? |
| --- | --- | --- | --- | --- |
| incoming | 1494687 | ConsoleInbound | 919510 | no |
| ConsoleInternal | 1523083 | ConsoleDial | 919506 | no |
| ConsoleOut | 1523084 | ConsoleDial | 919506 | no |
| ConsoleCallMeNow | 1523124 | ConsoleCallMeNow | 919514 | no |
| OutCall | 1494311 | RSVP | 907512 | no |
| **OutCallAgent** | **1520915** | **RSVPAgent** | **918450** | **no** |
| OutCallMeetingConfirm | 1523903 | MeetingConfirmAgent | 919799 | no |
| OutCallSalesClose | 1523906 | SalesCloseAgent | 919800 | no |

(Superseded — the failure modes are now measured; see "Phase B" below.)

## Why our scenarios are in the Shared folder (root cause)

Official API reference (`references.httpapi.scenarios`, fetched 2026-09-14 via the
repo's documented `getDoc` recipe), **AddScenario**:

> "Adds a new scenario to the **Shared folder**, so the scenario is available in
> all the existing applications. When adding a scenario to the Shared folder, the
> `application_id` and `application_name` parameters should not be provided."

voxengine-ci **≤ 35 never passes `application_id` to AddScenario**. So every
scenario it has ever deployed for us landed in the Shared folder. That is the
root cause — not a misconfiguration on our side. (`Outgoingcall-RSVPAI`, the one
app-scoped scenario, was created by hand in the control panel inside the
application, which is why it differs.)

36.0.0 *does* pass `application_id`, which is precisely why the two versions
disagree about what exists.

## Every route to make a Shared scenario application-scoped — MEASURED

Exhaustive. Each row is either verified against the live 36.0.0 source, the live
API reference, or executed against the live account on 2026-09-14.

| Route | Result | Evidence |
| --- | --- | --- |
| Control panel: right-click → bind to application | **EXISTS — the only working route** | Voximplant blog, new control panel |
| `voxengine-ci` migration command | does not exist | the CLI has exactly two commands: `init`, `upload` |
| `voxengine-ci 36 init` | cannot migrate — pull only | `projectInit` reaches only `download*` (platform read) and `save*` (local disk); zero platform-write methods |
| `voxengine-ci 36 upload` | **fails** | would call AddScenario → error 133 (below) |
| Management API `MoveScenario` | does not exist | all 8 Scenarios + 5 Rules + 4 Applications methods enumerated |
| `BindScenario(scenarioId, ruleId, applicationId)` | **does NOT move** | probe, below |
| `BindScenario(scenarioId, applicationId)` — no rule | **rejected, error 147** `'rule_id' parameter is invalid` | probe Phase 0 |
| `AddScenario(name, script, applicationId)` | **rejected, error 133** | probe, below |
| `AddScenario(… , rewrite: true)` | **rejected, error 133** | probe, below |
| `SetScenarioInfo` + application | parameter does not exist | live reference: only `scenario_id`, `required_scenario_name`, `scenario_name`, `scenario_script` |
| any other official Voximplant tool | none | `npm search @voximplant` → 6 packages, none is a migration tool |

> **Voximplant blog, announcing the new control panel:** "The scenarios created
> in the old panel are now considered as shared between all applications, but now
> you have the option to bind scenarios to any particular application. Note that
> **binding will remove a scenario from the Shared folder**." — Right-click on a
> scenario to manage it via a context menu.
> https://voximplant.com/blog/introducing-new-control-panel

The concept documentation for the Shared folder has been **removed** from the
site: `AddScenario`'s description still links to
`/docs/gettingstarted/basicconcepts/scenarios#shared-scenarios`, but that URL now
redirects to the current scenarios page, which contains no such section. The
Shared folder is undocumented legacy — the API blurb and that blog post are all
that survive.

## The probe — executed, both phases settled

`npm run vox:probe-binding` (`scripts/voximplant/probe-scenario-binding.ts`).
Subject: `RSVPPreview` (918268) — Shared and bound to no rule, both asserted at
runtime. Probe rule pattern `zzz-probe-never-matches`, appended after two `.*`
rules, deleted in a `finally` with the rule set read back and asserted.

### Phase 0 — `BindScenario` with application_id and NO rule

The control panel's action is "bind scenario to **application**", so an
application-only bind was the obvious candidate for the command behind it. The
reference says `rule_id` is "Required unless rule_name is provided", but that page
had already proved stale twice, so it was measured rather than assumed:

```
BindScenario(application_id, no rule): REJECTED code=147 "'rule_id' parameter is invalid."
```

A rule really is mandatory. `bindScenario()` in `mutations.ts` now takes `ruleId`
as optional so this question stays askable, but the answer is no.

### Phase A — `BindScenario` — AIRTIGHT

```
BindScenario raw response: {"result":1}
BindScenario result === 1        : YES
probe rule scenarios             : [RSVPPreview(918268)]
bind actually attached           : YES
app-scoped count                 : 1 -> 1
subject now app-scoped           : NO
```

The bind is **proven** to have taken effect (the rule lists the scenario), and
the scenario still does not appear under the application filter. So binding a
scenario to a rule inside an application does **not** move it out of the Shared
folder. v1's "no-error ≠ success" gap is closed: `result === 1` was asserted and
the attachment was read back.

### Phase B — `AddScenario` — SETTLED

```
AddScenario(application_id, no rewrite)  : REJECTED code=133 "Scenario name is not unique."
AddScenario(application_id, rewrite=true): REJECTED code=133 "Scenario name is not unique."
account-wide count: 11 -> 11    app-scoped count: 1 -> 1    rules: 8, verified unchanged
```

Error **133 = `SCENARIO_NAME_ISNT_UNIQUE`**, a documented first-class platform
error (`references.httpapi.errors`). **Scenario names are unique ACCOUNT-WIDE**,
spanning the Shared folder and every application. `rewrite` does not change this.

**This reverses the earlier hazard analysis.** Under voxengine-ci 36, `upload`
would *not* create a duplicate. Tracing the real 36.0.0 `upload` code
(`vox-scenario.service.js:158-226`) against this measurement gives two failure
modes, depending on whether the local metadata was migrated as the README says:

- **Metadata moved (the README's own instruction).** `stringDistScenarioMetadata`
  exists; `platformScenarioInfo` is `undefined` (the scenario is Shared). None of
  the three branches fires and the loop `continue`s. **Silent no-op** — upload
  reports success and deploys nothing. This is the dangerous one: a fix to
  `RSVPAgent` would appear to ship while the live scenario stays unchanged.
- **Metadata not moved, or after `init --force`.** The "brand-new scenario" branch
  fires → `addScenario` → error 133 → the repository catch swallows it and returns
  `undefined` → `throw ERR__SCENARIO_IS_NOT_ADDED`. **Loud failure.**

## The official CI guide — confirms the root cause, and supplies the missing step

`https://voximplant.com/docs/guides/voxengine/ci` (fetched 2026-09-14). Two lines
settle things Voximplant never says anywhere else:

> "Note that **when you create a scenario, it becomes shared**, so you will be
> able to access it from any application. Even if you delete all apps and all
> rules, the shared scenarios remain intact."

> "You can modify existing scenarios and create new ones ONLY in the
> **/voxfiles/scenarios/src** directory."

So the vendor's own CI guide states that CI-created scenarios are **shared by
design** — our root-cause analysis, confirmed from the source. It also still
documents the pre-36 layout (`voxfiles/scenarios/src`), i.e. **the official guide
has not been updated for voxengine-ci 36** and now contradicts the package README.

And the step that completes the migration:

> "it is suggested that you do not rename or delete existing apps, scenarios, and
> rules, only create new ones… **If you still need to rename or delete something,
> do it from the platform. But it is necessary to run
> `npx voxengine-ci init --force` after that** to make your local and remote
> (platform) versions consistent."

`init --force` is documented as a **re-sync after a platform-side change** — not
as a migration tool in its own right. That is exactly the shape of our procedure.

### Caution on `init --force` ordering

Run alone, **before** the platform-side move, it is destructive and useless here:
`projectCleanup()` wipes the local application and scenario trees, then
`projectInit()` re-pulls via `downloadScenariosByApplicationId` — which for this
account returns **1 of 11** scenarios (measured twice). Ten scenario sources would
be deleted locally, recoverable only from git. It is the correct **last** step and
a damaging first one.

## The vendor's own docs search settles it

Sources checked in this pass that had never been opened:

- **`voximplant-ai-agent-skills`** — Voximplant's official agent-skill package, installed
  locally at `.claude/plugins/cache/voximplant/`. Carries a warning worth keeping:
  *"Do not assume `SetRuleInfo` can rebind a rule to a scenario. It may accept
  `scenario_id` and return success without changing the binding."*
- **`docs.voximplant.ai`** — a SECOND documentation domain, LLM-oriented, separate from
  `voximplant.com/docs`, with its own `api-reference/management-api/` section.
- **`https://docs.voximplant.ai/_mcp/server`** — Voximplant's official docs MCP
  (`searchDocs`). Now registered in this project.

Asked directly whether a move operation exists, the vendor's own search answers:

> "**Voximplant does not provide a direct 'move' operation** to transfer a scenario
> from the Shared folder into a specific application via the API… If you have an
> existing scenario in the Shared folder that you want to move, the recommended
> approach is to **recreate it** under the target application using `AddScenario`
> with the `application_name`/`application_id` parameter … then bind it to the
> appropriate rule."

That is exactly the flow below. **No built-in migration command exists** — confirmed
from the vendor's side, not only by our probing.

### Two caveats on that answer — and one correction to an earlier overstatement

`searchDocs` returns an **LLM-generated answer with citations**, not the documentation
text itself. The two must not be conflated, and an earlier draft of this document did
conflate them. Corrected:

1. **The `rewrite: true` suggestion is the search tool's, not the documentation's.**
   The AddScenario reference — on both domains — says only:
   `rewrite` — *"Whether to rewrite the existing scenario"*. It makes **no** claim that
   `rewrite` resolves a Shared→application name collision. What we measured is narrower
   and still useful: `AddScenario(name, script, application_id, rewrite: true)` against a
   name held by a **Shared** scenario returns **133**. That is a real limit on the
   suggested workaround; it is **not** a documentation error, and it does not show
   `rewrite` is broken for its documented purpose (overwriting a scenario in the same
   scope), which we never tested.

2. **The CI page is stale, not wrong.** Two official Voximplant sources disagree about
   the file layout:
   - the published package README: *"Breaking change in 36.0.0 … 36.0.0+ →
     `/voxfiles/applications/<application-name>/scenarios/src/`"*
   - the docs site (both domains): *"You can modify existing scenarios and create new
     ones ONLY in the `/voxfiles/scenarios/src` directory"*

   The page described the truth accurately for ≤ 35 and has not caught up with a release
   three weeks old. Because the search tool is generated from that page, its 36 answer
   inherits the old layout. **For the 36 layout, trust the published package source** —
   `lib/domains/repositories/vox-scenario.persistent.repository.js:203-206` — which is
   what this document's layout table is taken from.

## A panel-free flow DOES exist — composed of documented primitives

No single API method moves a scenario. But three documented methods compose into
one, and the key that unlocks it is that **`SetScenarioInfo` can rename**:

| Primitive | What the live reference says |
| --- | --- |
| `SetScenarioInfo` | "Edits the scenario. You can edit the scenario's **name** and body." `scenario_name` — "New scenario name." |
| `AddScenario` | `application_id` — "Application ID to bind the scenario to"; `rule_id` — "The new scenario **binds to the specified rule**." |
| `BindScenario` | `bind` — "Whether to bind or unbind (set true or false respectively)" |
| `DelScenario` | "Deletes the scenario." |

Error 133 fires only because the name is taken. **Free the name and the block
disappears.** Routing rules bind scenarios by `scenario_id`, not by name
(`rules.metadata.config.json` stores ids), so renaming does **not** detach a
scenario from its rule — the rule keeps working across the rename.

### The sequence, per scenario (example: `RSVPAgent` 918450 on rule 1520915)

1. `SetScenarioInfo(scenario_id=918450, scenario_name='RSVPAgent-legacy')`
   Frees the name. Rule 1520915 still points at 918450 → **still serving calls.**
2. `AddScenario(scenario_name='RSVPAgent', scenario_script=<deployed text>,
   application_id=11107202, rule_id=1520915)`
   Creates the application-scoped scenario **and binds it to the rule in one
   call**. Name is free, so no 133.
3. `BindScenario(scenario_id=918450, rule_id=1520915, applicationId=11107202,
   bind=false)` — detach the legacy one.
4. `DelScenario(918450)` — remove it.

Then `npx voxengine-ci init --force` to re-sync local (the CI guide's prescribed
step after a platform-side change).

### The one exposure, stated plainly

Between steps 2 and 3 the rule has **two** scenarios bound, and the routing-rules
reference is explicit about what that means:

> "You can attach multiple scenarios to a single rule. In this scenario, the rule
> executes **all the attached scenarios sequentially within a single context**."
> — https://docs.voximplant.ai/platform/voxengine/routing-rules

So a call landing in that window (roughly one API round-trip) runs **both** the old
and the new scenario, in one context. The platform does not pick one — that is a
malfunction, not a harmless duplicate. For the outbound rules we control when calls
start; `incoming` (1494687) is the one that can be hit at any moment.

### PROVEN — Phase C, executed live 2026-09-14

```
SetScenarioInfo(918268 -> "RSVPPreview-legacy"): OK {"result":1}
rename landed                       : YES
scenario_id unchanged               : YES (918268)
still bound to its rule after rename: YES — rules bind by id, not name
AddScenario("RSVPPreview", application_id=11107202): OK {"result":1,"scenario_id":920386}
app-scoped count                    : 1 -> 2
account-wide count                  : 11 -> 12
```

Three things measured, none assumed:

1. **`SetScenarioInfo` renames and the `scenario_id` is preserved** (918268 throughout).
2. **A rename does NOT detach the scenario from its rule.** The probe rule still
   listed 918268 after the rename — rules bind by id, exactly as
   `rules.metadata.config.json` implied. This was the main risk and it is gone.
3. **Freeing the name unblocks `AddScenario(application_id)`** — error 133
   disappears and a genuinely application-scoped scenario is created.

Cleanup was complete and verified: the new scenario deleted, the original name
restored, the probe rule deleted, and **both** scenario sets read back and asserted
identical to the pre-probe state (11 account-wide, 1 app-scoped, 8 rules).

**The composition is still not documented by Voximplant as a migration procedure** —
the primitives are theirs, the sequence is ours. But it is now measured to work.

### The one thing this changes for the real migration

The application-scoped scenario gets a **new** `scenario_id` (918268 → 920386). So
unlike the control-panel action, this flow does not preserve the id, and each live
rule must be repointed. `AddScenario` accepts `rule_id` ("The new scenario binds to
the specified rule"), so creation and binding are a single call — which makes the
two-scenarios-bound window one API round-trip wide rather than two.

## Recommendation

**Do not build a migration script.** A complete procedure exists using only
built-ins, in this order:

1. **In the control panel**, right-click each scenario → bind it to
   `kalfa-rsvp.kalfarsvp.voximplant.com`. Seven scenarios:
   `ConsoleInbound` · `ConsoleDial` · `ConsoleCallMeNow` · `RSVP` · `RSVPAgent` ·
   `MeetingConfirmAgent` · `SalesCloseAgent`
2. **Verify from here** — `npm run vox:probe-binding` (dry run, read-only) prints
   the app-scoped list. It must go from 1 to 8.
3. Only then bump to 36.0.0 and run `npx voxengine-ci init --force`, which the
   official CI guide prescribes as the re-sync after a platform-side change. It
   will now find all the scenarios and lay out the new tree itself.
4. `npm run vox:upload -- --dry-run --rule-name OutCallAgent` (build only, no
   platform write) before any real upload.

Steps 1 and 3 are the vendor's own documented operations; nothing is
hand-written. Step 3 is destructive if run before step 1 — see the caution above.

### Claims that do not survive checking

- **"There is an `update` command."** There is not. The 36.0.0 binary registers
  exactly `.command('init')` and `.command('upload')`, and the README documents
  only `npx voxengine-ci init` and `npx voxengine-ci upload`.
- **"`init --force` migrates automatically."** Not for this account. It pulls only
  application-scoped scenarios, of which we have one. It is step 3, never step 1.

A hand-rolled API workaround is possible in principle — rename the Shared
scenario to free its name, `AddScenario` the app-scoped one, rebind the rule,
delete the old — but it is four live-telephony mutations per scenario against
one right-click that the platform supports natively. It was deliberately not
built.

**Rule 1494311 (`OutCall` → `RSVP`) still needs its own owner sign-off** — it is
the DTMF rule that must never be touched with the bridge.

There is also no deadline pressure: 35.1.0 works, `^35.0.0` cannot pick up 36,
and (see above) 36 fixes nothing security-wise.

## Current state — no change made

- `package.json` stays at `"@voximplant/voxengine-ci": "^35.0.0"`. The caret does
  **not** cross to 36, so there is no risk of picking it up accidentally.
- **Security WAS fixed, independently of the version question.** Scoped npm
  `overrides` now pin the Voximplant subtree to patched transitive deps —
  `axios@0.33.0`, `form-data@2.5.6` (under `@voximplant/apiclient-nodejs`) and
  `yaml@1.10.3` (under `@voximplant/voxengine-ci`). That chain audits clean;
  project totals went 18 → 13 advisories and **critical 1 → 0**. The rest of the
  tree is untouched (top level still resolves axios 1.20.0 / form-data 4.0.6 /
  yaml 2.9.0). Verified end-to-end: `voxengine-ci init` against the live account
  still downloads all 11 scenarios and 8 rules. Gates: tsc 0, lint 0, 212 tests.
- `voxfiles/` is untouched; the 35.x layout remains correct for the installed version.
- `.gitignore` already covers the 36.x layout via the global `dist/` pattern — no
  change needed there if we ever migrate.

## Incidental findings

- `KALFA.voxengine.js` exists locally but **not** on the platform.
- `VoiceAgentTest` exists on the platform (and in
  `.voxengine-ci/scenarios/dist/` metadata) but has **no local source**.
- `Outgoingcall-RSVPAI` (the only app-scoped scenario) is bound to no rule.
- **Docs-corpus drift:** `docs/voximplant/digest-management-api.md:99` records the
  `GetScenarios` name filter as "substring, case-insensitive". The live reference
  now says **"Exact match. Combines with scenario_id when both are passed. Use
  with application_id or application_name to limit the result to one
  application."** The corpus (captured 2026-07-19) is stale on this point.
- `ScenarioInfoType` — the `GetScenarios` result — carries `scenario_id`,
  `scenario_name`, `scenario_script`, `modified`, `parent`. It has **no
  `application_id`**, so a scenario's application cannot be read back from the
  result; it is only inferable from which `application_id` filter returns it.
- Comparing `voxfiles/scenarios/src/` against deployed text shows differences on
  6 scenarios, but these are tsc build-output formatting (statement reflow;
  comments are NOT stripped — `removeComments` is unset, so it defaults to false) — the platform holds built output, `src/` holds source. This
  is **not** evidence of source drift; a real parity check must compare
  `dist/` against deployed text.

- **HTTP concurrency vs the final callback (INFERRED, unmeasured).** The limits page
  states VoxEngine allows 3 active `httpRequestAsync` calls, queues the rest, and
  **silently drops whatever is still queued** when the session reaches Terminating;
  exactly one request may be issued from inside the Terminating handler. The three
  agents already reserve that one slot for the final `cb` callback and say so in
  comments (`RSVPAgent.voxengine.js:436-438`). There is **no evidence this has ever
  fired** on this account — no dropped-callback incident, no log. Recorded as a known
  mechanism, **not** acted on: changing teardown ordering on live telephony to
  pre-empt an unmeasured risk is not warranted.
- **Pipecat turn-detection: ruled out.** The smart-turn documentation scopes it to
  full-cascade (STT → LLM → TTS) flows. Our three agents are ElevenLabs
  speech-to-speech, where turn-taking lives inside the ElevenLabs agent
  (`turn_eagerness`, E-6). Not applicable — not a gap.
- **Unregistered-tool branch: fixed** (`voxfiles/scenarios/src/RSVPAgent.voxengine.js`,
  `MeetingConfirmAgent.voxengine.js`). Both returned with no `clientToolResult` frame at
  all; both now match `SalesCloseAgent`. See E-14 in
  `docs/voice-agent/rsvp-conversation-design.md`. **Deployed 2026-09-14** via
  `vox:upload:rsvpagent` and `vox:upload:meetingconfirm` — scenarios #918450 and #919799
  updated in place, same ids, no rule rebinding.
- **Precision: `vox:upload` is NOT blocked.** An earlier phrasing here and in memory said
  it was. The **upgrade to 36** is blocked; the **installed 35.1.0 uploads fine**, as the
  2026-09-14 deploy proved. Worth keeping straight — the two get conflated easily.
- **What the 35 upload flow actually does** (observed, 2026-09-14): wipes and recreates
  `voxfiles/scenarios/dist/`, builds only the scenario reached by `--rule-name`, downloads
  the platform copy, compares, and calls the update path on the **existing
  `scenario_id`**. No `AddScenario`, no duplicate name, no `BindScenario`. Note that
  `dist/` therefore holds only the most recently uploaded scenario — it is not a full
  build tree and cannot be used for an account-wide parity check.
- **Correction carried into E-12's wording.** The contract is that **omitting**
  `is_error` closes the WebSocket with 1008. A truthy `is_error` does not, and all three
  agents deliberately send one on their missing-token path. One comment in
  `RSVPAgent.voxengine.js` said "true/missing", contradicting its own code two lines
  below; corrected.
