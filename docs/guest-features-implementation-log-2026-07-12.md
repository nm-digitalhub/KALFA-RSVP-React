# יומן מימוש — 3 פיצ'רי אורח (Add-to-Calendar · תודה פוסט-אירוע · "מי עוד מגיע")

**תאריך:** 2026-07-12
**תוכנית מקור:** `.claude/plans/guest-features-natalie-learnings.md`
**סטטוס מסמך: FINAL.** שלושת הפיצ'רים **הושלמו — קוד + DB חי** (המיגרציות הוחלו על הפרויקט הלינק'ד ואומתו ישירות מול `supabase list_migrations`: `20260712174141_who_s_coming_opt_in` ו-`20260712174206_thankyou_template` שתיהן ברשימת המיגרציות הפרוסות). `types.ts` נוצר מחדש דרך `supabase gen types typescript --linked` — אין יותר type-gap. `next build --webpack` הצליח. עדיין **לא**: הגשת תבניות ל-Meta, `active=true`, שליחת-אמת, commit/deploy — ראו "מגודר" למטה.

> מסמך זה נכתב על ידי סוכן תיעוד נפרד (scribe) שלא כתב קוד. כל פרט אומת בקריאת הקוד/הבדיקות בפועל, לא רק מסיכומי הסוכנים.

---

## הקשר — למה

אירוע הברית של נטלי קלפה (12.07.2026) היה הרצת-אמת ראשונה מקצה-לקצה וחשף שלושה פערים ממשיים בחוויית האורח:

| פיצ'ר | הלמידה המניעה |
|---|---|
| **הוסף-ליומן** | 23 מאשרי-הגעה קיבלו רק תזכורת ביום האירוע עצמו — אין עוגן קודם ליומן → סיכון לשכחה/איחור |
| **תודה פוסט-אירוע** | אורח מגיע/שולח מתנה ולא מקבל הוקרה; ה-builder לתודה קיים לברית בלבד ולא פעיל (dormant) |
| **"מי עוד מגיע" (opt-in)** | 9/23 עדיין pending ביום האירוע; ערך FOMO חברתי עשוי להעלות אישורי-הגעה — אך חשיפת אורח-לאורח היא סיכון פרטיות שדורש גבול-אבטחה מוקפד |

**עיקרון-על מחייב מהתוכנית:** אפס קוד ידני — שימוש בספרייה מתוחזקת (`calendar-link`) ומיחזור דפוסים קיימים בלבד (RPC-through-`createAdminClient`, `getGiftByToken`, `sendEventDayReminderAction`, `celebrant-display`, `event-theme`, `date.ts`).

---

## סטטוס כולל — DONE (קוד + DB חי)

| פיצ'ר | קוד אפליקציה | DB/מיגרציה | תבניות Meta | טסטים | Gates |
|---|---|---|---|---|---|
| 1. הוסף-ליומן | ✅ הושלם — component + הטמעה כפולה (gift-landing **וגם** rsvp-form) | — (אין צורך) | — (אין) | ✅ 4 טסטים ב-`add-to-calendar.test.ts` | ✅ ירוק |
| 2. תודה פוסט-אירוע | ✅ הושלם מקצה-לקצה (gate + builder + עמוד `/ty/[token]` + טריגר + כפתור UI) | ✅ **מוחל על ה-DB החי** (`20260712174206_thankyou_template`); `active=false` (התנהגות בפועל, ראו פיצ'ר 2) | ✅ `docs/post-event-thankyou-meta-submission.md` — 9 גופים כתובים, **טרם הוגש ל-Meta** | ✅ 9 סוגי אירוע + fail-closed + gate-bypass + non-widening ב-`template-spec.test.ts`/`outreach.test.ts` | ✅ ירוק |
| 3. "מי עוד מגיע" | ✅ הושלם מקצה-לקצה (RPC + `rsvp.ts` + Zod + action + checkbox + רשימה ב-UI) | ✅ **מוחל על ה-DB החי** (`20260712174141_who_s_coming_opt_in`) | לא רלוונטי | ✅ tripwire מלא ב-`rsvp-privacy.test.ts` (13/13) | ✅ ירוק (types.ts עודכן, ה-gap נסגר — ראו למטה) |

מקרא: ✅ בוצע, אומת ו-DONE · — לא רלוונטי לפיצ'ר. שני המספרי-גרסה `20260712174141`/`20260712174206` אומתו ישירות מול `supabase list_migrations` על הפרויקט הלינק'ד (`cklpaxihpyjbhymqtduv`) — שניהם ברשימת המיגרציות שהוחלו בפועל.

**✅ ריסק timestamp collision — נפתר (supabase-native, לא רק שינוי-שם):** שתי המיגרציות נוצרו במקור עם חותמת-זמן ידנית זהה `20260712140000` (thankyou + who_s_coming_opt_in). לפי הנחיית team-lead, **שתיהן נוצרו מחדש** דרך `supabase migration new <name>` (ולא רק שינוי-שם ידני) — התוכן נשאר זהה, רק שם-הקובץ/חותמת-הזמן. שמות סופיים: `supabase/migrations/20260712174141_who_s_coming_opt_in.sql` ו-`supabase/migrations/20260712174206_thankyou_template.sql`. הקבצים הישנים עם החותמת המתנגשת נמחקו. `rsvp-privacy.test.ts`'s `WHO_S_COMING_MIGRATION` path constant ו-`docs/post-event-thankyou-meta-submission.md` עודכנו לשמות החדשים. אין יותר התנגשות שם-קובץ; סדר ה-apply חד-משמעי.

**✅ פער תיאום rsvp-form.tsx — נפתר:** `whoscoming` חיבר בפועל את `<AddToCalendar>` (שנוצר על ידי `calendar`) לתוך בלוק ה-notice שאחרי אישור הגעה מוצלח (`rsvp-form.tsx`, מוצג רק כש-`attending`) **במקביל, לפני** ש-snippet מ-`calendar` הגיע — לכן ה-JSX structure שלו (`{attending ? (...) : null}` נפרד, מיד אחרי פסקת "אפשר לעדכן...") אינו byte-for-byte זהה ל-fragment המדויק ש-`calendar` שלח, אך ה-props (`event.name/event_type/event_date/venue_name/venue_address/celebrants`) ומיקום הרינדור זהים לחלוטין — אין הבדל התנהגותי. אומת בקריאת קוד: אין TODO בקובץ; הרכיב פעיל ב-`rsvp-form.tsx:343`.

---

## פיצ'ר 1 — הוסף ליומן (Add to Calendar)

**קבצים:**
- חדש: `src/components/add-to-calendar.tsx`, `src/components/add-to-calendar.test.ts`
- עריכה: `src/app/(public)/g/[token]/gift-landing.tsx` (הטמעה על ידי `calendar`)
- עריכה: `src/app/(public)/r/[token]/rsvp-form.tsx` (הטמעה על ידי `whoscoming`, לפי snippet מ-`calendar` — בתוך בלוק `attending`, אחרי הצלחת שליחה)
- עריכה: `package.json`/`package-lock.json` — תלות חדשה `calendar-link@^2.11.4`

**מימוש:**
- `buildCalendarLinks(event)` — פונקציה טהורה, מופרדת מהקומפוננטה כדי להיות ניתנת לבדיקת-יחידה בלי JSX (vitest כאן רץ ב-node env, לא jsdom) — תואם את מוסכמת ה-repo (לוגיקה ב-`.test.ts`, לא snapshot-ים על JSX).
- שימוש ב-`google`/`outlook`/`ics` מ-`calendar-link` (2.11.4, MIT, מבוסס-dayjs, ESM+CJS, אין בעיות עם Next 16) — **אין** בניית query-string/.ics ידנית, בהתאם לכלל-הברזל.
- `end = start + 3h` — הנחת ברירת-מחדל **מתועדת בקוד** (`DEFAULT_DURATION_HOURS`), כי אין עמודת duration ב-DB.
- `location` נבנה מ-`venue_name`+`venue_address` (סינון ריקים).
- הכותרת נגזרת מ-`eventHeadingFor` (מיחזור `celebrant-display.ts`).
- Apple = קישור `data:text/calendar` דרך `download="event.ics"` (אין apple.com endpoint; זו הדרך הסטנדרטית).
- `AddToCalendar` מחזיר `null` כש-`event_date` חסר/לא תקין.

**מגבלה ידועה, לא-מתוקנת בכוונה (per כלל-הברזל):** `calendar-link`'s `outlook()` מפרמט start/end כזמן-מקומי-נאיבי (ללא UTC/offset, לפי אזור-הזמן של המערכת בזמן הקריאה) — לעומת `google()`/`ics()` שתמיד פולטות UTC מוחלט (`Z`/`...Z`), מאומת בטסטים. זו מגבלה ידועה של הספרייה עצמה, לא dossier-patch — לא תוקנה בקוד (per האיסור על hand-rolling). על שרת זה `Intl` מדווח Asia/Jerusalem כאזור המערכת, כך שנכון כרגע בפועל, אך **אינו TZ-safe by construction** כמו helpers ב-`date.ts`. מתועד ב-code comment, לא assumption שקטה.

**טסטים (`add-to-calendar.test.ts`, 4 describe-blocks):** null על תאריך חסר/לא-תקין · google/ics שומרים UTC מוחלט ללא תלות ב-TZ הריצה · כותרת ממוחזרת מ-`eventHeadingFor` · איחוד venue name+address למיקום יחיד (כולל השמטה מלאה כששניהם ריקים).

---

## פיצ'ר 2 — תודה פוסט-אירוע

**קבצים:**
- עריכה: `src/lib/whatsapp/template-spec.ts` (+ `template-spec.test.ts`), `src/lib/data/outreach.ts` (+ `outreach.test.ts`)
- עריכה: `src/lib/data/event-theme.ts` (`EVENT_THANKYOU_GREETING`)
- חדש: `src/lib/data/thankyou.ts`, `src/app/(public)/ty/[token]/{page.tsx,thankyou-landing.tsx}`
- חדש: `supabase/migrations/20260712174206_thankyou_template.sql` (נוצר דרך `supabase migration new thankyou_template`, מחליף קובץ ישן עם חותמת-זמן מתנגשת — ראו "סטטוס כולל")
- חדש: `docs/post-event-thankyou-meta-submission.md`
- עריכה: `next.config.ts` (בלוק headers `/ty/:token*`)
- עריכה: `campaign-actions.ts` (`sendThankyouAction`), `[campaignId]/page.tsx` + `manage-client.tsx` (חיווט + כפתור UI)

**2א' — פתיחת ה-send-gate:** `POST_EVENT_MESSAGE_KEYS = new Set(['thankyou'])` ב-`template-spec.ts`, single-source-of-truth. ב-`outreach.ts:~205`:
```ts
if (!POST_EVENT_MESSAGE_KEYS.has(messageKey) && isPastEventDay(ev?.event_date ?? null)) {
```
תיקון ממוקד בלבד — שאר הבדיקות (סטטוס קמפיין/אירוע `active`) נותרו כפי שהיו. `outreach-engine.ts` (drip), `assertEventNotPast` (campaigns lifecycle) ומסלול J5 **לא נגעו בהם כלל** (מאומת גם ב-diff, גם כטענה מפורשת ב-checkpoint).

**2ב' — Builder + תבנית:** `buildThankyouParams(ctx)` ב-`template-spec.ts`, במתכונת `buildEventDayReminderParams` — **בלי** venue/date. מחזיר `{ params: [label, celebrantsText] }` או `{ missing: ['celebrants'] }`. מיגרציה `20260712174206_thankyou_template.sql` מזרעת `message_key='thankyou'`, `name='kalfa_event_thankyou_v1'`, 9 `variants` per event-type + `param_contract='thankyou'`, בדפוס deep-merge זהה ל-`20260712124239_event_day_pay_template.sql`. `active` אינו מוגדר מפורשות ב-INSERT — נסמך על ברירת המחדל בסכימת הטבלה. **אומת בפועל אחרי ה-push:** השורה החיה של `message_key='thankyou'` היא `active=false`, כנדרש בתוכנית — מסלול השליחה נשאר INERT עד הפעלה מפורשת.

**2ג' — עמוד `/ty/[token]`:** `getThankyouByToken` — שכפול fail-closed של `getGiftByToken` (טוקן לא ידוע/אירוע לא-`active` → `null`, הודעה גנרית אחת). משתמש **באותו טוקן** `gift_link_token` כמו עמוד המתנה (שכפול טוקן פר-אירוע, מתועד בקוד). `thankyou-landing.tsx` משכפל מבנה `gift-landing.tsx` **בלי כפתור מתנה**, עם מפה נפרדת `EVENT_THANKYOU_GREETING` (past-tense, נבדל מ-`greeting` העתידי-לשון הקיים). `page.tsx`: `force-dynamic`, `robots: noindex`, `TOKEN_RE` 32-hex, rate-limit `ty:view:` (30/דקה), חתימת invite-image fail-open. `next.config.ts` מוסיף בלוק headers `/ty/:token*` זהה ל-`/g/:token*`.

**2ד' — טריגר:** `sendThankyouAction` משכפל בדיוק את דפוס `sendEventDayReminderAction` (`getCampaignForHold` → אימות `campaign.event_id===eventId` → `requireOwnedEvent` → `sendCampaignWhatsApp(campaignId, 'thankyou')`). כפתור UI ב-`manage-client.tsx` מגודר `s === 'active' && isPast`, עם אישור מפורש ("לשלוח הודעת תודה לכל המוזמנים עם הסכמה?").

**Meta:** `docs/post-event-thankyou-meta-submission.md` — 9 גופי UTILITY, `allow_category_change=false`, **ללא כפתורים** (אין CTA פוסט-אירוע), `{{1}}`=תווית סוג-אירוע, `{{2}}`=שמות חוגגים, ללא emoji. **טרם הוגש בפועל ל-Meta.**

**טסטים:** `template-spec.test.ts` — `buildThankyouParams` לכל 9 סוגי-אירוע (כולל סוגי-חוגג שונים ו-`host_composition` לברית/בריתה), מקרה fail-closed על חוגגים חסרים, ניתוב `buildBodyParams`, ובדיקת תוכן `POST_EVENT_MESSAGE_KEYS`. `outreach.test.ts` — שני טסטים חדשים: (1) `'thankyou'` עוקף את ה-gate ובאמת נשלח; (2) מפתח לא-רשום (`'thankyou2'`) **אינו** נפתח בטעות — עדיין נחסם אחרי יום-האירוע (מוודא שה-allow-list לא הורחב בטעות).

**שיקולי אבטחה/פרטיות:** ה-gate מוגבל במפורש למפתח `'thankyou'` בלבד; `/ty` חוזרת על אותה מדיניות no-store/no-referrer/noindex כמו `/g` ו-`/r`.

---

## פיצ'ר 3 — "מי עוד מגיע" (opt-in)

**קבצים:**
- חדש: `supabase/migrations/20260712174141_who_s_coming_opt_in.sql` (נוצר דרך `supabase migration new who_s_coming_opt_in`, מחליף קובץ ישן עם חותמת-זמן מתנגשת)
- עריכה: `src/lib/data/rsvp.ts`, `src/lib/validation/rsvp.ts`
- עריכה: `src/app/(public)/r/[token]/{actions.ts,page.tsx,rsvp-form.tsx}`
- עריכה: `src/app/(public)/r/[token]/rsvp-privacy.test.ts` (tripwire נוסף)

**מיגרציה:**
1. `alter table public.guests add column if not exists show_in_guest_list boolean not null default false` + `comment on column`.
2. `get_rsvp_by_token` — `create or replace` (ללא שינוי חתימה) כדי לחשוף גם את `show_in_guest_list` **של המבקש עצמו בלבד**, לטובת checkbox מסומן-מראש בביקור חוזר. **תוספת שלא הייתה מפורשת בתוכנית המקורית** — `whoscoming` ציין זאת במפורש כתוספת שקולה (needed for `defaultChecked` מ-`guest`), לא scope-creep שקט.
3. RPC חדש `get_event_attendees_public(_token text)` — `stable security definer set search_path=public`, מוגבל ל-`service_role` בלבד (`revoke`+`grant` מפורשים). מחזיר **שם-פרטי בלבד** דרך `split_part(btrim(og.full_name),' ',1)` — `full_name` לעולם לא עוזב את ה-DB. מסונן ל-`status='attending' AND show_in_guest_list=true`, `limit 200`, מגודר לפי אותו טוקן/revocation/`event.status='active'` כמו `get_rsvp_by_token`.
4. `submit_rsvp` — `drop+create` עם פרמטר נגרר `_show_in_list boolean default false`, עם defense-in-depth: `_show_list_n := false` מוכרח כש-`status<>attending`.
   **תיקון idempotency שנתפס ותוקן על ידי `whoscoming`:** בדיקת ה-unchanged המקורית משווה רק מול `rsvp_responses` (שאין בה עמודת `show_in_guest_list`) — שינוי checkbox בלבד היה עלול לגרום ל-no-op שגוי. תוקן על ידי השוואה נוספת מול `_g.show_in_guest_list` (שורת ה-guest הנעולה, pre-image) בנוסף לשדות הקיימים.

**שכבת אפליקציה:**
- `rsvp.ts`: `RsvpGuestInfo.show_in_guest_list: boolean` (עם תיעוד "own-row read only"); `RsvpAttendee { first_name }` + `getEventAttendeesPublic(token)` — מיחזור מדויק של `getRsvpByToken`; `submitRsvp` מעביר `_show_in_list: input.show_in_guest_list ?? false`.
- `validation/rsvp.ts`: `show_in_guest_list: z.boolean().optional()`.
- `r/[token]/actions.ts`: פרסור checkbox (`=== 'on'`).
- `r/[token]/page.tsx`: `getEventAttendeesPublic(token)` תחת rate-limit ייעודי `rsvp:attendees:${token}:${ip}`, fail-open ל-`[]`.
- `rsvp-form.tsx`: checkbox בבלוק `attending` ("להופיע ברשימת 'מי מגיע' — שם פרטי בלבד", `defaultChecked` מ-`guest.show_in_guest_list`); רשימת שמות מתחת לטופס, מוסתרת לגמרי כשריקה; **וגם** חיבור `AddToCalendar` (ראו פיצ'ר 1).
- **Tripwire (`rsvp-privacy.test.ts`):** קורא את גוף הפונקציה מתוך המיגרציה עצמה ומוודא: אין בחירת `og.phone/note/rsvp_note/meal_pref/contact_id`; בונה אך ורק `first_name` דרך `split_part`; מסנן `status='attending' AND show_in_guest_list=true`; מגודר לפי token/revocation/event-active; grants מוגבלים ל-`service_role`; `submit_rsvp` ממפה מ-`_show_list_n` המנורמל (לא מהקלט הגולמי).

**סטטוס types.ts — נסגר:** לאחר `supabase db push --linked` הורץ `supabase gen types typescript --linked` (אין עריכה ידנית, לפי [[no-hand-editing-generated-artifacts]]) — `get_event_attendees_public` ו-`guests.show_in_guest_list` כעת מוקלדים ב-`Database['public']['Functions']`/`Tables`. שגיאת ה-tsc שדווחה קודם (type-gap צפוי, ללא `any`/cast) נעלמה; `npx tsc --noEmit` הסופי = 0 שגיאות.

**סקירת אבטחה (team-lead, אחרי push):** `get_event_attendees_public` מאומת חי — מחזיר `first_name` בלבד (`split_part` ב-SQL), מסונן `status='attending' AND show_in_guest_list=true`, אימות המבקש דרך `rsvp_token`, grant ל-`service_role` בלבד. שכפול `get_rsvp_by_token` אומת ששומר את **כל 10 השדות החיים** הקיימים (`show_meal_pref`, `gift_link_token`/`provider`, `celebrants`, `can_respond`, `rsvp_note` ועוד) ורק **מוסיף** `show_in_guest_list` — ללא רגרסיה.

---

## דפוסים קיימים שמוחזרו (ללא קוד ידני)

| דפוס קיים | שימוש חוזר |
|---|---|
| `calendar-link` (npm) | כל קישורי הוסף-ליומן — Google/Outlook/ICS |
| `eventHeadingFor` (`celebrant-display.ts`) | כותרת אירוע עקבית בהוסף-ליומן, בגיפט-לנדינג ובעמוד תודה |
| `buildEventDayReminderParams` | מתכונת ל-`buildThankyouParams` |
| `getGiftByToken` / `gift-landing.tsx` | מתכונת מדויקת ל-`getThankyouByToken` / `thankyou-landing.tsx` |
| `sendEventDayReminderAction` | מתכונת מדויקת ל-`sendThankyouAction` |
| `getRsvpByToken` / `get_rsvp_by_token` | מתכונת מדויקת ל-`getEventAttendeesPublic` / `get_event_attendees_public` |
| `createAdminClient()` | גישת RPC אחידה בכל שכבת ה-data |
| `formatEventDateLine` / `date.ts` | תאריכים בכל שלושת הפיצ'רים |
| `rsvp-privacy.test.ts` (tripwire קיים) | הורחב עבור ה-RPC/RPC-change החדשים |
| `next.config.ts` בלוק `/g/:token*` | שוכפל ל-`/ty/:token*` |

---

## אימות (Verification) — שלב 1, פר-צוות (before integration)

| צוות | tsc --noEmit | eslint | vitest run |
|---|---|---|---|
| `calendar` | נקי (repo מלא) | נקי (3 קבצים שנגעו) | 1144 עברו / 19 דולגו / 0 נכשלו |
| `thankyou` | נקי לכל קבציו (שגיאה אחת קיימת קודם שייכת לעבודת `whoscoming` המקבילה) | נקי | 1166 עברו / 19 דולגו / 0 נכשלו |
| `whoscoming` | שגיאה אחת צפויה (RPC טרם ב-types.ts באותו שלב); שום `any`/cast | נקי | 23/23 עברו (r/[token] + add-to-calendar.test.ts) |

## אימות (Verification) — סופי, אחרי אינטגרציה + push (team-lead)

| Gate | תוצאה |
|---|---|
| `npm run lint` | נקי |
| `npx tsc --noEmit` | **0 שגיאות** (type-gap נסגר אחרי `gen types`) |
| `next build --webpack` | **הצליח** — נבנה בהצלחה; `/ty/[token]`, `/g/[token]`, `/g/[token]/go` קיימים ב-output |
| `npx vitest run` | **1166 עברו / 0 נכשלו / 19 דולגו** (+26 טסטים חדשים מה-workstream הזה) |
| מיגרציות | `20260712174141_who_s_coming_opt_in` + `20260712174206_thankyou_template` — **הוחלו על ה-DB החי** דרך `supabase db push --linked`; אומת ישירות מול `list_migrations` + `select ... from message_templates where message_key='thankyou'` → `active=false` בפועל |
| `supabase gen types typescript --linked` | הורץ; `src/lib/supabase/types.ts` נוצר-מחדש (אין עריכה ידנית) |
| סקירת אבטחה | בוצעה על ידי team-lead — ראו פירוט בפיצ'ר 3 |

---

## אזהרות ידועות (Known Warnings)

**`supabase db push --linked` — אזהרת cache לא-קטלנית, root-cause סופי (לא ניחוש):**

הפקודה מדפיסה:
```
Warning: failed to cache migrations catalog ... Failed to read certificate file
'/workspace/supabase/.temp/pgdelta/pgdelta-target-ca.crt': ENOENT
```

- **סיבת-שורש (upstream CLI bug, קיים גם ב-2.109.1 העדכני ביותר):** ה-CLI **כותב** את חבילת ה-CA לנתיב ה-temp האמיתי של הפרויקט, `supabase/.temp/pgdelta/pgdelta-target-ca.crt` (אומת: הקובץ קיים בפועל, חבילת CA תקינה עם 3 תעודות) — אך ה-edge-runtime של pg-delta **קורא** אותו מ-`/workspace/supabase/.temp/...`. `/workspace` היא ספרייה בבעלות root בתוך ה-sandbox (permission-denied למשתמש שלנו) — כלומר יש חוסר-התאמה בין ה-path/CWD שה-CLI כותב אליו לזה שה-edge-runtime הפנימי שלו קורא ממנו.
- **השפעה בפועל: אפס.** המיגרציה **תמיד** מוחלת במלואה ("Finished supabase db push" עדיין מודפס). השלב שנכשל הוא אך ורק ה-cache **שלאחר** ה-apply, שמזין תכונות `db diff`/declarative-schema — לא בשימוש בזרימת העבודה של הפרויקט הזה.
- **ניתנת-לתיקון? לא מהצד שלנו.** אי אפשר לכתוב ל-`/workspace` בבעלות root; ה-CLI כבר בגרסה העדכנית ביותר. זו תקלה upstream ב-Supabase CLI.
- **החלטה:** known-benign — להמשיך להשתמש ב-`supabase db push` (הפקודה הנכונה לניהול היסטוריית מיגרציות) ולהתעלם מהאזהרה. החלופה היחידה להימנעות ממנה היא החלה דרך ה-Supabase MCP (`apply_migration`/`execute_sql`, שעוקפים את pg-delta לגמרי) — לא נחוצה כאן מכיוון שהאזהרה מוכחת לא-מזיקה.

---

## מגודר (דורש אישור נפרד — לא בסקופ המימוש, לפי התוכנית)

- הגשת 9 תבניות התודה ל-Meta (הגוף מוכן ב-`docs/post-event-thankyou-meta-submission.md`, טרם הוגש).
- הפעלת `active=true` על רשומת התבנית `thankyou` (אומת חי: עדיין `false`).
- כל שליחת-אמת (WhatsApp) — רק דרך כפתור מאומת באפליקציה (`sendThankyouAction`); לא בוצעה שום שליחת-אמת.
- Commit / deploy לשום קובץ מהעבודה הזו — עדיין לא בוצעו (רק המיגרציות DB הוחלו; שכבת האפליקציה נשארת local).

---

## תהליך ותיאום (Process & Coordination)

מסמך זה נכתב על ידי סוכן ייעודי (`scribe`) שרץ **במקביל** לשלושה סוכני-מימוש (`calendar`, `thankyou`, `whoscoming`), כחלק מצוות multi-agent שמתואם על ידי team-lead. הסוכנים שלחו checkpoints התקדמות תוך-כדי עבודה (חלקם retroactive milestone trails); ה-scribe אימת כל checkpoint מול הקבצים בפועל (`git status --short` + קריאת diff/תוכן מלא) לפני תיעודו — כולל שני פערים אמיתיים שנתפסו ותוקנו תוך-כדי:

1. **התנגשות timestamp במיגרציות** — שתי מיגרציות עצמאיות (`thankyou`, `who_s_coming_opt_in`) נוצרו במקור עם אותה חותמת-זמן ידנית `20260712140000`. סומן ל-team-lead; לפי הנחייתו, **שני** הצוותים יצרו מחדש את המיגרציה שלהם דרך `supabase migration new` (supabase-native, לא רק שינוי-שם ידני) — שמות סופיים `20260712174141_who_s_coming_opt_in.sql` ו-`20260712174206_thankyou_template.sql`, כולל עדכון הפניות בקבצים תלויים (`rsvp-privacy.test.ts`, `docs/post-event-thankyou-meta-submission.md`).
2. **תיאום cross-file ב-`rsvp-form.tsx`** — `whoscoming` ערך את הקובץ עבור פיצ'ר 3 וחיבר בעצמו את `AddToCalendar` (במקביל, לפני קבלת ה-snippet המדויק מ-`calendar`) — לא השאיר TODO תלוי. נפתר בפועל בין הצוותים (agent-to-agent): התוצאה תואמת functionally ל-snippet של `calendar` (אותם props, אותו מיקום), גם אם מבנה ה-JSX המדויק נכתב בנפרד.

זו דוגמה מוחשית לערך של תיעוד-מאומת-קוד לצד checkpoints מילוליים: שני הפערים היו נראים רק בקריאת ה-diff עצמו, לא רק בסיכום המילולי של כל צוות בנפרד.

**סגירה:** לאחר שלושת הצוותים דיווחו DONE, team-lead ביצע מעבר אינטגרציה סופי — push של שתי המיגרציות ל-DB החי, `gen types`, `next build --webpack` מלא, וסקירת אבטחה ל-`get_event_attendees_public`/`get_rsvp_by_token`. ה-scribe אימת עצמאית שתי טענות מפתח מול ה-DB החי (לא רק דיווח מילולי): (1) שתי המיגרציות אכן ברשימת `supabase list_migrations` הפרוסה; (2) שורת `message_templates` עבור `thankyou` היא בפועל `active=false`. שלושת הפיצ'רים DONE ברמת קוד+DB; הפריטים היחידים שנותרו מגודרים לאישור נפרד (Meta, `active=true`, שליחת-אמת, commit/deploy).
