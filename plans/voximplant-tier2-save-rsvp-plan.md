# Tier 2 — `save_rsvp` client tool: prove the RSVP is written to KALFA

## Goal (closes QA gap #1)
Today the ElevenLabs agent *talks* the RSVP but nothing writes it. The log for session
`6758629426` shows **no `ClientToolCall`, no webhook, no DB write** — the agent said "את מגיעה לבד"
without any proof KALFA recorded `status`/counts. Tier 2 makes the agent call a **`save_rsvp`** tool
that writes to KALFA and returns success, so the agent claims "נרשם" **only after** a confirmed write.

This also upgrades data richness: the existing pipeline is binary (`rsvp_digit: 1|2` → always
`adults:1, kids:0`, `call-result-processing.ts:105-113`). The conversational agent extracts **real
adults + children counts** — Tier 2 persists those.

## Architecture decision — **B: client tool via the Voximplant scenario** (recommended)
| | A. Server-webhook tool (ElevenLabs→KALFA) | **B. Client tool via scenario (ElevenLabs→scenario→KALFA)** |
|---|---|---|
| Scenario code | none | catches `ClientToolCall`, POSTs, returns `clientToolResult` |
| Auth of the write | must inject our `tok` into ElevenLabs' tool URL/headers (dynamic-var-in-tool — **unverified**) | scenario **already holds `tok`+`u`** — guaranteed |
| Exposure | ElevenLabs' servers call KALFA directly | all traffic stays inside Voximplant, same as ctx/cb |
| Reuses token model | partially | **fully** (same opaque per-call token as cb) |

**Chosen: B** — guaranteed to work with what we have, keeps auth server-side, reuses the cb token model
and the persist-then-process machinery. (A stays a future option if we later want the scenario dumb.)

Verified in the vendored typings (`typings/voxengine.d.ts`):
- `ElevenLabs.AgentsEvents.ClientToolCall` (6257) → event `data.payload` carries `{ tool_name, tool_call_id, parameters }` (same `{customEvent,payload}` envelope seen in the live log).
- `AgentsClient.clientToolResult(parameters)` (6178) → sends the result back so the LLM can continue.

---

## Part 1 — KALFA endpoint `POST /api/voximplant/agent-tool/rsvp/{token}`
New file `src/app/api/voximplant/agent-tool/rsvp/[token]/route.ts`, **modeled line-for-line on
`cb/[token]/route.ts`** (token lookup, fail-closed rate limit, body cap, generic 404s, persist-then-process).
Differences: a new Zod body schema and a synchronous best-effort write so the agent gets a truthful ok/fail.

```ts
// New Zod schema — src/lib/validation/voximplant.ts (add beside voxCallbackSchema)
export const voxSaveRsvpSchema = z.strictObject({
  attending: z.boolean(),
  adults: z.number().int().min(0).max(50),
  children: z.number().int().min(0).max(50),
  tool_call_id: z.string().max(128).nullish(), // echoed back in clientToolResult; never trusted for identity
}).refine((v) => !v.attending || v.adults + v.children >= 1, {
  message: 'attending requires at least one person', path: ['adults'],
});
export type VoxSaveRsvp = z.infer<typeof voxSaveRsvpSchema>;
```

Route flow (reusing cb's guards verbatim):
1. rate-limit `vox-rsvp:{fp}:{ip}` fail-closed; body cap; token length check.
2. `getCallAttemptByAccessToken(token)` → 404 on miss; reject expired (`token_expires_at`).
3. Parse `voxSaveRsvpSchema` → 400 on mismatch.
4. **Persist durably** to `webhook_inbox` `{ provider:'voximplant', event_kind:'call_rsvp',
   dedupe_key:'vox-rsvp:{attemptId}', message_id: attemptId, payload }` (idempotent; a re-call in the
   same conversation with the SAME values is a no-op — see "corrections" below).
5. **Best-effort synchronous process** (like cb's synchronous `processCallResult`): call
   `processCallRsvp(attemptId, body)`. Return `{ ok:true }` (200) if the write succeeded, else `{ ok:false }`
   (still 200 — it is durably queued for the drain). The agent uses `ok` to decide its wording.

```ts
// src/lib/data/call-result-processing.ts — new export processCallRsvp (mirrors the completed-path side effects)
export async function processCallRsvp(attemptId: string, body: VoxSaveRsvp): Promise<{ ok: boolean }> {
  const attempt = await getCallAttemptById(attemptId);
  if (!attempt?.guest_id) return { ok: false };
  const rsvpToken = await getGuestRsvpToken(attempt.guest_id);
  if (!rsvpToken) return { ok: false };
  const status = body.attending ? 'attending' : 'declined';
  const outcome = await submitRsvp(rsvpToken, {
    status,
    adults: body.attending ? body.adults : 0,
    kids: body.attending ? body.children : 0,   // submitRsvp param is `kids` (verified rsvp.ts:156)
  });
  if (!outcome.ok) return { ok: false };
  if (!outcome.unchanged) {
    await recordRsvpFromCall(attempt.event_id, attempt.guest_id, status, attemptId);
  }
  // Billing/interaction stay on the call-COMPLETED path (per-reached, once) — NOT re-billed here.
  return { ok: true };
}
```
> **Corrections handling:** if the guest corrects the count mid-call, the agent calls `save_rsvp` again
> with new values. `submitRsvp` is idempotent-by-value (last write wins on the guest's RSVP row), so the
> latest confirmed count is what persists. The `dedupe_key` must therefore include a value hash **or** we
> drop the inbox dedupe for this kind and rely on `submitRsvp` last-write-wins. **Decision needed (D1).**

## Part 2 — ElevenLabs agent config: add the `save_rsvp` client tool
PATCH the agent `conversation_config.agent.prompt.tools` (currently `[]`) to add ONE client tool:
```jsonc
{
  "type": "client",
  "name": "save_rsvp",
  "description": "שמור את אישור ההגעה של האורח לאחר אישור סופי. קרא לכלי זה רק אחרי שהאורח אישר מפורשות את המספרים.",
  "parameters": [
    { "id": "attending", "type": "boolean", "description": "האם האורח מגיע", "required": true },
    { "id": "adults",   "type": "integer", "description": "מספר המבוגרים", "required": true },
    { "id": "children", "type": "integer", "description": "מספר הילדים",   "required": true }
  ]
}
```
Prompt addition (step 3.5, after the read-back confirm): *"רק אחרי אישור מפורש, קרא/י ל-`save_rsvp` עם
המספרים. אם הכלי החזיר הצלחה — אמור/י 'מצוין, אישור ההגעה נרשם'. אם נכשל — אמור/י 'רשמתי, נעדכן במערכת' בלי
להבטיח שנשמר."* (Only THEN may the agent claim it was saved — fixing gap #1's root cause.)
> Exact ElevenLabs `parameters` schema shape (array-of-objects vs json-schema object) must be confirmed
> against the current convai agent API before PATCH — **verify, don't assume (D2)**.

## Part 3 — VoxEngine scenario: handle `ClientToolCall`
In `VoiceAgentTest.voxengine.js` (and later the prod `RSVP` scenario), after `createAgentsClient`, add:
```js
agent.addEventListener(ElevenLabs.AgentsEvents.ClientToolCall, (e) => {
  const p = (e.data && e.data.payload) || {};
  if (p.tool_name !== 'save_rsvp') return;
  const args = p.parameters || {};
  // Net.httpRequestAsync — POST to our token-scoped endpoint (scenario already holds tok + u)
  Net.httpRequestAsync(u + '/api/voximplant/agent-tool/rsvp/' + tok, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },   // D3: OBJECT, not array (HttpRequestOptions.headers)
    postData: JSON.stringify({
      attending: !!args.attending, adults: Number(args.adults) || 0,
      children: Number(args.children) || 0, tool_call_id: p.tool_call_id,
    }),
  }).then((r) => {
    let ok = false;
    try { ok = r.code === 200 && JSON.parse(r.text || '{}').ok === true; } catch (_e) {}  // D3: .code + .text
    agent.clientToolResult({ tool_call_id: p.tool_call_id, result: ok ? 'saved' : 'queued' });
  }).catch(() => {
    agent.clientToolResult({ tool_call_id: p.tool_call_id, result: 'error' });
  });
});
```
> **D3 RESOLVED** (typings verified): `Net.httpRequestAsync(url, options): Promise<HttpRequestResult>`;
> `HttpRequestOptions.headers` is an **object** `{ 'Content-Type': ... }` (NOT an array); result exposes
> `.code` (HTTP/internal status) + `.text` (body). `AgentsClient.clientToolResult(parameters: Object)`
> (typings 6178) — envelope `{ tool_call_id, result }` per ElevenLabs client_tool_result docs.
Deploy via `voxengine-ci upload --application-name kalfatest --rule-name VoiceAgentTest`.

---

## Security & idempotency (reused, not reinvented)
- **Auth:** identical to cb — the opaque per-call `access_token` in the path; identity is the resolved
  `call_attempts` row, never the body. `tool_call_id`/params are never trusted for identity.
- **Durability:** persist-then-process into `webhook_inbox`; the existing 1-min drain retries on failure,
  so a transient DB error never loses the RSVP. Requires wiring `event_kind:'call_rsvp'` into the drain's
  dispatch (`processWebhookEvent`) → `processCallRsvp`.
- **No double-billing:** billing stays only on the call-completed path (`writeReach`, per-reached, once).
  `save_rsvp` writes ONLY the RSVP answer/counts.
- **Rate limit + body cap + generic 404** copied from cb.

## Risks / open decisions
- **D1 — corrections dedupe (OPEN, your call):** include a value-hash in `dedupe_key` (each distinct count is
  stored) or drop inbox dedupe for this kind and rely on `submitRsvp` last-write-wins? *(Recommend: value-hash — durable + idempotent.)*
- **D2 — ElevenLabs tool `parameters` schema (verify at PATCH time):** the `type:'client'` tool shape above is
  the documented convai form; confirm array-of-params vs json-schema-object against the live convai agent API in the
  same PATCH that adds the tool. Low risk — a 400 tells us immediately, exactly like the `tts`-block lesson.
- **D3 — RESOLVED** (typings verified above): headers=object, result `.code`+`.text`, `clientToolResult({tool_call_id,result})`.
- **D4 — where the tool runs:** test on `kalfatest`/`VoiceAgentTest` first; port to the prod `RSVP`
  scenario + prod agent only after a clean live test.
- Not a go-live flip: this is still behind `VOXIMPLANT_LIVE_CALLS` + `outreach_enabled`; B1 consent still blocks prod calls.

## Verification
- `npm run lint` · `npx tsc --noEmit` · focused tests (`voximplant-routes.test.ts`, `call-result-processing.test.ts`
  + new `agent-tool-rsvp` cases) · `npm run build`.
- New tests: token miss → 404; expired → 404; bad body → 400; valid attending{adults,children} →
  `submitRsvp` called with `{status:'attending',adults,kids:children}`; declined → `{status:'declined',adults:0,kids:0}`;
  retry idempotent; corrections last-write-wins.
- Live: one approved test call on kalfatest → agent confirms → `save_rsvp` fires → pull session log
  (expect `ClientToolCall` + our 200) → verify the guest's RSVP row shows the confirmed counts.

## Build order (each gated by approval)
1. Part 1 (endpoint + schema + `processCallRsvp` + drain wiring + tests) — pure code, dark-safe.
2. Part 2 (agent tool config PATCH on kalfatest) + Part 3 (scenario handler + deploy).
3. One approved live test → verify DB write → then port to prod scenario/agent.

---

## Appendix — Pronunciation track (SEPARATE from Tier 2; fixes "זהבה"→"זה אבא")
Verified via ElevenLabs docs (hebrew-tts-specialist). This is an independent quality fix, not a save-RSVP dependency.
- **Phoneme/IPA is NOT reliable on `eleven_v3_conversational`:** the agents doc whitelists only literal
  `eleven_v3` (+ `eleven_flash_v2`) for phoneme tags; the conversational variant is **unconfirmed** → do not ship IPA-only.
- **Alias replacement works on every model** (pre-TTS text substitution) — the safe path.
- **Per-conversation dictionary override is NOT supported** (only `voice_id`/`stability`/`speed`/`similarity_boost`
  are overridable via `conversation_initiation_client_data`) — so a per-call dictionary swap is impossible.
- **Recommended for arbitrary dynamic names: inject a niqqud-vocalized name as `{{guest_name}}` at ctx-build**
  (e.g. `זְהָבָה`), model-independent, scales to any name, no dictionary needed. Optional backstop: a small
  agent-level **alias** dictionary of top Israeli names (`POST /v1/pronunciation-dictionaries/add-from-rules` →
  bind via `conversation_config.tts.pronunciation_dictionary_locators`).
- **UNVERIFIED-LIVE (biggest thing to test first):** whether ElevenLabs Hebrew actually honors niqqud combining
  marks (VERIFIED only for Google he-IL `say()`, a different engine — see memory `voximplant-say-no-ssml`).
  One controlled test call injecting `זְהָבָה` vs `זהבה` resolves it. IPA `/zehaˈva/` if we later prove phonemes work.
