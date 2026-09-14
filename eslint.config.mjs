import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Isolated verification/staging build dirs + ad-hoc NEXT_DIST_DIR=.next-<label>,
    // plus the deploy/manual rollback dirs. No source path begins with `.next-` or
    // `.next.`, so these patterns match build artifacts only.
    ".next-*/**",
    ".next.old/**",
    ".next.rollback/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The bundled pg-boss worker artifact (esbuild output, not source).
    "dist/**",
    // Supabase schema types — generator output (`npm run gen:types`), never
    // hand-edited; `npm run types:check` guards it against the live DB instead.
    "src/lib/supabase/types.generated.ts",
    // Harness session data (not application source).
    ".remember/**",
    // Local agent/skill config — subagent defs, references, and VoxEngine template
    // scaffolds (which use require(Modules.X)). Gitignored, not application source.
    ".claude/**",
    // Cross-agent installed skills (skills-cli universal dir; .claude/skills
    // symlinks into it). Third-party skill scripts, not application source.
    // `**/` because agent labs (e.g. .fleet-logs/drafts/creative/*) carry their
    // own nested .agents/ installs of the same upstream skill packages.
    "**/.agents/**",
    // Minified / pre-built third-party bundles vendored as assets (gsap.min.js,
    // *.iife.js in the creative labs). Build OUTPUT of someone else's source —
    // hand-editing them corrupts the library, so they are not lintable by
    // definition. Our own lab sources (e.g. .fleet-logs/**/src/) stay linted.
    "**/*.min.js",
    "**/*.iife.js",
    // voxengine-ci helper scaffold (generated wrapper, not our source).
    "voximplant-ci/**",
    // voxengine-ci build output + local CI metadata mirror (generated, not
    // source). The hand-edited scenario sources under
    // voxfiles/applications/<app>/scenarios/src/ ARE linted — see the VoxEngine
    // override below.
    //
    // ⚠️ `applications/*/` IS PART OF THE PATH, and this glob is the reason the
    // repo-wide lint was red. voxengine-ci 36.0.0 moved scenarios per
    // application — its own README calls it a "Breaking change in 36.0.0" and
    // says the account-wide `scenarios/` folder "is no longer used":
    //
    //     <= 35.x   voxfiles/scenarios/src/<scenario>.voxengine.js
    //     36.0.0+   voxfiles/applications/<application-name>/scenarios/src/…
    //
    // The tree moved with the upgrade; these two globs did not, so they stopped
    // matching anything and every scenario was linted as ordinary Node source.
    // The `dist/` here needs its own entry because the root `dist/**` above is
    // anchored at the repo root and does not reach a nested one.
    //
    // `*` and not the one application we have today: the directory is named
    // after the application, the package treats that as a variable, and a second
    // application must not silently arrive unlinted the way this one did.
    "voxfiles/applications/*/scenarios/dist/**",
    "voxfiles/.voxengine-ci/**",
    // Vendored VoxEngine type declarations (downloaded oracle, not our source).
    //
    // Refreshed from https://cdn.voximplant.com/voxengine_typings/voxengine.d.ts
    // — that URL serves the LATEST engine (7.64.1 on 2026-09-15), which is not
    // the same as the copy bundled inside @voximplant/voxengine-ci (7.57.0).
    // Both are fed to every scenario build: voxengine-ci's generated tsconfig
    // lists them BOTH in `include`, and they conflict on hundreds of ambient
    // identifiers. `skipLibCheck: true` in that same generated config is the
    // only reason a build succeeds — measured 2026-09-15: 0 errors with it,
    // 67 without. The ElevenLabs surface is byte-identical between the two, so
    // nothing this repo depends on is ambiguous today.
    //
    // ⚠️ `voxengine-ci init` does NOT create this directory — it makes only
    // applications/, scenarios/, src/ and dist/. `typings/` is ours, and the
    // tool merely includes it if present. It is also excluded from the app's
    // own tsconfig; see the note there for why.
    "typings/**",
  ]),
  // Honor the codebase-wide `_`-prefix convention for intentionally-unused
  // bindings (e.g. the (prevState, formData) args that useActionState requires
  // even when an action ignores them). Non-underscore unused vars still report.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // VoxEngine scenario sources are hand-edited IaC (voxengine-ci) that run in
  // Voximplant's cloud as plain scripts with ambient platform globals. We LINT
  // them (rather than ignore them), but teach ESLint the runtime: `require(
  // Modules.X)` is a VoxEngine platform-global call — declared in the vendored
  // typings as `declare function require(module: Modules): void` — NOT a Node/
  // CommonJS import. `no-undef` is already off via typescript-eslint's
  // eslint-recommended layer, so the globals below are documentary / future-
  // proofing and list the globals actually referenced by the scenarios. Placed
  // last so it wins for the matched files.
  {
    files: ["voxfiles/applications/*/scenarios/src/**/*.js"],
    languageOptions: {
      // Scenarios contain no import/export — VoxEngine runs them as scripts.
      sourceType: "script",
      globals: {
        VoxEngine: "readonly",
        Modules: "readonly",
        require: "readonly",
        AppEvents: "readonly",
        Call: "readonly",
        CallEvents: "readonly",
        CallList: "readonly",
        ASR: "readonly",
        ASREvents: "readonly",
        ASRProfileList: "readonly",
        VoiceList: "readonly",
        Player: "readonly",
        PlayerEvents: "readonly",
        Net: "readonly",
        Logger: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
    rules: {
      // The ONLY rule these files genuinely need relaxed: `require(Modules.X)` is
      // a platform global, not a Node import.
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Operator scripts under scripts/ carry a .cjs extension precisely because
  // they are CommonJS: they are run straight with `node`, outside the Next
  // build, so `require()` is the correct form rather than a lapse. Scoping the
  // rule off by extension keeps it fully enforced everywhere else — which an
  // inline disable comment in each file would not.
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
