# English and French translation drafts

Drafts of the 148 keys in `src/locales/he/public.json`, as of main `2014385e`. Each language was translated by one agent and reviewed by a separate one.

These files stay outside `src/locales` on purpose: `npx i18next-cli locize-download` overwrites the target-language files there. Nothing here reaches the site or Locize yet.

- `<lng>/public.json`: the translation.
- `<lng>/glossary.md`: terms, with the source for each choice.
- `<lng>/notes.md`: open questions for the owner.
- `<lng>/review.md`: the independent review.
- `brief.md`, `review-brief.md`: the instructions the agents worked from.

The review findings are not applied yet: English has 1 should-fix and 5 preferences, French has 1 error, 3 should-fix and 5 preferences. Legal and consent wording waits for the owner.
