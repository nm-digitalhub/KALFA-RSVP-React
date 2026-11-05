<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- AICODE:START -->
@.claude/aicode-instructions.md
<!-- AICODE:END -->

## Internationalization

This project uses i18next. Locale files live in `src/locales/{{language}}/{{namespace}}.json`; the source language is `he`. Run `npx i18next-cli extract` after adding or changing `t()` calls and `npx i18next-cli status` to see what is still untranslated.

Translations are managed in Locize (project `f50fa8fe-abd4-4f62-97b9-8ae406dbb223`): `npx i18next-cli locize-sync` pushes new keys (add `--auto-translate true` for AI pre-translation) and `npx i18next-cli locize-download` pulls the translations back. Do not edit target-language files by hand; they are overwritten on download. The Locize API key belongs in the `LOCIZE_API_KEY` environment variable, never in client-side code.
