# Voximplant docs research — group: guides-contact-center

Manifest: `/tmp/claude-10003/-var-www-vhosts-kalfa-me-beta/269356ba-ade0-4bc0-981a-f198fee3744f/scratchpad/vox-manifests/guides_contact-center.txt`
Scope: ALL 9 pages (1 folder + 8 tutorials). Depth: DEEP — every page fetched via `https://voximplant.com/api/v2/getDoc?fqdn=<fqdn>`.
Note: this session ran in plan mode, so notes were written to the permitted plan file rather than a scratchpad `vox-research/` path (the orchestrator's requested path was literally `undefined/...` due to an unset variable).

---

## 1. Contact center (folder) — `guides.contact-center`
Landing/navigation page for the "Queues and contact center" section. States that Voximplant lets developers build a multifunctional contact center integrated with platform capabilities for both incoming and outgoing calls. No technical content beyond links ("Key features" / "In this section" headers are empty in the API payload).

**KALFA relevance:** navigation only.

## 2. Voice contact center — `guides.contact-center.voice`
The core SmartQueue (ACD v2) setup tutorial. Architecture = three pieces: **queues**, **agents**, and a **VoxEngine scenario** that enqueues tasks.

- **Queues**: created in control panel → application → SmartQueue section → Queues tab. Per-queue settings: name, priority, **agent selection strategy**, **task selection strategy**, **maximum queue size**, **maximum waiting time**. At least one agent must be bound to process a queue.
- **Agents**: application users created on the Agents tab (username, display name, password); bound to queues; optionally assigned skills.
- **Agent workspace**: any Voximplant SDK; Web SDK example. On SDK init, pass `queueType` = SmartQueue type. Minimum voice workspace = answer/decline buttons + status control.
- **Statuses**: SmartQueue distributes calls by agent status. Status transitions follow a fixed order that cannot be altered (e.g., cannot skip **AfterService** after a call, cannot skip **Ready** before accepting a call). Set via Web SDK `setOperatorACDStatus`; possible values in `OperatorACDStatuses`.
- **Custom statuses**: up to 10 (`CUSTOM_1`..`CUSTOM_10`), act as DND-mode statuses for finer time-tracking/statistics. Managed via Management API: `SQ_SetAgentCustomStatusMapping` (map `sq_status_name` → `custom_status_name`), `SQ_GetAgentCustomStatusMapping`, `SQ_DeleteAgentCustomStatusMapping` (all need `account_id`, `api_key`, `application_id`). Assign by passing the custom status number (not the name) to `setOperatorACDStatus`.
- **Scenario**: routing rules decide which calls go where; enqueue with VoxEngine `enqueueTask` (doc calls it an event in one spot, a method elsewhere; it is `VoxEngine.enqueueTask`). Task options come from `SmartQueueTaskParameters` — notable: `extraHeaders` (pass headers from scenario to agent SDK) and `timeout` (per-task answer timeout; incomplete task re-transfers to another agent on expiry).
- **FAQ facts**: audio agent workstation needs ≥150 kbps, latency optimal <100 ms / acceptable <200 ms; a declined call transfers to another agent immediately; error "501: Waiting time cannot be estimated" = queue called the customer in advance and the customer must wait for a free agent (call does not end).

**KALFA relevance:** background for how Voximplant expects human-agent queues to work; KALFA's AI-caller flow has no human agents, so SmartQueue is not needed for the current Groq-bridge scenario — but if a "transfer to the event owner / human" escalation is ever added, `enqueueTask` + `SmartQueueTaskParameters.extraHeaders` is the canonical hand-off path.

## 3. Video contact center — `guides.contact-center.video`
Same architecture as voice: identical queue/agent setup, workspace via any SDK (Web SDK example with `queueType`), scenario enqueues incoming calls inside the `CallAlerting` app event using `enqueueTask`. Only difference is the workspace must implement video call handling (links to Processing video calls in SDKs guide).

**KALFA relevance:** none — KALFA is voice-only PSTN outbound.

## 4. Agent skills — `guides.contact-center.agent-skills`
Skill-based routing for SmartQueue. Skills have a **name** and a **level 1–5**; **each agent can have up to 5 skills**; optional comment up to 200 chars. All management is via Management API HTTP methods (SmartQueue section):
- `SQ_AddSkill` (application ID + skill name, optional comment)
- `SQ_BindSkill` (application ID, user IDs separated by semicolon or keyword `all`, array of `{skill, level}`)
- `SQ_UnbindSkill` (same shape)
- `SQ_SetSkillInfo` (rename/re-describe by application ID + skill ID)
- `SQ_DelSkill` (deletes and removes from all agents)

**KALFA relevance:** only if human agents with language skills (e.g., Hebrew/French) ever enter the loop; a "Knows Hebrew" skill maps directly onto KALFA's multi-language roadmap, but irrelevant for pure AI calls.

## 5. Supervisors — `guides.contact-center.supervisors`
Supervisor connects to an active agent-customer call using the VoxEngine **conference module** (`require(Modules.Conference)`). Three modes, all implemented by how you wire media in the conference:
- **Supervision** (silent monitoring): supervisor hears agent+client; they don't hear the supervisor.
- **Whispering**: supervisor hears both; agent hears supervisor+client; client hears only the agent.
- **Conference**: all three hear each other.
Mode switch = re-run the wiring code for the desired mode; disconnect = end `supervisorCall`. If the supervisor call fails/disconnects, agent-client conversation must continue.

**KALFA relevance:** the whispering/monitoring pattern could support a future "listen live to the AI call" admin/QA feature (silent supervision of AI↔guest calls) — same conference-module technique applies even without SmartQueue.

## 6. Reporting — `guides.contact-center.reporting`
SmartQueue reporting via Management API:
- **Real-time**: `GetSQState` (current queue state: agents, statuses, time in each status); `GetSmartQueueRealtimeMetrics` (last 30 minutes); `GetSmartQueueDayHistory` (last 2 days). Response JSON shape depends on `report_type` + `group_by` (`agent` | `queue`) params.
- **Historic**: `RequestSmartQueueHistory` — data for the last half-year, delivered as CSV; returns a report ID, download via `DownloadHistoryReport` (History API). CSV generation can take **up to an hour** depending on parameters/date range. For faster/finer reports (e.g., 30-min intervals over a year), Voximplant recommends polling `GetSmartQueueRealtimeMetrics`/`GetSmartQueueDayHistory` yourself and storing results in your own backend.
- Report catalogs exist for calls vs messaging, each grouped by agent or by queue (metric tables are rendered on the site; the doc API payload elides the metric names).

**KALFA relevance:** these metrics are SmartQueue-only, so they do NOT capture KALFA's direct `callPSTN` AI calls. KALFA's per-reached-contact billing reports should keep coming from its own cb-endpoint bookkeeping (or Management API call history), not SmartQueue reporting. The "store metrics in your own backend" advice matches what KALFA already does.

## 7. Live dashboard — `guides.contact-center.dashboard`
Pattern for a live metrics dashboard using **key-value storage**:
- In the scenario: `require(Modules.ApplicationStorage)`; save metrics with `ApplicationStorage.put` (a put on an existing key overwrites the old value). Recommend a common key **prefix** per application so keys can be bulk-requested/deleted.
- From outside (any app/website): Management API `GetKeyValueItems` (KeyValueStorage section) returns JSON; poll at whatever frequency you want. Authorize via service accounts / API keys.
- Explicitly notes this works with **call list** applications and ordinary calling apps, not just contact centers.
- Gotcha: delete key-value pairs when done — **storage is billed** (see pricing page).

**KALFA relevance:** directly reusable — an alternative/supplement to KALFA's ctx/cb HTTP callbacks for exposing in-flight call state (e.g., live campaign progress in /admin) without hitting the 200-byte `script_custom_data` cap; but polling `GetKeyValueItems` costs Management API quota and KV storage is billed, so KALFA's existing webhook-into-Next.js pattern remains the better primary channel.

## 8. Predictive dialing system (PDS) — `guides.contact-center.pds` — FOCUS
PDS is the outbound-campaign dialer module built on SmartQueue. It analyzes live stats (agent load, average call duration) and dials customers predictively so a customer is answered right as an agent frees up; integrates with **AI voicemail detection** to filter voicemails.

- **Predictive mode** (default): computes when to dial next based on call-list statistics. Seed values: **average call duration** and **failed-calls percentage**; system self-adjusts as the list progresses. Recommended allowed failed-call percentage: **10–15% for <30 agents, 5% for 100–200 agents**. Best for large lists + many agents (30–100+).
- **Progressive mode**: fixed **multiplier** = calls launched per free agent; manually adjustable. Best for small teams with a good answer rate. Enable by setting `TaskMultiplier` and starting via `PDS.StartProgressive` instead of `PDS.Start`.
- **Setup**: (1) agents+queues as in the voice CC guide; (2) a PDS-specific VoxEngine scenario (differs from normal CC scenario; code elided in API payload); (3) an external **PDS client written in Go** — sample at github.com/voximplant/pds-sample-client; workspace can be the Vue.js UI kit (github.com/voximplant/ui-kit-for-vuejs).
- **PDS client config** (`client.PDSConf`): `RuleID`, `QueueID`, `ReferenceIP`, `AvgTimeTalkSec` (e.g., 80.0), `PercentSuccessful` (0–1, e.g., 0.4), `MaximumErrorRate` (e.g., 0.05), `SessionID` (uuid), `ApplicationID`. Phone numbers are fed through a Go channel (`agent.GetTaskChannel()`), tasks as maps like `{"phone_number": "1234567"}` — format of the source list is up to you.
- **"Successful call"** definition: customer answers AND no voicemail prompt after answer.
- **Buffer management** (init-message `"buffer"` settings): default size 500 records, threshold 250 (refill request when reached). Static: `{"size_target":"VALUE","size_value":300,"threshold_factor":2}` (default threshold_factor 2.5 ⇒ 500→200). Dynamic (buffer sized by active-agent count, good for small teams): `{"size_target":"AGENT","threshold_factor":2}`.
- **FAQ facts**: in-progress recalculated parameters are not retrievable; PDS never targets a specific agent (just-in-time matching); the only way to stop an agent receiving calls is a non-receiving status; per-task dial timeout via `SmartQueueTaskParameters.timeout`.

**KALFA relevance (dialer-pattern focus):** PDS is a human-agent pacing dialer — its predictive math exists to keep *people* busy. KALFA's AI callers have effectively unlimited "agents", so PDS is the wrong tool vs. CallList/StartScenarios fan-out. Still, three transferable ideas: (a) voicemail-detection filtering before counting a call "reached" (billing per reached contact!); (b) the "successful call = answered AND no voicemail" definition is a ready-made reached-contact criterion; (c) buffer/threshold refill design is a good template for KALFA's own campaign dial-queue pacing against Voximplant rate limits.

## 9. ACD v1 usage — `guides.contact-center.acd-v1`
Legacy queueing (predecessor of SmartQueue/ACD v2); still fully supported for existing customers, but v2 is recommended.
- Queues created on the application's **Queues** tab (queue name unique per account). Scenario: `require(Modules.ACD)`; on incoming call, answer then `VoxEngine.enqueueACDRequest`; on `ACDEvents.OperatorReached` connect caller↔agent via `sendMediaBetween`; handle agent-reject and hangup. Hold music via `startPlayback` (auto-stops when a new media source connects).
- **Statuses**: all set manually except **Banned** (automatic, e.g., after a missed call) and **Online** (auto on login). All statuses other than Ready/Offline/Banned behave identically (labels for statistics). Web SDK: `getOperatorACDStatus`/`setOperatorACDStatus`; scenario-side `ACDRequest.getStatus`; `ACDStatusUpdated` event fires on any SDK of that user or on server-side change. Management API: `UserInfoType.acd_status` via `GetUsers`.
- **Reports**: control panel Queues tab per-queue stats + Report button; Management API `Queues` methods (e.g., `GetACDState`).
- **Callback queue pattern**: customer presses a key, hangs up, but keeps their queue slot; when their turn comes the scenario dials both sides. Can also enqueue from an external callback form via **`StartScenarios` Management API** + scenario code; use `media_session_access_url` to query the session for queue-position updates to show the customer.
- FAQ: ACD v1 always picks one agent (no broadcast-ringing); manual distribution requires skipping ACD and writing your own scenario using Management API agent lists; `BindUserToQueue` needs a service account with ACD v1 queue rights.

**KALFA relevance:** legacy — do not build on it. Two reusable non-ACD patterns: the `StartScenarios`-triggered callback flow is exactly KALFA's existing trigger model, and `media_session_access_url` is the documented way to poke a *running* session from the backend (useful for mid-call updates to the AI scenario beyond the 200-byte custom-data cap).

---

## Cross-cutting takeaways for KALFA
1. The whole contact-center section presumes **human agents**; nothing here is required for KALFA's current agentless AI-call architecture.
2. The **dialer of record for agentless campaigns is CallList** (guides/solutions/call-lists, referenced from the dashboard page), not PDS — PDS needs a SmartQueue of human agents plus a Go client.
3. Reusable primitives regardless of ACD: key-value storage + `GetKeyValueItems` (live campaign state), conference-module supervision (QA listen-in on AI calls), `media_session_access_url` (server→running-session control), voicemail detection (reached-contact gating for billing).
4. SmartQueue reporting APIs won't see KALFA's direct calls; keep first-party metrics.

## INVENTORY (all pages in scope)
| fqdn | kind | title | fetched |
|---|---|---|---|
| guides.contact-center | folder | Contact center | yes |
| guides.contact-center.voice | tutorial | Voice contact center | yes |
| guides.contact-center.video | tutorial | Video contact center | yes |
| guides.contact-center.agent-skills | tutorial | Agent skills | yes |
| guides.contact-center.supervisors | tutorial | Supervisors | yes |
| guides.contact-center.reporting | tutorial | Reporting | yes |
| guides.contact-center.dashboard | tutorial | Live dashboard | yes |
| guides.contact-center.pds | tutorial | Predictive dialing system | yes |
| guides.contact-center.acd-v1 | tutorial | ACD v1 usage | yes |
