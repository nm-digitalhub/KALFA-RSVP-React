# Evaluation

## 1.1 Release notes vs. the installed APIs (19.10.2026)

Sources:
- the GitHub releases page of `stalniy/casl`;
- `packages/casl-ability/CHANGELOG.md` and `packages/casl-react/CHANGELOG.md` on `master`;
- `node_modules/@casl/*/dist`.

**`@casl/ability`**

| Version | Date | What the release notes say |
|---|---|---|
| 7.0.2 | 2026-10-15 | One bug fix: "prevent rulesToFields to set properties on prototype and non-objects". Not breaking. |
| 7.0.1 | 2026-06-10 | Package metadata only. |
| 7.0.0 | 2026-05-21 | Breaking, see below. |

The 7.0.0 breaking changes:
- `PureAbility` is renamed to `Ability`, which has no default options. Clients that want the previous `Ability` behaviour use `createMongoAbility` and the `MongoAbility` type. Design D1 already uses exactly these.
- `rulesFor` and `possibleRulesFor` return `readonly Rule[]`.
- `rulesToQuery` is replaced by `rulesToCondition`. The pilot does not use it.
- Conditions that semantically match everything are treated like a rule without conditions. The pilot has no conditions.

**`@casl/react`**

| Version | Date | What the release notes say |
|---|---|---|
| 7.0.1 | 2026-06-10 | Package metadata only. |
| 7.0.0 | 2026-05-21 | Breaking, see below. |

The 7.0.0 breaking changes:
- `createContextualCan` is replaced by `<AbilityProvider>`, and `useAbility` no longer takes a context argument.
- `<Can>` no longer takes an `ability` prop; it reads the ability through `useAbility`.

**Against the installed packages:**
- `@casl/ability` 7.0.2 exports `createMongoAbility`, `AbilityBuilder` and `MongoAbility`
  (`dist/types/index.d.ts`, `createMongoAbility.d.ts`, `AbilityBuilder.d.ts`).
- `@casl/react` 7.0.1 exports `AbilityProvider`, `Can` and `useAbility`. `AbilityProvider` reads
  `{ children, value }` (`dist/esm/index.mjs`, `dist/types/hooks/useAbility.d.ts`). One README section
  still shows the older `ability=` prop.
- The `@casl/react` bundle has no `'use client'` directive.

**Result:** the APIs in design D1 and D5 match the installed packages. Nothing differs, so 1.2 can start.


## 2. Decision-gate evaluation (20.10.2026)

**Provisional outcome: the bundle cost does not justify rejecting CASL. The pilot is ready for code review, but this report does not approve a wider migration.** The central action map removes scattered permission-key decisions and the server still enforces the database-backed permission. CASL adds shared client rule evaluation and React integration. Its value over a plain typed map remains a separate architectural question; the current pilot has no conditional rules and all four actions map to the same permission.

This section records fresh bundle calculations, source inspection and focused tests. It does not mark tasks 6.1/6.2 complete: full integration verification, a comparison of committed production snapshots, and the owner’s role-based browser checks remain outstanding.

### 2.1 Exactly what was measured

| Item | Value |
|---|---|
| Before source anchor | `c9b961808bcdc0faa04b2760e060a9d7a90d2d78` — parent of the action-map/server-gate implementation |
| After HEAD anchor | `6bed436d07228d21746b66d824517ab457c476cd` **plus uncommitted pilot changes** |
| Next.js / bundler | Next.js **16.4.1**, **Webpack** |
| CASL | `@casl/ability` **7.0.2**, `@casl/react` **7.0.1** |
| Analyzer | `@next/bundle-analyzer` **16.4.2** |
| Node.js | **v24.22.0** |
| Compression | Node `zlib.gzipSync(fileBytes, { level: 9 })`; Brotli quality 11 as a secondary measure |
| Units | **1 KiB = 1,024 bytes**; percentages calculated from unrounded byte counts |
| Build mode | Optimized Webpack `compile`, selecting only the four routes below |

**These are two source anchors, not two clean commits that were built.** After was a copy of the working tree. Before used that same copy with only 16 pilot source paths restored from the before anchor (two newly introduced files were absent there). Dependencies and the rest of the application remained the same. Of those 16 paths, 14 actually differ. An unused CASL factory and installed CASL dependencies already existed before; the baseline bundle reports contain no emitted CASL/UCAST modules.

The captured [production-source patch](evidence/pilot-vs-baseline.patch) identifies the pilot delta, including the uncommitted integration. Its SHA-256 and exact paths are in the [evidence JSON](evidence/bundle-size-2026-10-20.json). The patch was compared with the current pilot diff during this review and matched byte for byte. This makes the source delta reviewable; it does not turn a dirty-tree measurement into a historical commit comparison. Before a final GitHub decision, commit identification and a rerun against the chosen committed snapshots must be supplied through the normal review workflow. No commit or push was performed for this report.

Both builds ran in `/tmp/kalfa-casl-size-e8k9hllv/work`, using isolated `.next-before` and `.next-after` directories and the same configuration, deployment ID, dependencies and environment files. Neither the served `.next` directory nor application source was changed by the measurement.

```sh
# Run inside the isolated source snapshot; repeat with .next-before after restoring the pilot paths.
ANALYZE=true NEXT_TELEMETRY_DISABLED=1 NEXT_DIST_DIR=.next-after \
  ./node_modules/.bin/next build --webpack --experimental-build-mode compile \
  --debug-build-paths='src/app/(admin)/admin/page.tsx,src/app/(admin)/admin/packages/page.tsx,src/app/(admin)/admin/packages/new/page.tsx,src/app/(admin)/admin/packages/\[id\]/page.tsx'

# Run from the repository, while the isolated build artifacts are available.
node openspec/changes/pilot-casl-package-permissions/evidence/measure-bundle-size.cjs \
  /tmp/kalfa-casl-size-e8k9hllv
```

Both compilations completed successfully. The raw HTML analyzer reports and logs remain in that temporary directory. Durable asset sizes, entrypoint membership, asset hashes, source anchors and the focused-test command are retained in the evidence JSON; they do not depend on the temporary HTML reports for reviewing the tables below.

### 2.2 Before/After for each route

These are the initial JavaScript entrypoint sets for each route, including its shared runtime, layouts and error/loading/not-found boundaries. They exclude async-only assets, CSS, fonts, HTML and RSC bodies. This is a cold-cache asset-size model, not a recording of a browser session.


#### `/admin`

| Metric | Before (KiB) | After (KiB) | Delta (KiB) | Change |
|---|---:|---:|---:|---:|
| Minified, uncompressed | 732.17 | 748.94 | +16.77 | +2.29% |
| Gzip, level 9 | 232.70 | 239.01 | +6.31 | +2.71% |
| Brotli, quality 11 | 197.55 | 202.77 | +5.23 | +2.65% |

#### `/admin/packages`

| Metric | Before (KiB) | After (KiB) | Delta (KiB) | Change |
|---|---:|---:|---:|---:|
| Minified, uncompressed | 729.79 | 746.56 | +16.77 | +2.30% |
| Gzip, level 9 | 231.67 | 237.98 | +6.31 | +2.72% |
| Brotli, quality 11 | 196.60 | 201.83 | +5.23 | +2.66% |

#### `/admin/packages/new`

| Metric | Before (KiB) | After (KiB) | Delta (KiB) | Change |
|---|---:|---:|---:|---:|
| Minified, uncompressed | 749.49 | 766.33 | +16.85 | +2.25% |
| Gzip, level 9 | 237.67 | 244.01 | +6.34 | +2.67% |
| Brotli, quality 11 | 201.87 | 207.14 | +5.27 | +2.61% |

#### `/admin/packages/[id]`

| Metric | Before (KiB) | After (KiB) | Delta (KiB) | Change |
|---|---:|---:|---:|---:|
| Minified, uncompressed | 750.32 | 767.29 | +16.97 | +2.26% |
| Gzip, level 9 | 238.21 | 244.59 | +6.39 | +2.68% |
| Brotli, quality 11 | 202.31 | 207.62 | +5.31 | +2.63% |

### 2.3 Shared shell versus route-specific JavaScript

“Shared shell” below is the common entrypoint set: `main-app`, root layout/not-found/global-error, and admin layout/error/loading. “Beyond shell” is each page’s asset set **minus** that shared set. Some assets beyond the shell are shared between the create and edit routes, so those rows must not be added together as if each were unique site-wide code.

| Gzip component | Before (KiB) | After (KiB) | Delta (bytes) |
|---|---:|---:|---:|
| Shared shell | 231.40 | 237.71 | +6,459 |
| `/admin` beyond shell | 1.30 | 1.30 | +0 |
| `/admin/packages` beyond shell | 0.27 | 0.27 | +0 |
| `/admin/packages/new` beyond shell | 6.27 | 6.30 | +31 |
| `/admin/packages/[id]` beyond shell | 6.81 | 6.89 | +82 |

The shell accounts for **6,459 bytes** of the gzip increase. The create page adds **31 bytes** beyond that increase; the edit page adds **82 bytes**. The dashboard and package list add no route-specific gzip increase.

The library attribution is **16,073 minified bytes** for `@casl/ability` **including its concatenated UCAST dependencies**, plus **800 bytes** for `@casl/react`. UCAST must not be added again. Submodule sizes within concatenated modules are estimates; compressed module sizes are not additive. The route tables use actual files compressed individually, not a sum of the analyzer’s module gzip estimates.

The client provider sits in [AdminShell](../../../src/components/admin-shell.tsx#L335), so the cost applies to the shared admin shell, beyond the package screens. The [provider](../../../src/components/platform-ability-provider.tsx#L21) creates a Mongo ability from server-supplied rules. The client graph contains one emitted ability group and one React-adapter group. Cached shared chunks can be reused between admin navigations.

### 2.4 Duplicate-chunk audit

The calculation first forms `Set(sharedAssetPaths ∪ pageAssetPaths)`, then sums each file’s size once. The follow-up audit independently rebuilt this set from `isInitialByEntrypoint`, re-read the files, recomputed gzip, and checked `shared + beyondShell == routeTotal`. It also checked that every original route asset list already contained unique paths. All checks passed; the original reported numbers are unchanged.

| Route | Entrypoint references | Unique files counted | Duplicate references removed |
|---|---:|---:|---:|
| `/admin` | 19 | 16 | 3 |
| `/admin/packages` | 19 | 16 | 3 |
| `/admin/packages/new` | 21 | 17 | 4 |
| `/admin/packages/[id]` | 21 | 17 | 4 |

These counts are identical before and after. As another check, the deduplicated **union of all four routes** is 239.96 → 246.35 KiB gzip, a total increase of **6,541 bytes (6.39 KiB)**. It is not four times the per-route increase. This union also removes overlap between the create and edit forms; it describes a potential reusable asset set, not measured user navigation traffic.

### 2.5 What changed in permission maintenance

The before column below refers to `c9b961808bcdc0faa04b2760e060a9d7a90d2d78`. The after column refers to the measured working-tree snapshot. Counts cover executable Package permission decisions; comments, tests, other domains and the old unused factory are excluded.

| Location | Before: literal permission decisions | After |
|---|---|---|
| Package data functions | 8 at `packages.ts:60,78,195,235,255,284,317,341` | Action gates at [63](../../../src/lib/data/admin/packages.ts#L63), 81, 198, 238, 258, 287, 320, 344 |
| List/create/edit pages | 3 at `page.tsx:17`, `new/page.tsx:23`, `[id]/page.tsx:30` | `read/create/read Package` at the same lines ([list](../../../src/app/%28admin%29/admin/packages/page.tsx#L17), [create](../../../src/app/%28admin%29/admin/packages/new/page.tsx#L23), [edit](../../../src/app/%28admin%29/admin/packages/%5Bid%5D/page.tsx#L30)) |
| Copy-rewrite action | 1 at `rewrite-action.ts:21` | Shared create-or-update action pairs at [22](../../../src/app/%28admin%29/admin/packages/rewrite-action.ts#L22) |
| Package sidebar item | 1 at `admin-shell.tsx:144` | `can: ['read', 'Package']` at [155](../../../src/components/admin-shell.tsx#L155) |
| Dashboard package count | 1 at `dashboard.ts:56` | `ability.can('read', 'Package')` at [62](../../../src/lib/data/admin/dashboard.ts#L62) |

**14 scattered literal decision sites → 0 in those business call sites.** Four explicit action-to-key bindings remain together at [casl.ts:12–19](../../../src/lib/casl.ts#L12); all four currently use `manage_billing`. This centralizes the permission policy, rather than eliminating every repeated string. The [static guard](../../../src/lib/casl-pilot-static.test.ts#L78) protects that boundary and checks the pilot’s server entrypoints.

The production-source diff has **329 lines added, 127 removed (net +202), across 14 changed files**. These counts include comments and types, exclude tests/docs/configuration, and compare the exact pilot paths against the same baseline anchor. Per-file counts and the source patch are attached. Fewer scattered decisions therefore does **not** mean fewer total lines or fewer concepts.

The server path remains `requirePlatformAction → platformActionKey → requirePlatformPermission → has_platform_permission RPC`. The [action wrapper](../../../src/lib/auth/platform-ability.ts#L47) delegates to the existing [DAL](../../../src/lib/auth/dal.ts#L196). Each of the three mutation actions now checks its action before parsing input, outside error-handling blocks ([actions.ts:85,133,180](../../../src/app/%28admin%29/admin/packages/actions.ts#L85)). Client `<Can>` and sidebar filtering are display logic, not the authorization boundary.

There is one deliberate access-display change: the dashboard package count previously used `view_billing`; it now follows `read Package`, mapped to `manage_billing`. The [dashboard tests](../../../src/lib/data/admin/dashboard.test.ts#L112) pin that a viewer holding only `view_billing` receives no package count/query. The report must not describe the entire pilot as behavior-preserving.

**What CASL adds beyond a plain typed map:** a reusable rule representation, the same ability evaluator on server and client, and maintained React provider/hook/`<Can>` integration. The plain map itself supplies the reduction in scattered key literals and could also be used with a custom shared evaluator and React context. CASL avoids maintaining that implementation; it is not uniquely required for centralization. Conditional rules are a possible future capability, not a demonstrated pilot benefit. `createMongoAbility` currently includes a condition engine that the pilot does not use. No smaller alternative was implemented or benchmarked in this evaluation.

### 2.6 Verification completed and security checks still required

On 20.10.2026, the exact command retained in `focusedVerification.command` in the evidence JSON passed **619 tests in 17 files**, exit code 0, in **6.43 seconds**. This included the existing DAL suite, the pilot’s unit/component tests, and the static admin authorization coverage checks.

| Evidence | What passed | Boundary of that evidence |
|---|---|---|
| [Action-map tests](../../../src/lib/casl.test.ts#L29) | Catalogue membership, empty/default-deny behavior, action mapping and rule serialization | No live database role matrix |
| [Server-wrapper tests](../../../src/lib/auth/platform-ability.test.ts#L55) | Delegation, refusal propagation, same-key deduplication, multi-key OR and empty-input refusal | DAL mocked; no measured live RPC counts |
| [Package data tests](../../../src/lib/data/admin/packages.test.ts#L644) | All eight functions use the intended gate; refusal occurs before either database client is created | Mocked clients and permission result |
| [Server Action tests](../../../src/app/%28admin%29/admin/packages/actions.test.ts#L246) and [rewrite tests](../../../src/app/%28admin%29/admin/packages/rewrite-action.test.ts#L19) | Direct function calls refuse unauthorized input before data functions/Claude; redirect signals propagate | Not real HTTP Server Action POST requests |
| [Provider tests](../../../src/components/platform-ability-provider.test.tsx#L30), page/form/nav tests | Controls follow action rules, including changed provider rules | Component rendering, not an authenticated browser session |
| [Pilot static guard](../../../src/lib/casl-pilot-static.test.ts), [admin coverage](../../../src/lib/auth/admin-data-layer-coverage.test.ts) | No direct key decisions in scoped pilot files; server gates and coverage pins remain present | Source checks supplement runtime tests; they are not proof against every control-flow bypass |

Before declaring the pilot ready for expansion:

1. Complete [task 6.1](tasks.md): full suite, lint, typecheck and a normal isolated production build for the final revision. The focused run and selective compile here do not satisfy that full integration gate. Rerun the bundle comparison against the chosen committed revisions if that is the review baseline.
2. Perform the owner’s planned authenticated browser checks as owner and billing clerk, and denied-path checks for staff without `manage_billing` (including `view_billing` only) and an unauthenticated caller. Verify direct reads and actual Server Action requests cannot create/update/delete/rewrite without the server grant; rejected requests must produce no database writes or external work. Use controlled test data/environment for mutation checks.
3. Confirm the live role/RPC behavior and relevant RLS boundaries agree with the intended matrix, including the dashboard’s changed visibility. Mocked success/denial is not verification of deployed database grants.
4. Check revocation after a page has loaded: stale or tampered client rules must never authorize a server operation. The existing server delegation supports this design, but no end-to-end revocation run is recorded here.

These are remaining verification items, not evidence that a bypass was found. The report does not claim a successful production deployment, a live role test, or completed task 6.1.

### 2.7 Limits and architectural decision

- **Bundle size is not load time.** No browser parse/execute/hydration timing, CPU, memory, server latency or live network transfer was measured. Gzip level 9 and Brotli quality 11 were controlled local settings, not verified production compression settings.
- **~2.7% is relative to these routes’ initial JavaScript sets**, not total website JavaScript, total page weight, all users’ traffic or application-wide runtime consumption.
- Selective builds can split shared chunks differently from a full production build. Both sides selected the same routes, but these are not exact full-production download sizes.
- A cold asset cache and separate-file compression were modeled. Caching, navigation, prefetch, error-boundary loading and server compression alter actual traffic. Route totals must not be summed across visits without deduplication.
- RSC data was excluded. The four allowed rules are 159 bytes as plain JSON (empty rules: 2 bytes); actual Flight encoding, compression and repeated payload overhead were not measured.
- Source inspection supports the server enforcement path and request-level caching; it does not establish a zero-cost runtime or unchanged database-call counts under real rendering.

**Decision for review:** approximately 6.4 KiB gzip is an acceptable provisional size tradeoff for evaluating the shared permission infrastructure. The pilot demonstrates centralized policy and retained server delegation, with passing focused refusal tests. It has not yet demonstrated a maintenance advantage over the simpler typed-map alternative across multiple domains, and it has not completed the integration/live-security gate. Retain the pilot for review; do not treat this document as approval to migrate the entire administration system.

If the owner approves expansion after those gates, use a separate change and migrate one domain at a time: inventory its DAL/Server Actions/pages and existing key semantics; add typed action mappings without silently changing grants; migrate server enforcement first and verify direct refusal; then align sidebar/UI rules; extend static coverage and rerun the role matrix and size checks. Keep the remaining legacy nav-key handling until each affected domain is migrated. Evaluate the need for Mongo condition matching and permission-resolution scaling before adding domains that change those assumptions.
