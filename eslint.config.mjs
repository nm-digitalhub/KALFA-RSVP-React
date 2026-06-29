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
    // Isolated verification/staging build dirs (see package.json build/deploy).
    ".next-verify/**",
    ".next-stage/**",
    ".next.old/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The bundled pg-boss worker artifact (esbuild output, not source).
    "dist/**",
    // Harness session data (not application source).
    ".remember/**",
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
]);

export default eslintConfig;
