# English and French translation drafts

Drafts of the 148 keys in `src/locales/he/public.json`. Each language was translated by one agent and reviewed by a separate one.

These files stay outside `src/locales` on purpose: `npx i18next-cli locize-download` overwrites the target-language files there. Nothing here reaches the site or Locize yet.

- `<lng>/public.json`: the translation.
- `<lng>/glossary.md`: terms, with the source for each choice.
- `<lng>/notes.md`: open questions for the owner.
- `<lng>/review.md`: the independent review.
- `brief.md`, `review-brief.md`: the instructions the agents worked from.

The review findings are applied, and the same reviewers rechecked the changed keys. Two preferences were kept on the translator's reasoning: `site.guestListTemplate.closing.subtitle` in English and `site.home.features.subtitle` in French. Legal and consent wording, and the problems found in the Hebrew source, wait for the owner.
