# Hebrew grammar checks

Use when Hebrew is the target, and when reading a Hebrew source.

The Academy of the Hebrew Language refused automated reads on 5.11.2026 (HTTP 403), so these rules come from Hebrew Wikipedia pages that summarize the Academy's rules, listed under Sources. Check the Academy directly for a disputed case. Academy rules are widely treated as recommendations, and usage varies.

## Definite article and construct state

- A construct takes the article on its last noun only: `בית הספר`, not `הבית ספר` or `הבית הספר`.
- A construct forms its plural on the first noun only: `בתי ספר`, not `בית ספרים`.
- A noun with an adjective takes the article on both: `הבית הגדול`.
- A long chain of constructs is correct but hard to read, so prefer a shorter phrase.

## Numbers

- The number agrees with the gender of the noun: `שלושה אבות`, `ארבע אימהות`.
- From 3 to 19, the masculine form is the one ending in ה. This is the reverse of most Hebrew words, and errors go both ways: `שלוש כיסאות` should be `שלושה כיסאות`, and `שישה דלתות` should be `שש דלתות`.
- `אחד` and `אחת` come after the noun. Other numbers come before it.
- The noun is plural from 2. Above 10, the singular is also accepted: `אחד עשר שקל`.
- With a definite noun, 3 to 10 take the construct form. Masculine: `שלושת הדובים`. Feminine: `שלוש הערים`.
- `מאה` is feminine (`שמונה מאות`). `אלף` is masculine (`חמישה עשר אלף`).
- Plural keys need three forms: `_one`, `_two` and `_other`. In Hebrew, 0 uses `_other`.

## Sentence structure

- The present tense has no verb "to be": `הדלת סגורה`. A sentence with a noun predicate may use a pronoun as the link.
- There is no verb "to have": `יש לי`.
- `את` comes only before a definite object.
- The present tense does not show person, so it needs a subject. Past and future can drop it.
- Verbs, adjectives and pronouns show gender and number, so a form that was neutral in English or French must become a choice in Hebrew. Use a neutral form when the reader is unknown, such as the plural `תגיעו`, or a form that the product already uses, such as `מגיע/ה`.

## Spelling without niqqud

- The sound o is written with ו: `בוקר`.
- After the sound e, there is usually no י: `ממד`, `אזור`.
- A consonantal י is not doubled next to a vowel letter: `פרויקט`, `מסוים`, `בעיה`.
- `אישה` has been the rule since 2017, and old dictionaries are unreliable on spelling.
- These rules don't apply to first names and family names, which often keep their traditional spelling.

## Punctuation

- Hebrew has used English-based punctuation since the Academy's 1994 decision. A comma usually does not come before the ו of "and".
- A maqaf joins words and has no spaces around it. A dash separates, so don't use one for the other. The keyboard hyphen is an accepted maqaf.
- A geresh marks an abbreviation: `גב׳`, `וכו׳`.
- Gershayim come before the last letter of an acronym and stay there when it inflects: `צה״ל`, `סמג״דים`.

## Sources

- [כתיב מלא](https://he.wikipedia.org/wiki/%D7%9B%D7%AA%D7%99%D7%91_%D7%9E%D7%9C%D7%90)
- [סמיכות](https://he.wikipedia.org/wiki/%D7%A1%D7%9E%D7%99%D7%9B%D7%95%D7%AA)
- [שם מספר](https://he.wikipedia.org/wiki/%D7%A9%D7%9D_%D7%9E%D7%A1%D7%A4%D7%A8)
- [מקף](https://he.wikipedia.org/wiki/%D7%9E%D7%A7%D7%A3), [גרש](https://he.wikipedia.org/wiki/%D7%92%D7%A8%D7%A9), [גרשיים](https://he.wikipedia.org/wiki/%D7%92%D7%A8%D7%A9%D7%99%D7%99%D7%9D), [סימני פיסוק](https://he.wikipedia.org/wiki/%D7%A1%D7%99%D7%9E%D7%A0%D7%99_%D7%A4%D7%99%D7%A1%D7%95%D7%A7)
- [Modern Hebrew grammar](https://en.wikipedia.org/wiki/Modern_Hebrew_grammar)
- Plural categories: `Intl.PluralRules` in Node, run 5.11.2026.
