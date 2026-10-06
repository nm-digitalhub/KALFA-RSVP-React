# Fleet: design plugin + Claude Design for content roles — plan v3 (2026-09-27)

Status as of this revision:
- **Part 1, the design plugin: DONE by the coordinator at the owner's request.** It is
  uncommitted (§2).
- **Part 2, Artifact and claude-design: PROPOSAL.** Nothing applied, no test run executed by
  this investigation.

v3 reflects three owner decisions:
- The plugin's MCP servers are **not** blocked.
- Agents should **design** with Claude Design, not only critique.
- `tier0.settings.json` itself carries the plugin and all 7 skills.

Every claim is tagged MEASURED (file:line / command output) or INFERRED.

---

## 1. Short answer

- **The design plugin: working in the fleet now.**
  - The coordinator edited tier0 (§2).
  - The coordinator's own preflight used the fleet flags and haiku. All 7 `design:` skills
    loaded, the `Skill` tool was usable, and `curl` was still denied.
  - The loaded skills are what prove tier0 was read. A curl denial alone would not prove it,
    because dontAsk denies curl even with no settings file.
- **Claude Design authorization: done and verified.**
  - The owner ran `/design-login` at 15:38. `claude mcp get claude-design` shows
    `✔ Connected`.
  - It also shows `✔ Connected` with the fleet's `CLAUDE_CODE_OAUTH_TOKEN` in the environment
    (§4).
- **Still missing, for agents to actually design:**
  1. **`Artifact` tool.** It is the engine of Claude Design canvases in the CLI.
     - It is not allowed in any tier.
     - It is probably not even available on the fleet's setup-token credential. INFERRED: the
       40 most recent fleet runs show no `ArtifactComments`/`ArtifactData` (§4.3).
  2. **`claude-design` MCP.** It is user-scope, so `--setting-sources project` never loads it in
     a fleet run.
  3. **Who may use them.** Not plain tier0, which is shared with roles that handle guest and
     customer data. Proposal: a `tier0-design` variant for social-manager, brand-director and
     creative-producer only (§5).
- **Needed from the owner:**
  - Optionally, a figma login (`claude mcp login plugin:design:figma --no-browser`).
  - Approval of a 2-run haiku preflight, a few cents, that creates one private test artifact
    to delete afterwards (§6).
  - Approval of the §5 changes.

---

## 2. Current state of tier0 (MEASURED `git diff`, uncommitted)

`.claude/fleet/settings/tier0.settings.json`:
- `$comment` extended.
- `allow` += `Skill(design:<x>)` and `Skill(design:<x> *)` for all 7 skills: design-critique,
  accessibility-review, ux-copy, design-system, design-handoff, user-research,
  research-synthesis.
- New top-level keys `enabledPlugins` (`design@knowledge-work-plugins: true`) and
  `extraKnownMarketplaces.knowledge-work-plugins` (github `anthropics/knowledge-work-plugins`).
- Valid JSON. No `Artifact`, no `mcp__claude-design__*`, no `deniedMcpServers`.

Consequences to know:
- **Every** tier-0 role now lists and may invoke the 7 skills. That includes ops-monitor,
  support-drafter, business-ops, callback-triage and others. This is harmless: the skills are
  text-only guidance with no `allowed-tools` (MEASURED frontmatter).
- The plugin's MCP servers now connect from every tier-0 run (§3). Their tools stay denied
  under dontAsk.
- Line numbers cited from tier0 in prompts and docs were already stale, and have shifted by +14
  in the deny section: `social-manager.md:183`, `content-seo-strategist.md:18,91`,
  `brand-director.md:21`, `docs/fleet/02-roles-catalog.md:25`. Replace them with rule names.
- Role prompts do not yet point at the skills (§7).

### 2.1 Background evidence (MEASURED, pre-change)
- Fleet launch: `run-role.sh:130-136`, which is
  `claude -p … --permission-mode dontAsk --setting-sources project --settings settings/tier$TIER.settings.json`.
  - It runs as user kalfa.me, HOME `/var/www/vhosts/kalfa.me`, cwd beta (`pm2 jlist`,
    `run-role.sh:36-38`).
  - Auth is `CLAUDE_CODE_OAUTH_TOKEN` from `.claude/fleet/.token.env` (a setup-token), set at
    `run-role.sh:111-115`.
- The social-manager run at 15:16 (session `61c3a989…`) had 443 skills and zero `design:`.
  - The only MCP servers loaded were the project `.mcp.json` ones (next-devtools, shadcn).
    No user-scope servers loaded, and no claude.ai connectors.
  - There were 2 historic `Skill` denials (fleet-maintainer, 31.08 and 13.09).
- Check command:
  `jq -r 'select(.attachment.type=="skill_listing")|.attachment.content' ~/.claude/projects/-var-www-vhosts-kalfa-me-beta/<session_id>.jsonl`

---

## 3. Plugin MCP servers (not blocked) — status for kalfa.me

Source: `design/1.2.0/.mcp.json` (MEASURED). Auth state comes from `~/.claude/.credentials.json`
`mcpOAuth`; only token presence was checked, never values.

- **slack** (`mcp.slack.com/mcp`)
  - There is no `plugin:design:slack` entry. `plugin:slack:slack` at the same endpoint has
    access and refresh tokens.
  - Docs say Claude Code "stores OAuth sign-ins per endpoint". INFERRED: it connects in fleet
    runs.
  - Its tools, including send, are still denied (not in allow).
- **figma, notion, linear, asana, atlassian, intercom**
  - Each has an entry with **no token**, so each is "needs authentication".
  - This session exposes only `mcp__plugin_design_<x>__authenticate`/`complete_authentication`
    for exactly these 6.
- **gmail, google calendar**
  - The plugin ships them with **empty URLs**. The owner cannot fix this.
  - Expect them in `plugin_errors` or simply absent.

What an unauthenticated server does to `claude -p` (docs fetched today, mcp.md and env-vars.md):
- **Not stuck.** Servers connect in the background, and the first non-interactive turn waits
  briefly for pending ones (`CLAUDE_CODE_MCP_STARTUP_WAIT_MS`). A 401 returns fast, so the cost
  is seconds (INFERRED).
- **Not silent.** "When a configured server needs authentication during a `claude -p` … Claude
  Code tells Claude that the server's tools are unavailable until you authorize it." The agent
  gets a notice and may mention it in its summary.
- **Not fatal.** The fleet does not pass `--strict-mcp-config`.

Owner login commands (SSH with `-t`; the command prints a URL, you open it locally, then paste
back the redirect URL):
```
claude mcp list                                     # confirm exact names first
claude mcp login plugin:design:figma --no-browser   # the only one relevant to design roles
# optional, no KALFA use found: plugin:design:notion / linear / asana / atlassian / intercom
```
The `plugin:design:<x>` name form is INFERRED from the credential keys. Use whatever
`claude mcp list` prints.

---

## 4. Claude Design — auth and availability

### 4.1 Mechanisms (docs fetched today: commands.md, artifacts.md, tools-reference.md)
- **`Artifact` tool.** It publishes an HTML/MD file as a private claude.ai page.
  - With `action: quickstart, intent: design`, then publish, it creates a Design artifact,
    which is the canvas behind `/design`. The owner edits the artboards in a browser and
    exports PNG/PDF.
  - Permission required: Yes.
  - Availability: Pro/Max/Team/Enterprise (MEASURED `max`), and "the session is backed by a
    claude.ai account: sign in with /login … API key, gateway token … cannot publish".
  - Surface: "Claude Code CLI … Off by default in Agent SDK, GitHub Action, and MCP-server
    contexts".
- **`/design [brief]`.** A bundled skill that uses Artifact.
  - INFERRED: it is **not model-invocable**. It is missing from both the fleet's and this
    interactive session's skill listings, even though this session has `Artifact`.
  - Headless only expands a slash command at the start of the prompt string, and fleet prompts
    come from role files. So a fleet agent designs **through the `Artifact` tool directly**,
    guided by the `artifact-design` skill (listed in this session).
- **`claude-design` MCP / `DesignSync` / `/design-sync`.** These give design-system access, so
  Claude Design can use KALFA's own components. `/design-login` authorizes it.
  - It is useful for brand consistency, but it is **not required** to draft designs.

### 4.2 `/design-login` — where it is stored and whether it works headless (MEASURED)
- **Storage:** a new top-level key, `designOauth`, in `~/.claude/.credentials.json`
  (mtime 15:38:21).
  - Fields: accessToken, refreshToken, clientId, expiresAt, and scopes
    `user:design:read`, `user:design:write`.
  - The access token expires at 23:38 IDT today, and a refresh token is present.
  - `claudeAiOauth` scopes are unchanged. Nothing was printed.
- **Before the grant:** `~/.claude/debug/dd097e8f….txt` (15:37:02) and `13ee7bea….txt`
  (15:37:50) show HTTP 403 `{"error":"needs_design_scopes",…}`.
- **After the grant:** `claude mcp get claude-design` shows `Status: ✔ Connected`. This is a
  health check only, with no model call.
  - The same command, in a subshell with `.claude/fleet/.token.env` sourced, also shows
    `✔ Connected`.
  - So the design grant is its own credential and does not depend on the Claude login used by
    the run. This is MEASURED for the health-check path; `-p` on the fleet token is INFERRED
    until preflight run A.
- **Loading in fleet runs:** `claude mcp get` reports "Scope: User config", and user scope is
  dropped by `--setting-sources project` (§2.1). It therefore needs `--mcp-config` (§5).
  - INFERRED that first-party auth still applies when defined that way. The debug log shows
    `hasAuthProvider:false`, meaning the auth is attached by URL rather than by config entry.
- **Refresh:** `designOauth` lives on its refresh token. If `use_login_credential` ships (§5),
  `claudeAiOauth` does the same, and headless and interactive sessions would refresh the same
  file. Check claude-design on the first design-role run after 23:38. If a refresh ever fails,
  re-run `/design-login`.

### 4.3 Is `Artifact` available on the fleet's setup-token? Unknown — INFERRED no
- The deferred-tool lists of the last 40 fleet runs (MEASURED) contain `DesignSync` but never
  `ArtifactComments` or `ArtifactData`. Both of those are deferred tools in this interactive
  session of the same user.
- The docs require a claude.ai `/login`-backed session.
- The preflight's run A (fleet token) versus run B (login credential) decides this.

---

## 5. Who may use Artifact and claude-design — proposal

- **Not plain tier0.**
  - Adding `Artifact` there would let support-drafter, callback-triage, business-ops and
    others upload data, including guest or customer PII, to claude.ai.
  - The coordinator deliberately did not add it.
- **Not tier 1 or 2.** Those tiers add git, deploy and database powers that design does not
  need.
- **Minimal change:**
  - Keep the three content roles at `tier: 0`.
  - Give only them a variant settings file, `tier0-design` = tier0 verbatim + design extras,
    plus an MCP config.
  - This needs a small per-role override in `run-role.sh`, which today chooses the file by
    tier number only (`run-role.sh:101`).

### 5.1 Diffs

**`.claude/fleet/bin/run-role.sh`** (after line 101):
```diff
 SETTINGS="$FLEET_DIR/settings/tier$TIER.settings.json"
+# Optional per-role overrides in fleet.json:
+#   "settings": "<name>"            -> settings/<name>.settings.json instead of the tier default
+#   "mcp_config": "<name>"          -> adds --mcp-config settings/<name>.mcp.json
+#   "use_login_credential": true    -> skip .token.env; run on ~/.claude/.credentials.json
+# Names limited to [a-z0-9-] so fleet.json cannot point outside settings/.
+SETTINGS_NAME="$(jq -r --arg r "$ROLE" '.roles[$r].settings // empty' "$CONFIG")"
+MCP_NAME="$(jq -r --arg r "$ROLE" '.roles[$r].mcp_config // empty' "$CONFIG")"
+USE_LOGIN="$(jq -r --arg r "$ROLE" '.roles[$r].use_login_credential // false' "$CONFIG")"
+for n in "$SETTINGS_NAME" "$MCP_NAME"; do
+  if [ -n "$n" ] && ! [[ "$n" =~ ^[a-z0-9-]+$ ]]; then
+    index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"error\":\"invalid settings/mcp_config name\"}"; exit 78
+  fi
+done
+[ -n "$SETTINGS_NAME" ] && SETTINGS="$FLEET_DIR/settings/$SETTINGS_NAME.settings.json"
+MCP_ARGS=()
+[ -n "$MCP_NAME" ] && MCP_ARGS=(--mcp-config "$FLEET_DIR/settings/$MCP_NAME.mcp.json")
+if [ ! -f "$SETTINGS" ] || { [ -n "$MCP_NAME" ] && [ ! -f "$FLEET_DIR/settings/$MCP_NAME.mcp.json" ]; }; then
+  index_line "{\"ts\":\"$(date -Is)\",\"role\":\"$ROLE\",\"error\":\"missing settings/mcp file\"}"; exit 1
+fi
@@
-if [ -f "$FLEET_DIR/.token.env" ]; then
+if [ "$USE_LOGIN" != "true" ] && [ -f "$FLEET_DIR/.token.env" ]; then
@@
     --settings "$SETTINGS" \
+    "${MCP_ARGS[@]}" \
     --model "$MODEL" \
```
- `use_login_credential` ships only if preflight run A fails and run B passes (§6).
- Do **not** add `--strict-mcp-config`. It is documented two different ways (cli-reference and
  mcp.md), and it would change MCP loading.

**New `.claude/fleet/settings/tier0-design.settings.json`**: tier0 **as it is now** (including
the plugin and the 7 skills), byte-for-byte, plus:
```diff
+  "$comment": "Tier-0 + Claude Design, ONLY for social-manager / brand-director / creative-producer (fleet.json \"settings\": \"tier0-design\"). Everything in tier0 applies verbatim (test-pinned). Adds the Artifact tool (private claude.ai pages — design drafts only; never delete/pin/publish anything public), the artifact-design skill, and the claude-design MCP tools by name.",
   "allow": [ ...tier0 allow verbatim...,
+      "Artifact",
+      "Skill(artifact-design)", "Skill(artifact-design *)",
+      "mcp__claude-design__<tool>"   // one entry per tool name listed in the preflight init event
   ],
```
- The Artifact tool writes a local file first. tier0's Edit rules allow writes only under
  `.fleet-logs/**`, so prompts must tell the agent to write the page under
  `.fleet-logs/drafts/<lane>/<batch>/`. Otherwise the Write is denied.
- Its actions are publish, list, read, delete, open, pin, unpin and quickstart. It has no share
  action. The allow rule is tool-wide, so prompts forbid delete and pin. For a hard wall, add
  parameter-matching deny rules (docs w25: "match tool parameters in deny and ask rules"). The
  exact syntax must be verified before use.

**New `.claude/fleet/settings/design.mcp.json`** (no secret; same definition as `~/.claude.json`):
```json
{ "mcpServers": { "claude-design": { "type": "http", "url": "https://api.anthropic.com/v1/design/mcp" } } }
```

**`.claude/fleet/fleet.json`**: for social-manager, brand-director and creative-producer (tier
stays 0):
```diff
   "tier": 0,
+  "settings": "tier0-design",
+  "mcp_config": "design",
```
Add `"use_login_credential": true` only if the preflight requires it.

**New test `src/lib/fleet/tier0-design-settings.test.ts`**, following the pattern of
`src/lib/owner-agent/owner-agent-settings.test.ts`. It asserts that tier0-design has:
- every tier0 allow and deny rule, the same hooks, `enabledPlugins` and
  `extraKnownMarketplaces`;
- `defaultMode: dontAsk`;
- extra allows limited to the list above.

This stops the copy from drifting when tier0 changes.

---

## 6. Preflight — 2 capped haiku runs (owner-approved; NOT run by this investigation)
Build scratch copies of tier0-design and design.mcp.json, then run from
`/var/www/vhosts/kalfa.me/beta`. The SessionStart hook `main-inbox.sh` fires; it is a read-only
poll and fails open. One private test artifact is created; delete it afterwards in the
claude.ai gallery.
```
P='Use the Artifact tool: quickstart with intent "design", then write a 1080x1080 Hebrew RTL test poster page to .fleet-logs/drafts/_preflight/poster.html and publish it privately. Then invoke design:accessibility-review on that file. List the claude-design MCP tools you have. Reply DONE.'
# A — the fleet credential
( . .claude/fleet/.token.env; export CLAUDE_CODE_OAUTH_TOKEN
  claude -p "$P" --model haiku --max-turns 8 --permission-mode dontAsk --setting-sources project \
    --settings <scratch>/tier0-design.settings.json --mcp-config <scratch>/design.mcp.json \
    --output-format stream-json --verbose > <scratch>/A.ndjson )
# B — the /login credential
env -u CLAUDE_CODE_OAUTH_TOKEN claude -p "$P" <same flags> > <scratch>/B.ndjson
```
For the first run, the `mcp__claude-design__<tool>` allow can be the server-wide
`mcp__claude-design`. Replace it with exact names from the init event before applying for real.

Read, per run:
- **init `.tools` contains `Artifact`?** If not, artifacts are **unavailable on that
  credential**.
- **init `.mcp_servers`:** claude-design is connected, with its tool names. Also record the
  status of each `plugin:design:*` server.
- **`permission_denials`:** any `Artifact`, `Skill`, `Write`/`Edit` or `mcp__claude-design__*`
  entry is an **allowlist gap**. Add the exact name and rerun. It is not a verdict on
  availability.
- Publish returned a claude.ai URL; `total_cost_usd`.

Decision:
- **A has Artifact** → no credential change.
- **Only B has Artifact** → set `use_login_credential: true` for the three roles. Trade-off:
  they then depend on the interactive login staying valid.
- **Neither has Artifact** → artifacts are not available headless on this account. Keep the
  skills and claude-design, and keep designing via HTML + `render-image`, which works today.

---

## 7. Skills × roles (plugin skills are already allowed in tier0)

- **social-manager:**
  - `design:design-critique` + `design:accessibility-review`, **once per batch** before the
    approval request.
  - `design:ux-copy` for CTA text inside the image.
  - With tier0-design, also Artifact design canvases.
- **brand-director:**
  - critique + accessibility as a gate checklist line.
  - A monthly `design:design-system` visual-consistency audit. Any change goes out as a
    BRAND.md request, never an edit.
- **creative-producer:**
  - critique for storyboard frames, and accessibility for caption contrast.
  - `design:design-system` for the design spec.
  - With tier0-design, also Artifact canvases.
- **business-ops / chief-of-staff / support-drafter:** `design:research-synthesis` and
  `design:user-research` can turn inquiries and support tickets into themes. They are allowed
  now, but no prompt points at them yet; that is a separate decision.
- **design-handoff:** no enabled dev role. Allowed but idle.

Prompt pointer, social-manager, new section before "## פלט ואישור" (Hebrew):
```
## עיצוב עם Claude Design (טיוטה בלבד)
- פעם אחת לאצווה: `design:design-critique` + `design:accessibility-review` על כל תמונות
  האצווה; `design:ux-copy` לטקסט CTA בתוך התמונה. תקן ורנדר מחדש לפני הפנייה.
- (אחרי שהוגדר tier0-design) מותר ליצור קנבס עיצוב: כלי `Artifact` — quickstart עם
  intent "design", כתוב את הקובץ תחת `.fleet-logs/drafts/social/<batch>/`, פרסם **פרטי**.
  **אסור** delete/pin, אסור לשתף. צרף את הקישור לפנייה לבעלים. ה-PNG לפרסום עדיין
  מ-`render-image` או מיצוא של הבעלים.
- BRAND.md §3/§6 גוברים. אין פרסום בלי אישור הבעלים. אין הפקת מדיה בתשלום בלי אישור.
- Figma/Notion וכו' לא מחוברים — אל תנסה להתחבר; הודעת "needs authentication" אינה תקלה.
```
- brand-director: add a checklist line for critique and accessibility on the PNG or artifact.
- creative-producer: under "לפני כל עבודה", the same Artifact rule (private,
  `.fleet-logs/drafts/creative/…`) and "אין הפקה בתשלום בלי אישור".

---

## 8. Order of execution
1. Commit the coordinator's tier0 change (already applied and preflighted) together with the
   prompt pointers from §7 (skills part only) and the line-number fixes. It is reviewable on
   its own.
2. Owner, optional: figma login (§3).
3. Owner approves → preflight A/B (§6).
4. Write tier0-design, design.mcp.json, the test and the run-role.sh override. Run the test,
   `npm run lint`, `npx tsc --noEmit` and `bash -n .claude/fleet/bin/run-role.sh`.
5. `fleet.json` overrides for the 3 roles. The scheduler re-reads it within 60s; no pm2 restart.
6. Add the Artifact parts of the role pointers. Commit.
7. Consider waiting until the social-manager runaway spawning is resolved. At about
   $0.36–0.60 per run today, cost rises with skill loads and design runs.

## 9. Verification after apply (zero cost)
- **Next run of each design role:**
  - The transcript shows `Artifact`/`Skill` tool_use and no related entries in
    `.fleet-logs/runs/<stamp>-<role>.json` `permission_denials`.
  - The request or summary carries the artifact link.
  - The deferred list now includes `ArtifactComments`/`ArtifactData` (the availability signal).
- **Other tier-0 roles:** still no `Artifact` in their tools or denials.
- **After 23:38 today:** the first design-role run still shows claude-design connected, which
  proves the refresh works.

## 10. Risks and rollback
- **A settings file that fails validation is silently ignored in print mode.**
  - Mitigation: preflight on scratch copies, the test pins the rules, and "Artifact present
    in tools" proves the file loaded.
- **Draft designs uploaded to claude.ai.**
  - Mitigation: only 3 content roles, private artifacts, and PII is already forbidden by those
    roles' prompts.
- **The Artifact allow also covers delete and pin.**
  - Mitigation: prompts forbid both. Optionally add parameter-matching deny rules.
- **Token refresh.** `designOauth` (and `claudeAiOauth` if `use_login_credential` ships) needs
  refresh. The files are shared with interactive sessions, and `/logout` stops them.
  - Mitigation: a failure shows as a 403 or an exit≠0 in index.ndjson. Fix with
    `/design-login` or `/login`.
- **Plugin MCP notices in every tier-0 run.**
  - Mitigation: cosmetic. Their tools are denied, and logging in removes the notice.
- **Higher per-run cost.**
  - Mitigation: "once per batch" in the pointers, and apply after the runaway is fixed.

Rollback:
- Part 2: remove the fleet.json keys, and the next spawn uses plain tier0.
- Part 1: `git checkout`-free revert via `git revert <commit>`, or restore the earlier tier0
  from git history on the owner's approval.
- Emergency: `touch .claude/fleet/KILLSWITCH`.
