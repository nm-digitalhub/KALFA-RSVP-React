import { defineConfig } from 'i18next-cli'

export default defineConfig({
  locales: [
    "he",
    "en",
    "fr"
  ],
  extract: {
    input: "src/**/*.{ts,tsx}",
    ignore: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test/**"],
    output: "src/locales/{{language}}/{{namespace}}.json",
    defaultNS: "common",
    extractFromComments: false,
    warnOnConflicts: "warn",
    preservePatterns: ["whatsappErrors:*"]
  },
  locize: {
    projectId: "f50fa8fe-abd4-4f62-97b9-8ae406dbb223",
    apiKey: process.env.LOCIZE_API_KEY
  }
})