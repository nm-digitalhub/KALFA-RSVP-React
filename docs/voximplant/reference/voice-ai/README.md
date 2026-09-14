# docs.voximplant.ai — ElevenLabs Agents + linked pages

Scraped 2026-09-14 with `node scripts/scraper-v1.mjs --only …` and converted by
`scripts/docs-json-to-md.mjs`. 13 pages: the ElevenLabs section plus every
in-content link it carries.

This is Voximplant's **second** documentation domain, distinct from
`voximplant.com/docs`. It is the one that covers the ElevenLabs connector; the
older domain does not.

## What is here

| Path | Why it matters to KALFA |
| --- | --- |
| `voice-ai-orchestration/elevenlabs/overview` | The connector's capability list and prerequisites |
| `…/inbound`, `…/outbound`, `…/function-calling` | Reference scenarios — directly comparable to `RSVPAgent.voxengine.js` |
| `api-reference/voxengine/elevenlabs/overview` | **The full module API**: 10 AgentsClient methods, 15 AgentsEvents |
| `api-reference/management-api/reference/scenarios/start-scenarios` | How we launch every outbound RSVP call |
| `platform/voxengine/routing-rules` | Multi-scenario rule semantics — see below |
| `platform/voxengine/secrets` | `getSecretValue`; secrets are per-application |
| `getting-started/network-options/whatsapp` | WhatsApp Business Calling, inbound and outbound |
| `platform/voxengine/phone-numbers`, `…/users`, `network-options/sip`, `…/web-mobile` | Entry points into an application |

## Findings worth acting on

**1. Confirms the voxengine-ci 36 migration hazard.** `routing-rules`:

> "You can attach multiple scenarios to a single rule. In this scenario, the rule
> executes **all the attached scenarios sequentially within a single context**."

So during the migration window where a rule has both the old and the new scenario
bound, **both run** — they are not alternatives and the platform does not pick one.
That is a malfunction, not a duplicate. See
`docs/voximplant/voxengine-ci-36-upgrade-blocked.md`.

**2. The 200-byte `customData` cap IS documented — correcting an earlier note here.**
`start-scenarios` mentions 200 only as the concurrent-HTTP-request limit, and reading
that page alone led to the wrong conclusion that the size cap was undocumented. The
`platform/voxengine/custom-data` page states it plainly:

> "There is a custom data function in the VoxEngine instance, where you can store a
> string of **up to 200 bytes** associated with the current JS session."

and separately, the same 200-byte cap applies to `Call.customData()`. So KALFA's
measured ~200-byte ctx cap is the documented platform limit, not an undocumented
quirk. Three different 200s live in these docs — concurrent HTTP requests, customData
bytes, and the SIP header field limit — which is how the confusion started.

**3. `VoxEngine.callWhatsappUser()` exists** — outbound WhatsApp Business Calling
from inside a scenario:

```js
const call = VoxEngine.callWhatsappUser({ number: "+15551234567", callerid: "15557654321" });
```

A calling path we do not use today.

**4. Our RSVPAgent is ahead of the official examples**, not behind: it uses 9 of the
10 documented `AgentsClient` methods (all but `webSocketId`) and handles 11 of the
15 `AgentsEvents`. Not handled, all diagnostic-only: `Unknown`, `HTTPResponse`,
`ContextualUpdate`, `InternalTentativeAgentResponse`. The official inbound example
logs the first two — cheap to add if a call ever fails opaquely.

**5. The official `ClientToolCall` pattern always answers.** Even an unrecognised
tool gets a `clientToolResult` carrying `{error: "Unhandled tool: …"}`, and the
handler guards on missing `tool_name`/`tool_call_id` before doing anything. Worth
holding next to our `save_rsvp` behaviour, which reports "queued" on every failure
path (see the `save-rsvp-queued-false-promise` note).

## Note on this capture

The scraper reads rendered text, so code appears as prose rather than in fenced
blocks, and the language of each block is not recoverable. Where a page shows the
same snippet twice (an excerpt and then the full scenario), that repetition is the
page's own.

For this site specifically there is a cleaner route: appending `.md` to any page URL
returns authored Markdown with real fenced code blocks, and appending `/llms.txt` to
any section returns its index. Prefer that when fidelity matters; the scraper is for
sites that do not publish Markdown.

Three hardcodings were fixed in the tooling while producing this (all of them made
the tools single-site): the crawl glob and the "external link" filter both named
workflowbuilder.io literally, and the content root assumed `<main>` — which on Fern
contains the whole navigation sidebar. Output went from 4,213 lines to 1,914 with no
content lost.
