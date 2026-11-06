# Next.js rules for translated pages

These come from the Next.js version installed in the project: `node_modules/next/dist/docs/01-app/02-guides/internationalization.md`, `01-app/01-getting-started/14-metadata-and-og-images.md` and `01-app/03-api-reference/04-functions/generate-metadata.md`. Read those files when a rule is unclear, because Next.js changes between versions.

The script checks the rules in this table with `--next`, and reports them under the language `code`. These are code problems, not translation errors, so report them separately and don't send them to a translator. Limit the check to the part being translated, or untranslated areas such as admin pages fill the report:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/check_translations.mjs --target-root docs/translations/drafts --next --next-root "src/app/(public)"
```

| Check | Rule | Why it matters for translation |
|-------|------|--------------------------------|
| `next-static-metadata` | Pages with translated titles use `generateMetadata`, not a static `metadata` export | A static export has one value, so the browser tab and search result stay in one language |
| `next-module-scope-t` | Translate inside the function that renders the text | Module code runs once, before any request has a language |
| `next-hardcoded-language` | `<html lang>` and the page direction come from the locale | Screen readers, spell checkers and search engines use `lang`, and `dir` lays out the page. `dir="ltr"` around a phone number is correct |
| `next-locale-in-client` | Language files load on the server | Layouts and pages are Server Components by default, so translation files stay out of the client bundle. Importing one into a client component sends it to every browser |

Read these yourself when a page or a language is added:

- **Routing:** a language comes from a sub-path or a domain, with the redirect in `proxy`. The installed version calls this file `proxy`, not `middleware`.
- **Unknown language:** check the language before using it, and call `notFound()`, so a missing translation gives a 404 and not a runtime error.
- **Static pages:** `generateStaticParams` lists the languages for static rendering.
- **Reading the language deep in the code:** `next/root-params` works in Server Components and server utilities, but not in Client Components, Server Actions or Route Handlers. Those need the language passed in.
- **Images with text:** a generated Open Graph image (`opengraph-image.tsx` with `ImageResponse`) draws its text into a picture, so that text needs translating too, and no translation file will show it.
- **Search engines:** `generateMetadata` sets `alternates.canonical` per language, `alternates.languages` for hreflang, and `openGraph.locale`. Each language needs its own canonical URL.

KALFA-specific points are in `src/lib/i18n/index.ts`: call `getT` inside the function that renders the text, and use its own i18next instance, because a module-wide language is not safe across requests.
