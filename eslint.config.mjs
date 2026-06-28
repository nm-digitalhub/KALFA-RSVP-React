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
    // Harness session data (not application source).
    ".remember/**",
  ]),
]);

export default eslintConfig;
