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
    // source). The hand-edited scenario sources in voxfiles/scenarios/src/ ARE
    // linted — see the VoxEngine override below.
    "voxfiles/scenarios/dist/**",
    "voxfiles/.voxengine-ci/**",
    // Vendored VoxEngine type declarations (downloaded oracle, not our source).
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
    files: ["voxfiles/scenarios/src/**/*.js"],
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
