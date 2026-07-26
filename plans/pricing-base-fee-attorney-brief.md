# Attorney brief + S6 spec — base-fee pricing agreement clause

**Status:** ADVISORY-verified by `israeli-compliance-advisor` (2026-07-26), NOT legal approval. The advisor is explicit: *"מידע משפטי ולא ייעוץ משפטי — אין זה אישור משפטי; החתימה הסופית להפעלה מסחרית היא של עו״ד מוסמך לדיני הגנת הצרכן בלבד."* This file is the record + the S6 implementation spec. Attorney questions 16-18 are recorded in `.claude/agents/shared/legal-catalog-israel.md`.

**Model:** flat activation fee **₪200** charged ALWAYS on campaign activation (even 0 reached — a deliberate reversal of the current agreement §4 "0 contacts → no charge") + **200 reached included** + **₪4** per reached above 200. Ceiling = `200 + 4×max(0, maxContacts−200)`.

**Advisory verdict:** **conditional GO** subject to the 5 attorney decisions below. **Final go-live sign-off is a licensed consumer-protection attorney's — not the agent's.** The agreement stays DRAFT (`AGREEMENT_VERSION='draft-2026-07-v3'`) until approved; go-live also requires flipping `app_settings.base_overage_pricing_enabled=true`.

---

## 1. Final Hebrew clause (replaces `template.ts` §3-4, lines ~192-209)

Uses the existing `intent` block class (framed/bold) — no CSS change. `{{ceiling}}` must be computed in the NEW model (`200 + 4×max(0, maxContacts−200)`).

```html
<h2>3. המחיר והחיוב</h2>
<dl class="terms">
  <dt>דמי הפעלת שירות</dt><dd>₪200.00 — תשלום עבור הפעלת הקמפיין (הפעלת המערכת והפצת הפניות בערוצים), הכולל עד 200 אנשי קשר שהושגו. מחיר סופי; לא נגבה מע"מ (עוסק פטור).</dd>
  <dt>אנשי קשר כלולים בדמי ההפעלה</dt><dd>200 אנשי קשר שהושגו</dd>
  <dt>תוספת מעבר לכלול</dt><dd>₪4.00 לכל איש קשר ייחודי נוסף שהושג מעבר ל‑200 הכלולים; מחיר סופי, לא נגבה מע"מ</dd>
  <dt>מספר אנשי קשר מרבי</dt><dd>{{maxContacts}}</dd>
  <dt>תקרת חיוב מרבית</dt><dd>{{ceiling}} — דמי הפעלה בתוספת ₪4 לכל איש קשר מעל 200 ועד למספר המרבי; מחיר סופי, לא נגבה מע"מ</dd>
  <dt>חלון פעילות</dt><dd>{{windowText}}</dd>
</dl>

<div class="intent">
  שימו לב — דמי ההפעלה בסך ₪200 נגבים עם הפעלת הקמפיין <strong>בכל מקרה, גם אם לא הושג אף איש קשר (0 תוצאות)</strong>. דמי ההפעלה הם תשלום עבור עצם הפעלת השירות והפצת הפניות בערוצים, ואינם מותנים בתוצאה. חיוב מעבר לדמי ההפעלה (₪4 לכל איש קשר שהושג מעל 200 הכלולים) מחושב לפי מספר אנשי הקשר שהושגו בפועל, ועד לתקרה.
</div>

<p>"איש קשר שהושג" = אדם שיצר אינטראקציה אנושית מאומתת (תגובת וואטסאפ נכנסת אמיתית, או מענה אנושי בשיחה), פעם אחת לכל איש קשר באותו אירוע. החיוב שמעבר לדמי ההפעלה נקבע בסגירת הקמפיין לפי מספר אנשי הקשר שהושגו בפועל מעל 200 הכלולים.</p>
<p><strong>מעבר לדמי ההפעלה, לא יחויבו:</strong></p>
<ul>
  <li>הודעה שנשלחה / נמסרה / נקראה ללא תגובה</li>
  <li>צלצול ללא מענה אנושי, תא קולי או משיבון</li>
  <li>מספר שגוי או לא זמין</li>
  <li>אותו איש קשר יותר מפעם אחת באותו אירוע</li>
  <li>אנשי קשר בגבולות 200 הכלולים בדמי ההפעלה (אינם מוסיפים לחיוב)</li>
</ul>

<h2>4. אמצעי תשלום, מועד חיוב והרשאת חיוב</h2>
<p>הלקוח מאשר שמירת אמצעי תשלום ו/או תפיסת מסגרת אשראי עד גובה התקרה. <strong>דמי ההפעלה (₪200) ייגבו במועד הפעלת הקמפיין בפועל</strong> — עם תחילת מתן השירות — ולא במועד החתימה. יתרת החיוב (תוספת ₪4 לכל איש קשר מעל 200 הכלולים) תיגבה בסגירת הקמפיין לפי הביצוע בפועל, ולכל היותר עד התקרה. נתוני הכרטיס מנוהלים באמצעות ספק סליקה מאובטח (טוקניזציה); KALFA אינה שומרת את פרטי הכרטיס.</p>
<p>בוטלה העסקה עקב פגם, אי‑התאמה או הפרה של KALFA — יושבו ללקוח מלוא התשלומים ששולמו, לרבות דמי ההפעלה, בהתאם לחוק הגנת הצרכן. אין באמור בסעיף זה כדי לגרוע מזכויות הביטול שבסעיף 5.</p>
```

### Dedicated acknowledgement checkbox (separate UI gate, captured in the §9 evidentiary chain — NOT in the agreement body)

Worded as **consent/undertaking to a commercial term**, NOT an "I read / I'm aware" declaration — deliberately, to reduce exposure to standard-contracts §4(12) (see decision #2):

```
☐ אני מאשר/ת ומסכים/ה כי דמי ההפעלה בסך ₪200 ייגבו עם הפעלת הקמפיין בכל מקרה,
  לרבות אם לא יושג אף איש קשר (0 תוצאות), וכי מעבר ל‑200 אנשי הקשר הכלולים
  אחויב ב‑₪4 לכל איש קשר נוסף שהושג, עד לתקרה.
```

---

## 2. Attorney decision list (only a licensed attorney can make these)

| # | Decision | Anchor | Advisory rec | Label |
|---|---|---|---|---|
| 1 | Is a fixed, pre-disclosed activation fee charged even at 0 results NOT an unfair term? | חוזים אחידים §3+§4 (not §4(4) — fixed, no unilateral discretion) | Enforceable if framed as **activation fee** for work actually done (real channel costs) + prominent + proportionate. No direct precedent. | **inference** (law-anchored, not case-law) |
| 2 | Does the dedicated checkbox help enforceability — or itself fall under §4(12) ("customer declares awareness")? What wording? | חוזים אחידים **§4(12)** (verified verbatim) | The framed/bold disclosure is the primary tool (not §4(12)). Checkbox worded as consent/undertaking, not "I read/aware". Language still broad — attorney's call. | **attorney question** (law verified, application open) |
| 3 | Is the activation fee (charged at RUN, not authorize) non-refundable on cancellation, subject to a defect/breach carve-out? | §14ג(ג)(2) · §14ה(ב1) · **§14ה(א)(1)** | Charge at ACTUAL activation = start of service ⇒ the "2 days before" window closes on activation; mandatory full-refund carve-out for defect/breach (built into §4 above). | statute **verified**; transaction classification (continuous/not) = **open attorney question** (same as §6 item 3) |
| 4 | Which marketing headline wordings are permitted without misleading? | הגנת הצרכן **§2** (misrepresentation on a material matter — price) | No "pay-by-result-only" / "0 results = 0 pay" / any outcome-only impression; include the activation-fee disclosure in every marketing surface (headline/landing/checkout). | §2 = **verified prohibition**; application = **inference** |
| 5 | May the model apply to agreements signed under v3? | חוזים אחידים **§4(4)** + contract-modification law | **No retroactive application.** v3→v4, NEW signers only; existing signed agreements stay under v3. | **strong inference** (safe conservative cut) |

---

## 3. Implementation notes for S6 (owner/dev — outside the attorney's scope)

- `template.ts`: new tokens `baseFee`=200, `includedContacts`=200; `pricePerReached` now maps to the ₪4 overage; recompute `{{ceiling}}` = `200 + 4×max(0, maxContacts−200)`. Bump `AGREEMENT_VERSION` v3→**v4**.
- The checkbox must be captured in the same evidentiary anchor as the signature (§9: OTP+IP+UA+timestamp+SHA-256), as a separate boolean with a timestamp.
- `template.test.ts` will need updating for the new structure/ceiling.
- Capture the ₪200 at RUN (activation), not at authorize — aligns the money with the clause + limits the cancellation-refund exposure.
- These are DRAFT until the attorney signs off; go-live also needs `base_overage_pricing_enabled=true`.
