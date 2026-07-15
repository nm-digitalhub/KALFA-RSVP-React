# KALFA RSVP Agent — Test Suite (ElevenLabs Agent Testing)

Agent: `agent_9701kxj3n54ye518a3s518cexd48` ("KALFA RSVP Preview (he)").
Each `*.json` is a **validated `POST /v1/convai/agent-testing/create` request body** — ready to
send via API or paste into the dashboard's "Edit as JSON". Structure verified empirically against
the live API on 2026-07-15 (create + run + read-result for a simulation and a tool test; create+delete
for the llm and verify_absence variants). See `../agent-testing-methodology.md` for the full method.

## Design rule (why mostly simulation)
A **simulation** test generates the whole multi-turn conversation *dynamically* from a persona
(`simulation_scenario`) — we do NOT hand-write `chat_history`. This is the correct default: it tests
the agent's real decision-making, not a scripted transcript. Hand-written `chat_history` is used ONLY
in unit tests, where we deliberately pin the exact turns to isolate one behavior (a tool call or a
single response).

Every simulation here uses `tool_mock_config.mocking_strategy = "all"` so **no real KALFA DB write /
DNC insert / owner notification happens** during testing. `fallback_strategy = "raise_error"` makes any
unexpected real-tool call fail loudly instead of hitting production.

## Simulation tests (persona-driven, primary)
| File | Catalog | What it proves |
|------|---------|----------------|
| sim-01-happy-path-confirm | S-001/015/035/053 | attending → asks adults+children → read-back → save_rsvp(attending,2,1) |
| sim-02-decline | S-019/020 | decline recorded gracefully, no pressure, no count |
| sim-03-maybe | S-018 | "אולי" → no pressure, maybe/WhatsApp path |
| sim-04-optout-dnc | S-031 | "תסירו אותי" → mark_dnc + polite end |
| sim-05-wrong-number | S-003/011 | wrong number → apologize, no detail leak, no save |
| sim-06-proxy-spouse | S-004 | spouse is an authorized proxy → flow continues |
| sim-07-two-strike-fallback | S-032/033 | unclear ×2 → WhatsApp fallback, no infinite loop |
| sim-08-robot-disclosure | S-075 | honest AI self-identification, then continue |
| sim-09-anti-hallucination-parking | S-090 | unknown logistics → defer to owner, never invent |
| sim-10-sensitive-bereavement | S-080 | condolences, stop, no upsell/retry |
| sim-11-count-correction | S-056 | read-back correction → save reflects last value |
| sim-12-hostile-then-optout | S-078→S-031 | de-escalate → offer removal → mark_dnc |
| sim-13-knowledge-boundary | S-086/116 | answer known ctx facts, refuse to invent unknowns |

## Unit tests (pinned chat_history, surgical)
| File | Type | What it proves |
|------|------|----------------|
| unit-tool-save-attending | tool | after read-back confirm, save_rsvp is called with attending / 2 / 1 |
| unit-tool-mark-dnc | tool | "תסירו אותי" triggers the mark_dnc tool |
| unit-tool-no-premature-save | tool | a single unclear word does NOT trigger save_rsvp (`verify_absence`) |
| unit-llm-honesty-parking | llm | parking answer is deferred, never fabricated |
| unit-llm-no-cost | llm | reassures no cost/obligation, asks for no payment/ID |

## RESOLVED — the "save_rsvp not called" failure was a TEST defect, not an agent bug (2026-07-15)
The initial `unit-tool-save-attending` failure (*"Expected exactly 1 tool call, but found 0"*) was traced to a
**missing `tool_mock_config`**: a client tool is not invokable in the tool-unit harness without it, so the test
failed **regardless of LLM** (verified identical under gemini-2.5-flash / gpt-4o / claude-sonnet-4 via
`agent_config_override`). The agent is correct: with `tool_mock_config` the tool tests **pass** (save_rsvp fires
`adults=2,children=1`; mark_dnc fires; no-premature-save holds), and `sim-01` happy-path **passes** under the
current gemini LLM. **All three `unit-tool-*.json` now include `tool_mock_config` (mocking_strategy:"all").**
No LLM swap is needed for tool-calling. See methodology §3B for the rule: every client-tool unit test MUST
include `tool_mock_config`.

## Run (see methodology for full recipes)
```bash
# create every test, capture ids
for f in docs/voice-agent/tests/*.json; do
  curl -s -X POST -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
    --data @"$f" https://api.elevenlabs.io/v1/convai/agent-testing/create
done
# run a batch of test ids against the agent
curl -s -X POST -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"tests":[{"test_id":"test_..."},{"test_id":"test_..."}]}' \
  https://api.elevenlabs.io/v1/convai/agents/agent_9701kxj3n54ye518a3s518cexd48/run-tests
# poll the returned invocation id
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" \
  https://api.elevenlabs.io/v1/convai/test-invocations/{invocation_id}
```
