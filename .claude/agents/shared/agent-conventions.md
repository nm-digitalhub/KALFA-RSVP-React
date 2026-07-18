# Agent-authoring conventions — kalfa.me

Distilled 2026-07-18 from the 4 shipped voice agents, Anthropic's sub-agents/skills
docs, and superpowers writing-skills v6.1.1. Follow these when creating or editing
any `.claude/agents/*.md` here.

## Frontmatter

- `name`: kebab-case = filename.
- `description`: third person, **trigger-first** — open with the expert role, then
  "Use when… / Trigger for:" packed with concrete situations, error codes, and
  Hebrew user phrases (אישורי הגעה, תמלילים…). End with an explicit boundary +
  handoff sentence naming the sibling agent. NEVER summarize the workflow (tested:
  agents then skip the body). ≤1024 chars aim.
- `tools`: allow-list scoped to the job. Advisory/review agents: read-only
  (`Read, Grep, Glob, Bash, WebFetch, WebSearch`). Builders add Write/Edit.
  Every agent gets WebFetch + WebSearch (dynamism principle).

## Body structure (in order)

1. `# <Title> — kalfa.me` + one-paragraph role ("N disciplines, one owner").
2. **Phase 0 — currency check (BLOCKING)**: verify against LIVE sources before
   acting (ctx7 / official docs / `node_modules/next/dist/docs` / supabase MCP /
   nevo). Never rely on training data or stale references.
3. **This repo — authoritative facts**: real file paths, IDs, contracts. "Verify
   against code, not memory."
4. Phased workflow with explicit gates ("never skip / reorder").
5. **Hard rules** (compliance, secrets, quiet hours, production discipline).
6. **Boundary/handoff** section naming sibling agents (the agents form a mesh).

## Doctrine

- Evidence-first: tag every embedded fact `VERIFIED-LIVE <date>` / `DOCS-ONLY` /
  `DISPROVED-LIVE`. Live-verified behavior beats documentation until re-checked.
- Two knowledge layers, structurally separated: general domain knowledge vs.
  `references/kalfa-application.md` (how it applies to THIS system's RSVP flows).
  Answers must say which layer they stand on.
- Business facts (prices, channels, tracks, policy) live in the admin DB — never
  in agent files.
- References = URLs + access techniques (see `shared/sources-catalog.md`), not
  pasted content that goes stale. An agent that disproves one of its own
  reference facts must propose the file update.
- Length target ~100–160 lines. Heavy material → `references/` (one level deep,
  linked directly). Hebrew for user-facing trigger terms; answer in Hebrew when
  the user writes Hebrew.

## Eval discipline (Iron Law)

No agent/skill ships without: RED (baseline run WITHOUT it, failures captured) →
GREEN (same tasks WITH it) → routing eval (~10 should/shouldn't-trigger prompts
judged against ALL agent descriptions, near-misses included) → description tuned
from misses. Re-run when editing.
