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
    // Harness session data (not application source).
    ".remember/**",
    // Local agent/skill config — subagent defs, references, and VoxEngine template
    // scaffolds (which use require(Modules.X)). Gitignored, not application source.
    ".claude/**",
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
]);

export default eslintConfig;
