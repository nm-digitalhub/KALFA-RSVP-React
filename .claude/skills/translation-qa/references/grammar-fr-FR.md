# French grammar checks (fr-FR)

Use when French is the target. The target is French as used in France.

Quebec guidance differs on spacing, so don't apply the OQLF spacing tables here: the OQLF puts no space before `;`, `!` and `?`. The elision rules below come from the OQLF because they are general French spelling rules. Other rules follow the Académie française, whose typography follows the Imprimerie nationale for the most part.

## Spacing

| Sign | Rule in France |
|------|----------------|
| `;` `!` `?` | Narrow non-breaking space (U+202F) before, or a non-breaking space (U+00A0) where the narrow one isn't available |
| `:` | Non-breaking space (U+00A0) before |
| `«` `»` | Non-breaking space (U+00A0) inside |
| `,` `.` | No space before |
| Number and unit, `%`, `€` | Non-breaking space before |

Report a plain space or a missing space before these signs. Accept either U+202F or U+00A0 in a string, because the rule allows the wider space when the narrow one isn't available. A plain space can leave the sign alone at the start of a line.

## Elision

- `le`, `la`, `de`, `je`, `me`, `te`, `se`, `ce`, `ne`, `que` and `jusque` elide before a vowel or a mute h. `si` elides only before `il` and `ils`.
- Elision also applies before proper names: `d'André`.
- There is no elision before an aspirated h, `huit`, `onze`, `oui`, or a number written in digits. There is none before most foreign words starting with y, such as `yaourt`, and none after `presque` or `quelque`, except `presqu'île` and `quelqu'un`.
- `ma`, `ta` and `sa` become `mon`, `ton` and `son` before a feminine word starting with a vowel or a mute h.
- A placeholder hides the next word, so `de {{name}}` and `le {{eventType}}` can't be correct for every value. Rephrase so that no elidable word or gendered article comes right before a placeholder.

## Agreement

- With a polite `vous` for one person, the verb is plural, but adjectives and participles are singular and match that person's gender: `Vous êtes très belle ce matin, Madame.`
- With `vous` for several people, adjectives and participles are plural.
- KALFA usually doesn't know the reader's gender. Rephrase so that no adjective or participle describes the reader, for example with a noun, as in `Votre réponse est enregistrée`.
- With `être`, the participle agrees with the subject: `Elle est arrivée`.
- With `avoir`, the participle agrees only with a direct object placed before it: `les crêpes qu'elle a mangées`, but `Elle a mangé des crêpes`.
- Indefinite `on` takes the masculine singular. When `on` means specific people, agreement follows the meaning.

## Capitals

- Capitals keep their accents, including `À` and `É`.
- Titles and headings capitalize the first word and proper names, not every word.

## Numbers

- `vingt` and `cent` take `s` when multiplied and not followed by another number: `deux cents euros`, but `deux cent vingt euros`. `mille` never changes.

## Plurals

- Plural keys need `_one` and `_other`. In French, 0 uses `_one`. `_many` is used only from 1,000,000, so it is optional for guest counts, but a count that large shows the raw key or the fallback language without it.

## Anglicisms

- Prefer the French word where one exists: `retour` for feedback, `personnaliser` for customiser, `informations` for news, `discours` for speech.
- The Académie also advises against `finaliser`, `performant`, `collaboratif` and `dédié à` in the sense of `consacré à`, and against `en termes de` in the sense of `en matière de`.
- The Académie accepts a borrowed word that has no ready French equivalent, meets a need and is clear. Don't replace an approved glossary term mechanically.

## Inclusive writing

- The Académie française opposes inclusive writing as a norm, so avoid forms such as `invité·e`. Rephrase neutrally instead.
- A `·` used as a separator is fine, such as `© {{year}} KALFA · Tous droits réservés`.

## Sources

- [Questions de langue, Académie française](https://www.academie-francaise.fr/questions-de-langue): `vous` agreement, participles, capitals, accents, numbers, anglicisms.
- [Déclaration sur l'écriture dite « inclusive », Académie française](https://www.academie-francaise.fr/actualites/declaration-de-lacademie-francaise-sur-lecriture-dite-inclusive): read in a search summary only.
- [Espace insécable](https://fr.wikipedia.org/wiki/Espace_ins%C3%A9cable) and [Ponctuation](https://fr.wikipedia.org/wiki/Ponctuation), Wikipédia, citing the *Lexique des règles typographiques en usage à l'Imprimerie nationale*. The Lexique itself was not read.
- [Élision obligatoire](https://vitrinelinguistique.oqlf.gouv.qc.ca/21737/lorthographe/elision-et-apostrophe/elision-obligatoire), [Élision interdite](https://vitrinelinguistique.oqlf.gouv.qc.ca/21745/lorthographe/elision-et-apostrophe/elision-interdite), OQLF.
- [Titres d'œuvres : règles typographiques, Le Robert](https://dictionnaire.lerobert.com/guide/titres-d-oeuvres-de-journaux-de-magazines-regles-typographiques): read in a search summary only.
- Plural categories: `Intl.PluralRules` in Node, and a run of i18next 26.7.1 with a form left out.
