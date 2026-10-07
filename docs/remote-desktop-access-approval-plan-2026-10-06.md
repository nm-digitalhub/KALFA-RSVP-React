# תוכנית מימוש: תהליך אישור גישה לשולחן העבודה המרוחק (xrdp)

**תאריך:** 2026-10-06 · **סטטוס:** תוכנית בלבד. לא הוחל דבר על השרת, על מסד הנתונים או על קוד המוצר.
**מסמך מלווה (ראיות ומחקר):** `docs/remote-desktop-access-approval-research-2026-10-06.md`

מקרא: **[אומת]** נקרא בקוד או נמדד בפועל · **[מסקנה]** נגזר מקוד או תיעוד · **[לא נבדק]** הנחה.

## 0. סטטוס יישום (מתעדכן)

| שלב | מצב |
|---|---|
| P0 גיבויים | **בוצע** (2026-10-06): `xrdp.ini`, `sesman.ini`, קובץ PAM של xrdp, חומת אש ו-nginx, ב-`/var/www/vhosts/kalfa.me/backup-rdpgw-20261006` |
| P1 מיגרציה `20261006164315_rdp_access_approval.sql` | **הוחלה על ידי הבעלים**, והטיפוסים נוצרו מחדש. `types:check` עובר |
| סקירה בלתי תלויה של המיגרציה | נמצאו 3 פגמים חוסמים (B1 מחיקת משתמש נחסמת, B2 ו-B3 החלטות NULL) ועוד ממצאים משניים. כולם רדומים כי הטבלאות ריקות |
| מיגרציית תיקון `20261006170320_rdp_access_approval_fixes.sql` | **נכתבה, עברה בדיקות סטטיות, ממתינה לסקירה ולהחלה על ידי הבעלים** |
| P1 ליבת האפליקציה `src/lib/rdp-access/*`, ולידציה | **נכתבה ונבדקה** (קבועי מדיניות, הגדרות השער, עטיפות RPC, ולידציה) |
| P2 נתיב בדיקת השער, כותרות, sweep ורישום ב-worker | **נכתבו ונבדקו**, **לא נפרסו** |
| המשך: P3 CLI, P7 מסכי צוות והורדה, P4-P6 תשתית השער | טרם התחילו |

הערות סטייה מהטקסט המוטמע בחלק א: הפונקציה שבודקת grant בשער נקראת **`rdp_check_tunnel(p_target, p_client_ip, p_tunnel_ref)`** (ולא `rdp_check_grant`), וכתובת הנתיב היא `/api/internal/rdp-gateway/tunnel-check`. כל הפניה ל-`rdp_check_grant` בחלק א מוחלפת בהן. נוסף משתנה הגדרה `RDPGW_USER` (חשבון ה-OS שהשער נכנס בשמו).

## 1. מה נבנה, ובאילו החלטות

זרימה: איש צוות נכנס לאתר ומבקש גישה → הבקשה מופיעה ב-CLI בשרת → הבעלים מאשר או דוחה → איש הצוות מוריד קובץ `.rdp` → פותח אותו בלקוח RDP מקומי. הדפדפן משמש להזדהות, לבקשה ולהורדה בלבד.

החלטות הבעלים שעיצבו את התוכנית:
- המבקשים הם **אנשי צוות בלבד** (`platform_staff`, התחברות והרשאות קיימות). המאשר הוא **הבעלים בלבד**, ב-CLI.
- ההתחברות לשולחן העבודה נשארת עם המשתמש המשותף **`kalfa.me`**. אין חשבונות OS אישיים.
- שני מסלולי חיבור: **(a)** Tailscale ישיר (מכשירי הבעלים, ללא שינוי, ללא אישור), **(b)** שער RD Gateway (`rdpgw`) לאנשי צוות בלי Tailscale. האישור נאכף במסלול (b).
- פורט 3389 לא נחשף לאינטרנט.
- **grant פעיל אחד בכל רגע** (סשן xrdp אחד משותף).

## 2. תקציר

- **אפשרי, ורוב החלקים קיימים:** התחברות, מסד נתונים, התראות, תורי עבודה ותבניות CLI. נבנים: טבלאות בקשה ו-grant, מסך צוות, נתיב הורדה, CLI מאשר, נתיב בדיקה לשער ו-sweep פקיעה (צד האפליקציה, חלק א).
- **השער:** `rdpgw` (Apache-2.0, מוצמד ל-commit `16cdaaf4`) עם patch מקומי קטן. בלי ה-patch אין בדיקת grant בכל חיבור ואין ניתוק של מנהרה חיה. הקבצים נמצאים ב-`ops/rdpgw/` (S1+S2 בוצעו 6.10; ראו README שם). הבנייה: `ops/rdpgw/build.sh` עם Go 1.26.6, שלושה patches, `go test -race` ירוק, וסריקת `govulncheck` (קוד ובינארי) כתנאי חובה: 0 פגיעויות מושפעות. ה-sha256 הרשום ב-`ops/rdpgw/BINARY_SHA256` הוא `ebfcdf0c66bffe9809796d30417d2781ad0775450f9f23639fe81edf41230071` (שתי בניות מאפס נתנו אותו hash). ה-hash הקודם `f4b47672…` (Go 1.26.2, שני patches) הוחלף. השער לא הותקן ולא הופעל.
- **אכיפה:** גם קובץ שכבר הורד לא פותח מנהרה חדשה אחרי ביטול או פקיעה, כי כל מנהרה חדשה עוברת בדיקה מול KALFA (fail-closed). מנהרה חיה נחתכת תוך שניות, וגם נסגרת לבד בפקיעת ה-grant.
- **כניסה ללא סיסמה (תהליך מובנה, סעיף 3א):** הקובץ נושא אסימון קצר-חיים בשדה שם המשתמש, ו-xrdp בודק אותו דרך PAM במקום סיסמה. סיסמת `kalfa.me` לא נשמרת ולא מועברת לאיש.
- **אישור שער ≠ הזדהות OS:** האישור שולט **בכניסה** בלבד. לשער יש עוגיית PAA, ל-xrdp יש כניסת PAM נפרדת של `kalfa.me`. מי שנכנס מקבל שולחן עבודה שקול ל-root. זו החלטת הבעלים והיא מתועדת כסיכון R1.

## 3. עובדות שמעצבות את התוכנית

1. **לעולם אין restart ל-`xrdp` או `xrdp-sesman`** [אומת בקוד 0.9.24]. הרשימה של הסשנים נשמרת בזיכרון בלבד. אחרי restart הסשן הקיים (`:10`) נשאר יתום, חיבור חדש יוצר `:11`, וכל חיבור RDP חי נקטע, כולל זה של הבעלים. שינויי `sesman.ini` נכנסים עם `SIGHUP`, ושינויי `xrdp.ini` נקראים בכל חיבור חדש.
2. **last-wins:** `xorgxrdp` מרשה לקוח אחד לכל סשן. חיבור של איש צוות מנתק את החיבור החי של הבעלים, ולהפך [אומת].
3. **ביטול לא סוגר את הסשן:** הביטול חותך את מנהרת השער ולא את סשן ה-xrdp, כי הוא משותף לבעלים. כל מה שאיש הצוות הפעיל נשאר רץ.
4. **חומת האש לא מסננת:** ב-INPUT יש `ACCEPT` כללי (כלל 40, catch-all של Plesk). הפרטיות של 3389 נשענת על כתובת ה-bind (`100.106.199.107`) ולא על חומת אש [אומת]. נוסף לכך `plesk ext firewall --apply` מוחק כללי INPUT ידניים וקפיצות imunify/ts-input [אומת]. לכן ההקשחה מוצעת בטבלת `raw` ולא ב-`filter`.
5. **שער → xrdp עובר דרך `lo`**, לא דרך `tailscale0`. כל DROP על 3389 חייב לפטור `lo` ו-`tailscale0` [אומת].
6. **`rdpgw`:** טוקן PAA בתוקף 5 דקות קשיח; נבדק רק ביצירת מנהרה; אין hooks או API אדמין; `Disconnect` הקיים הוא קוד מת. ה-legacy HTTP transport לא עובד ב-header-only, ולכן נדרש WebSocket. גרסת v2.2.0 חסרה את ההקשחות ולכן מקבעים commit של master.
7. **טיילנט עם משתמש אחד** (הבעלים) [אומת]. מי שיצורף אליו יעקוף את האישור, כי הוא יגיע ל-3389 ישירות. לכן **אין לצרף אנשי צוות ל-Tailscale** בלי להקים קודם allow-list (חלק ב, סעיף 5.6).
8. **הסיסמה המשותפת של `kalfa.me`** היא הגורם השני היחיד אחרי השער. ל-xrdp אין jail ב-fail2ban, ובגלל המקור הקבוע (`100.106.199.107`) אי אפשר להסתמך על זיהוי לפי IP.

### 3א. כניסה ללא סיסמה: שרשרת מובנית (במקום סיסמה משותפת)

כלל עבודה של הבעלים: **לא כותבים קוד ידני כשקיים תהליך מובנה.** השרשרת הבאה מתועדת ומיושמת בכלים עצמם. כתיבה ידנית נשארת רק היכן שאין תהליך מובנה (ה-patch של בדיקת grant ב-`rdpgw`, וצד האפליקציה).

1. **`rdpgw` (מובנה):** `Security.EnableUserToken: true` ו-`Client.UsernameTemplate: "kalfa.me\x1f{{ token }}"`. בקובץ ה-`.rdp` שדה `username` מכיל את שם חשבון ה-OS, תו מפריד (`0x1f`) ואסימון JWE מוצפן (A128CBC_HS256) בתוקף 5 דקות. נדרשים: `UserTokenEncryptionKey` (32 תווים), ו-`NoUsername: false` (בחלק ב הוגדר `true`, וההגדרה הזו מתבטלת). אימתתי בקוד `security/jwt.go` ובתיעוד README.
2. **`xrdp` 0.9.24 (מובנה):** `enable_token_login=true` ב-`[Globals]` של `xrdp.ini`. כשהלקוח שולח שם משתמש עם `0x1f` וסיסמה ריקה, xrdp מפצל: מה שאחרי המפריד הופך לסיסמה, והחלק שלפניו נשאר שם המשתמש (`libxrdp/xrdp_sec.c`, שורות 1023-1033; אומת בקוד). `xrdp.ini` נקרא בכל חיבור חדש, ללא restart.
3. **`pam-jwt` (מובנה, מאותו מחבר):** מודול PAM שמיועד לדיוק הזה ("connecting RDP users to XRDP without passwords", README שלו). שורה אחת בקובץ `/etc/pam.d/xrdp-sesman`, לפני `@include common-auth`: `auth sufficient pam_jwt.so token_url=http://127.0.0.1:3013/tokeninfo?access_token`. הוא קורא ל-`/tokeninfo` של `rdpgw` בלופבק, שמוודא הצפנה, מנפיק ופקיעה (אומת בקוד).

**התאמות שהשרשרת המובנית מחייבת:**
- **הזהות בשער היא `kalfa.me` ולא `grant-<uuid>`.** `pam-jwt` דורש שה-subject של האסימון יהיה משתמש OS קיים ושווה לשם המשתמש (אומת ב-`pam.go`: `get_uid` ו-`verify_user`). בגלל זה בדיקת ה-grant בשער מתבססת על "יש grant פעיל לכתובת ולצורת היעד הזו" (grant פעיל אחד בכל רגע), והשיוך לאדם נשאר ב-KALFA (מי הוריד, מאיזה IP). בטבלת סעיף 4 השורה "זהות בכותרת" מתוקנת בהתאם.
- **`/tokeninfo` נשאר חסום מבחוץ** (allow-list ב-nginx של חלק ב), ו-`pam-jwt` פונה אליו ישירות בלופבק `127.0.0.1:3013`.
- **`pam-jwt` לא מתוחזק:** עדכון אחרון ב-2020-09, 10 כוכבים, רישיון MIT, כ-4 קבצי Go. כדי להשתמש בו: מקבעים commit, סוקרים את הקוד (מודול PAM בנתיב כניסה של חשבון שקול ל-root), בונים ב-scratchpad (`make`, Go `c-shared`) ומתקינים ב-`/lib/security`. אם הסקירה לא עוברת, זה פער אמיתי שיצדיק אז (ורק אז) רכיב משלנו.
- **סיסמת `kalfa.me` ממשיכה לעבוד** לכניסה רגילה שלך. אסימון פגום או שפג נופל ל-`common-auth` כניסיון סיסמה שגוי, ולכן יש לבדוק שמודולי `pam_imunify` ו-`pam_plesk` לא סופרים אותו כניסיון תקיפה.

## 4. התאמות חוזה בין חלק א (אפליקציה) לחלק ב (תשתית)

שני החלקים נכתבו במקביל והם לא זהים בפרטי הממשק. לפני מימוש מאחדים לפי הטבלה. הבחירה נטתה למה שכבר נבנה ונבדק בצד ה-patch.

| נושא | חלק א (אפליקציה) | חלק ב (תשתית) | הכרעה |
|---|---|---|---|
| נתיב בדיקת grant | `/api/rdp-gateway/check` | `/api/internal/rdp-gateway/tunnel-check` | נתיב החלק ב. ה-`location` החוסם ב-nginx: `^~ /api/internal/rdp-gateway/` |
| אימות הקריאה | כותרת `x-rdp-gateway-secret` | `Authorization: Bearer <GRANTCHECKTOKEN>` | `Bearer` (מומש ונבדק ב-patch). נתיב ה-Route Handler משווה ב-`safeTokenEqual` |
| גוף הבקשה | `{user, target, clientIp, phase, tunnelRef}` | `{user, clientIp, target, tunnelId, rdgConnectionId}` | גוף החלק ב. אין שדה `phase` |
| גוף התשובה | `{allow, expires_at}` | `{"allow":true,"grantId","expiresAt"}` | פורמט החלק ב (camelCase). כל מה שאינו 200 עם `allow:true` נחשב דחייה |
| בדיקה חוזרת (recheck) | נדרשה בדיקה כל 30-60 שניות | אין. יש טיימר סגירה ב-`expiresAt` + ניתוק אדמין + סקר `GET /admin/v1/tunnels` ב-worker | תכנון החלק ב. מבטלים את `phase:'recheck'` |
| זהות בכותרת | `grant-<uuid>` | `X-Kalfa-Staff-Id` (מזהה משתמש) | **ערך הכותרת = `kalfa.me`** (נדרש ל-`pam-jwt`, סעיף 3א). בדיקת ה-grant מתבצעת לפי כתובת ויעד מול ה-grant הפעיל היחיד. השם החדש: `X-Kalfa-Gateway-User` |
| סודות | `RDPGW_CHECK_SECRET`, `RDPGW_CONNECT_SECRET`, `RDPGW_ADMIN_SECRET` | `GRANTCHECKTOKEN`, `HEADER__SECRET` (`X-Kalfa-Internal`), `ADMINTOKEN` | מיפוי 1:1 לפי הסדר. כל שלושת הסודות חייבים להיות ≥32 תווים |
| קריאה ל-`/connect` | לופבק | `http://127.0.0.1:3013` (לא `localhost`) | `127.0.0.1:3013`, עם `X-Forwarded-For` = IP הדפדפן מתוך `X-Real-IP` (ולא הרכיב הראשון של `X-Forwarded-For`) |
| ניתוק | `disconnectGrant(grantId)` | `POST 127.0.0.1:3014/admin/v1/disconnect {"user":…}` | תואם: `user` = `grant-<uuid>` |
| יעד | `RDPGW_TARGET` שנקבע בשרת ונשמר ב-`grants.target` | `nm-digitalhub.tail703115.ts.net:3389` (MagicDNS) | הערך בחלק ב. עובר את ה-CHECK של `target` בחלק א |

דורש בדיקה בפועל: ה-patch 0002 (סוד משותף על `/connect`) הוא תוספת מעבר לבקשה המקורית. החלק ב ממליץ עליו, והחלטה נדרשת (שאלה 3).

## 5. סדר מימוש משולב ושערי אישור

כל שלב באישור מפורש של הבעלים. מיגרציות מוחלות על ידו, והפריסה ידנית על ידו (כלל "אין שרתים או פורטים אד-הוק"). אין להפעיל restart ל-xrdp. אין לפרוס את האפליקציה בזמן שאיש צוות מחובר, כי `kalfa-beta` עולה מחדש בכל פריסה.

| שלב | מה | שער |
|---|---|---|
| P0 | החלטות (סעיף 6), גיבויים (חלק ב סעיף 4.2), בדיקת ACL של Tailscale בקונסולה, סריקה חיצונית של 3389 | אישור התוכנית |
| P1 | מיגרציה (dry-run מקומי), `gen:types`, ליבת `src/lib/rdp-access`, ולידציה, בדיקות (חלק א שלבים 1-2) | הבעלים מחיל את המיגרציה |
| P2 | נתיב הבדיקה לשער, headers ב-`next.config.ts`, sweep ותור (חלק א שלבים 3-4) | פריסת worker ואפליקציה על ידי הבעלים |
| P3 | CLI (חלק א שלב 5), קריאה בלבד בהרצה הראשונה | — |
| P4 | `ops/rdpgw/` ובנייה (חלק ב S1-S2), הכנת משתמש/תיקיות/סודות/יחידת systemd בלי להפעיל (S3) | אישור הורדת מודולי Go, ניקוי מטמון שנוצר בטעות |
| P5 | DNS ל-`gw.kalfa.me` ≥3 שעות לפני החלון (S4), nginx + deny בנתיב הפנימי + logrotate (S5) | `nginx -t` ואז `reload` |
| P5ב | כניסה ללא סיסמה (סעיף 3א): סקירת קוד `pam-jwt` ובנייה מקובעת, מפתח `UserTokenEncryptionKey`, שורת PAM בקובץ של xrdp-sesman בלבד, `enable_token_login=true`. **גיבוי של שני הקבצים לפני שינוי, ושחזור דרך SSH אם PAM נכשל** | הבעלים מאשר, חלון + גיבוי |
| P6 | הפעלת `rdpgw` (S6) ובדיקות 1-12 | הבעלים מפעיל |
| P7 | מסך צוות, נתיב הורדה, מסכי בעלים (חלק א שלבים 6-8) | פריסה על ידי הבעלים |
| P8 | בדיקת קצה-לקצה בחלון תחזוקה (S8). **תנתק את הבעלים** בגלל last-wins | הבעלים מתאם |
| P9 | אופציונלי, כל אחד בנפרד: `AllowRootLogin=false` ו-`MaxSessions=3` (HUP), כלל `raw` ל-3389 (אחרון), ניטור | חלון + גיבוי + rollback |

## 6. החלטות בעלים (המלצה בסוגריים)

1. מי מקבל את מפתח `rdp.request`? (רק הבעלים; תפקידים אחרים מסומנים ב-`/admin/roles` לפי צורך.)
2. כניסה ללא סיסמה דרך השרשרת המובנית (סעיף 3א: אסימון בקובץ, `enable_token_login`, `pam-jwt`) במקום מסירת הסיסמה? (כן; בכפוף לסקירת `pam-jwt` ולבדיקת לקוחות אמיתיים.)
3. לאשר fork מקומי של `rdpgw` (patch 0001 לבדיקת grant וניתוק, patch 0002 לסוד על `/connect`)? (כן; כ-700 שורות הנדרשות לסקירה, בנייה דטרמיניסטית ו-commit מקובע.)
4. לאשר הורדת מודולי Go מהרשת לבנייה, ולמחוק את רשומות המטמון שנוצרו בטעות (סעיף 8)? (כן לשתיים.)
5. `systemd` עם משתמש ייעודי במקום pm2 לשער? (כן.)
6. `conf.d` ידני (`rdpgw-proxy.conf`) ושינוי `beta-proxy.conf` (חסימת הנתיב הפנימי)? (כן.)
7. לקבל ש-last-wins מנתק את הבעלים בכל חיבור של איש צוות, ולתאם מראש? (כן; אפשר גם לחסום בקשה כשהבעלים מחובר.)
8. `AllowRootLogin=false` ו-`MaxSessions=3` ב-sesman (בלי restart)? (כן. קבוצת `tsusers`: לא כעת.)
9. להשבית clipboard, כוננים, מדפסת ו-PnP במסלול (b) כברירת מחדל? (כן; הגבלה בצד הלקוח, לא גבול אבטחה.)
10. כלל `raw` ל-3389 בחלון תחזוקה, בסוף, אחרי שמסלול (b) עובד? (כן.)
11. `tailscale cert` ל-xrdp? (לא כעת. השם נחשף ב-Certificate Transparency.)
12. פרמטרים: בקשה פגה אחרי 30 דקות, משך 30/60/120/240 עם תקרה קשיחה 240 ב-DB, 20 הורדות ל-grant, אישור עצמי מותר? (כן.)

## 7. מה עדיין לא נבדק

- **לקוחות אמיתיים:** אם Windows App ב-macOS/iOS/Android מכבד `gatewayaccesstoken` מקובץ; אם Android פותח `.rdp`; התנהגות NLA מול xrdp מחוץ ל-iPad (iPad התחבר ישירות עם SSL). `mstsc` מציג אזהרה בכל פתיחה מאז אפריל 2026. פירוט בחומר המחקר.
- **אסימון בשדה שם המשתמש:** אם `mstsc` ו-Windows App מקבלים תו מפריד `0x1f` בשדה `username` ושולחים סיסמה ריקה; אורך האסימון (המגבלה 511 תווים); ואם ניסיון אסימון שגוי נספר ב-`pam_imunify`. נדרשת בדיקה בפועל לפני הרחבה.
- **Tailscale:** מדיניות ה-ACL של הטיילנט (נמצאת בקונסולה ולא נקראת מהשרת).
- **חשיפה חיצונית:** אין סריקה חיצונית של 3389 ושל שאר הפורטים; לא ידוע אם חומת האש של ספק האירוח חוסמת.
- **Imunify360 WebShield:** התנהגות מול WebSocket ארוך.
- **ממצא צדדי (לא חלק מהפיצ'ר):** ה-catch-all של Plesk הופך את INPUT ל-allow-all, וכמה שירותים מאזינים על `0.0.0.0` (למשל 11211 memcached, 6333 qdrant, 2049/111 NFS). לא נבדק מבחוץ. לא נוגעים בזה בתוכנית הזו.

## 8. גילוי נאות על ריצת המחקר

- סוכני המחקר והתכנון עבדו בקריאה בלבד. הכתיבה הייתה ב-scratchpad בלבד, למעט **חריגה אחת של סוכן התשתית:** פקודת `go vet` הורצה בלי משתני הסביבה של ה-scratchpad והורידה 15 מודולי Go למטמון הרגיל `/var/www/vhosts/kalfa.me/go/pkg/mod` (וכנראה גם רשומות ב-`~/.cache/go-build`). אלה מטמונים בלבד, לא קוד ולא תצורה, ולא נוקו. ניקוי מוצע רק לרשומות חדשות מ-18:40 ואילך, באישור.
- ריצות שאינן שינוי מערכת: `go test` עם שרתי `httptest` בלופבק, הרצת הבינארי המתוקן 8 פעמים עם קונפיג שגוי בכוונה (יצא לפני bind), `nginx -t -c` על קונפיג פרטי, `iptables-restore --test`, `systemd-analyze verify`, וכל פקודות ה-`sudo` היו קריאה בלבד.
- הטיוטות (patches, `build.sh`, `rdpgw.yaml`, `rdpgw.service`, `rdpgw-proxy.conf`, כללי raw) נמצאות ב-`/tmp/claude-10003/-var-www-vhosts-kalfa-me-beta/9b86a809-6388-4803-a63f-1d093dfccf79/scratchpad/drafts/`. נתיב זמני של הסשן. בשלב P4 הן עוברות ל-`ops/rdpgw/`, באישור.

---

# חלק א. צד האפליקציה (KALFA)

*מוטמע כמות שהוגש, ללא עריכה. ההתאמות לחוזה מול חלק ב מפורטות בסעיף 4 למעלה, והן גוברות במקרה של סתירה.*

תוכנית צד-האפליקציה לזרימת אישור גישת שולחן עבודה מרוחק (RDP) — כל 11 הסעיפים, תכנון בלבד, לא שונה אף קובץ, לא הורצה שום פקודת כתיבה/DDL, לא נפתח אף קובץ .env*.

מקרא: VERIFIED = קראתי את הקוד/המיגרציה/התצורה. INFERRED = הסקה שלא נבדקה בפועל. DRAFT = קוד שנכתב כאן לבדיקה בלבד.

=====================================================================
0. הכרעות עיקריות ומקומות שבהם סטיתי מההנחות
=====================================================================
1. כל הכתיבות (בקשה, ביטול, הורדת קובץ, אישור, ביטול-בעלים, בדיקת הגשר, sweep) הן RPC מסוג SECURITY INVOKER עם EXECUTE ל-service_role בלבד, ונקראות רק משרת (Server Action / Route Handler / CLI / worker) עם מזהה משתמש שנגזר מ-getUser() — לא מהדפדפן. סיבה: אם ה-RPC היה פתוח ל-authenticated (כמו fleet_answer_request), איש צוות עם המפתח היה יכול לקרוא לו ישירות מהדפדפן ולעקוף את מה שקיים רק בצד-האפליקציה: זיהוי IP, התראה לבעלים, בדיקת Origin. ה-DB עדיין בודק בעצמו את המפתח (has_platform_permission_for_user) בתוך כל RPC — זו הנעילה השנייה. קריאות של צוות: RLS "רק שלי" + הרשאות עמודה (פירוט בסעיף 1). החלופה (DEFINER + auth.uid() בסגנון fleet) מוצגת כשאלה פתוחה 12.
2. אין מפתח הרשאה "מאשר". האישור הוא בעלים בלבד, ונבדק בתוך ה-RPC לפי is_owner_role (תאום חדש is_platform_owner_for_user). מפתח אישור היה הופך להרשאה שמסמנים ב-/admin/roles — ז"א "בעלים בלבד" לא היה נשמר.
3. זהות השער = ה-grant ולא האדם: KALFA שולח ל-rdpgw בכותרת המשתמש את grant-<uuid>. בדיקת הגשר מחפשת שורה אחת לפי המזהה, וקובץ מ-grant ישן מת איתו.
4. מקור האמת ליומן הביקורת הוא טבלה ייעודית append-only (rdp_access_events), נכתבת בתוך אותה טרנזקציה של שינוי המצב. אין שיקוף ל-activity_log (נימוק בסעיף 8, שאלה 7).
5. אין דגל-ביטול ייעודי ב-DB. מתגי הכיבוי: (א) הסרת/אי-הגדרת RDPGW_CHECK_SECRET => נתיב הבדיקה מחזיר 503 וכל מנהרה חדשה נחסמת; (ב) הסרת מפתח rdp.request מתפקיד ב-/admin/roles (UI קיים, כלל "מתג כיבוי חייב UI"); (ג) CLI revoke.

=====================================================================
2'. גבול האמון — נאמר כאן במפורש כי הוא קובע את שאר התוכנית
=====================================================================
עובדות:
- VERIFIED: ה-CLI ו-ה-worker ו-Next רצים עם .env.local (package.json: node --env-file=.env.local; ecosystem.config.cjs: "load their own configuration/secrets from .env.local"). createAdminClient קורא SUPABASE_SERVICE_ROLE_KEY מ-process.env (src/lib/supabase/admin.ts), ו-src/lib/queue/web-sender.ts קורא SUPABASE_DB_HOST/USER/PASSWORD מ-process.env — כלומר הקובץ מחזיק מפתח service-role וגם סיסמת Postgres (שמות המשתנים אומתו מהקוד; הערכים לא נפתחו).
- INFERRED: משתמש ה-OS kalfa.me הוא הבעלים של תיקיית האפליקציה וה-pm2, ולכן מושב כ-kalfa.me מסוגל לקרוא את .env.local.
המסקנה: מי שמקבל grant מקבל מעטפת root-שקולה עם גישה למפתח service-role, לסיסמת ה-DB, ל-CLI עצמו. בזמן grant חי המקבל יכול (א) להריץ את ה-CLI ולאשר לעצמו, (ב) לקרוא כל RPC של service_role ישירות, (ג) כנראה גם להסיר טריגרים (בעזרת סיסמת ה-DB). לכן:
- הוכחת הסמכות של ה-CLI היא שיוך (attribution) ולא אימות (authentication). בפועל: ה-CLI מעביר approver uid מפורש, ה-RPC מוודא is_platform_owner_for_user(approver), ובנוסף נרשמים משתמש ה-OS, שם המארח, SSH_CONNECTION (רמז בלבד — תהליך שרץ כ-kalfa.me שולט במשתני הסביבה שלו), האם יש TTY, וגרסת ה-CLI. האימות האמיתי היחיד הוא מי שיכול להיכנס ל-SSH כ-kalfa.me.
- יומן ה-DB ניתן להסתרה בזמן grant חי. הבקרה היחידה ששורדת: אות out-of-band שנשלח מחוץ למערכת על כל שינוי מצב — push למכשיר הבעלים (sendPushToUser, מסונן לתפקיד הבעלים בלבד; לא לכל platform_staff כמו notifyAdmins) והתראת Slack בקטגוריית security (קטגוריה קיימת, VERIFIED ב-src/lib/data/alerts-config.ts). ההודעה כבר יצאה ולא ניתן "לבטל" אותה אחרי המעשה. תוספת: התראה מפורשת (level error) כשמתבצע approve/revoke/cancel בזמן שיש grant פעיל — כי זה הדפוס של תוקף שמנסה לעצב מחדש את המצב.
- אישור ≠ הכלה: המערכת שולטת בכניסה, לא במה שעושים בפנים.
- שאלה לתשתית (plan-infra / rdp-client-compat), כן/לא: האם המקבל צריך להקליד את סיסמת ה-OS של kalfa.me כדי לעבור את כניסת xrdp? אם כן, קיים אישור root לשימוש חוזר מחוץ למערכת הזו, והאישור/ההפקעה של KALFA אינם מגינים עליו.
- נתיב (א) (Tailscale ישיר) לא מגודר בתוכנית — מי שעל ה-tailnet עוקף אישור. ואם xrdp מאזין על ממשק ציבורי, גם הגשר נעקף; זה פריט תשתית.
(קבלת הסיכון לחשבון משותף: החלטת הבעלים, נרשמת כסיכון R1 בסעיף 11 ולא נדונה מחדש.)

=====================================================================
1. מודל נתונים
=====================================================================
מיגרציה אחת: supabase/migrations/<ts>_rdp_access_approval.sql — השם נוצר על ידי `npx supabase migration new rdp_access_approval` (הבעלים מריץ). אין שימוש בסוגי ENUM של PG: text + CHECK. UUID v7 כמו המיגרציות האחרונות.

מיגרציות מקבילות שעליהן מבוססת המוסכמה (VERIFIED):
- 20261006065916_payment_refund_cap.sql — כותרת עם Rollback, SECURITY INVOKER + search_path '' , בלוק DO של אימות שמבטל את המיגרציה כולה אם נכשל.
- 20261006040156_payment_ledger_db_guards.sql — אימות prosecdef / proconfig / ACL בבלוק DO.
- 20261006031606_payment_operation_lines.sql — טבלה סגורה: RLS פעיל, אפס policies, revoke all מ-public, anon, authenticated; טריגר append-only.
תבניות מבניות: 20260723094500_fleet_requests.sql (מכונת מצבים + חסימת DELETE/TRUNCATE + carve-out ל-FK ON DELETE SET NULL), 20260929001415_test_event_purge.sql (זריעת מפתח הרשאה: "seeded to the owner role; grant further in the roles UI"), 20260924034054_owner_agent_whatsapp.sql (תאומי *_for_user, ACL: revoke מ-public, anon, authenticated ואז grant ל-service_role).

מצבים ומעברים:
- בקשה: pending -> approved | denied | expired | cancelled (כולם סופיים).
- grant: active -> revoked | expired | ended (סופיים). revoked = בעלים או הסרת הרשאה (ended_reason='access_removed'); ended = המשתמש עצמו; expired = זמן.
- grant לעולם לא מתארך במקום: expires_at בלתי-ניתן לשינוי (הארכה = בקשה חדשה).
- נעילת "grant פעיל אחד": אינדקס יחיד חלקי ייחודי על ביטוי קבוע (נעילה אמיתית; exists() בטריגר אינה נעילה, כפי שמוסבר ב-20261004105957).

מה נשמר לביקורת: בבקשה — מבקש, סיבה (עד 500 תווים, טקסט חופשי של איש צוות), דקות מבוקשות, IP בקשה (נקבע בשרת), פסק דין, מאשר, הקשר CLI, הערה. ב-grant — יעד, תקופה, מי אישר/סיים ולמה, מונה הורדות, מצב ניתוק מנהרות. באירועים — סוג, שחקן, IP לקוח, מזהה מנהרה אטום, תוצאה, פרטים קטנים בלי PII ובלי סודות.
שמירה: בקשות ו-grants — ללא מחיקה (נפח זניח). אירועים — 2 שנים (אין מחיקה בגרסה 1; בדיקה מחדש בעוד שנתיים). IP (ב-events.client_ip וב-requests.request_ip) מאופס ל-NULL אחרי 90 יום, דרך הצורה היחידה שהטריגר מתיר (UPDATE של client_ip ל-NULL בלבד תחת GUC טרנזקציוני). זה ברירת מחדל מוצעת — שאלה 11.

DRAFT של המיגרציה (לא מוחל):

```sql
-- rdp_access_approval — per-grant, owner-approved, time-boxed access to the shared remote desktop.
-- Admission control only: it decides WHO may open NEW gateway tunnels and WHEN; it does not contain
-- what a grantee does once inside (the OS account is shared and root-equivalent).
-- Closed tables + service_role-only RPCs (the browser has no EXECUTE at all). RLS on as a second layer.
-- Rollback (manual, approval required, nothing else depends on these yet):
--   drop function if exists public.rdp_redact_old_ips(timestamptz), public.rdp_record_event(text,text,uuid,uuid,inet,text,text),
--     public.rdp_mark_cut(uuid,boolean,text), public.rdp_sweep(timestamptz), public.rdp_check_grant(uuid,text,text,inet,text),
--     public.rdp_end_grant(uuid,uuid,text), public.rdp_end_own_grant(uuid), public.rdp_answer_request(uuid,uuid,text,integer,text,text,jsonb),
--     public.rdp_begin_file_issue(uuid,inet), public.rdp_cancel_request(uuid,uuid), public.rdp_request_access(uuid,text,integer,inet),
--     public.rdp_expire_stale(timestamptz), public.rdp_log(text,text,uuid,uuid,uuid,inet,text,text,jsonb),
--     public.is_platform_owner_for_user(uuid);
--   drop table if exists public.rdp_access_events, public.rdp_access_grants, public.rdp_access_requests;  -- in this order
--   drop function if exists public.rdp_access_requests_guard(), public.rdp_access_grants_guard(), public.rdp_access_events_guard(), public.rdp_access_no_truncate();
--   delete from public.platform_permission_definitions where key = 'rdp.request';  -- cascades the owner grant row

-- 1. permission key. The owner row is written by trigger platform_permission_grant_owner (20260719215138).
--    NO other role is granted here; the owner ticks it per role in /admin/roles if ever wanted.
insert into public.platform_permission_definitions (key, label, category, sort_order)
values ('rdp.request', 'בקשת גישה לשולחן עבודה מרוחק', 'ops', 90)
on conflict (key) do nothing;

-- 2. owner twin, same recipe as is_platform_staff_for_user (20260924034054)
create or replace function public.is_platform_owner_for_user(_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_staff s
    join public.platform_roles r on r.id = s.role_id
    where s.user_id = _user_id and r.is_owner_role);
$$;
revoke all on function public.is_platform_owner_for_user(uuid) from public, anon, authenticated;
grant execute on function public.is_platform_owner_for_user(uuid) to service_role;

-- 3. tables
create table public.rdp_access_requests (
  id                uuid primary key default extensions.uuid_generate_v7(),
  requester_id      uuid references auth.users (id) on delete set null,
  reason            text not null check (char_length(btrim(reason)) between 10 and 500),
  requested_minutes smallint not null check (requested_minutes between 5 and 240),
  request_ip        inet,
  status            text not null default 'pending'
                    check (status in ('pending', 'approved', 'denied', 'expired', 'cancelled')),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '30 minutes',
  answered_by       uuid references auth.users (id) on delete set null,
  answered_at       timestamptz,
  granted_minutes   smallint check (granted_minutes between 5 and 240),
  answer_note       text check (answer_note is null or char_length(answer_note) <= 500),
  approver_context  jsonb check (approver_context is null or octet_length(approver_context::text) <= 1000),
  cancelled_at      timestamptz,
  constraint rdp_access_requests_expiry_after_create check (expires_at > created_at),
  constraint rdp_access_requests_state_consistency check (case status
    when 'pending'   then answered_at is null and cancelled_at is null and granted_minutes is null
    when 'approved'  then answered_at is not null and granted_minutes is not null and cancelled_at is null
    when 'denied'    then answered_at is not null and granted_minutes is null and cancelled_at is null
    when 'expired'   then answered_at is null and cancelled_at is null
    when 'cancelled' then cancelled_at is not null and answered_at is null end)
);
create unique index rdp_access_requests_one_pending_uq on public.rdp_access_requests (requester_id) where status = 'pending';
create index rdp_access_requests_pending_idx   on public.rdp_access_requests (created_at) where status = 'pending';
create index rdp_access_requests_requester_idx on public.rdp_access_requests (requester_id, created_at desc);
create index rdp_access_requests_answered_by_idx on public.rdp_access_requests (answered_by) where answered_by is not null;

create table public.rdp_access_grants (
  id             uuid primary key default extensions.uuid_generate_v7(),
  request_id     uuid not null unique references public.rdp_access_requests (id) on delete restrict,
  user_id        uuid references auth.users (id) on delete set null,
  granted_by     uuid references auth.users (id) on delete set null,
  target         text not null check (target ~ '^[A-Za-z0-9.-]{1,253}:[0-9]{1,5}$'),   -- decided by the SERVER at approval, never by the requester
  status         text not null default 'active' check (status in ('active', 'revoked', 'expired', 'ended')),
  starts_at      timestamptz not null default now(),
  expires_at     timestamptz not null,
  ended_at       timestamptz,
  ended_by       uuid references auth.users (id) on delete set null,
  ended_reason   text check (ended_reason is null or ended_reason in ('revoked_by_owner', 'expired', 'ended_by_user', 'access_removed')),
  files_issued   smallint not null default 0 check (files_issued >= 0),
  max_files      smallint not null default 20 check (max_files between 1 and 100),
  last_file_at   timestamptz,
  cut_attempts   smallint not null default 0,
  cut_ok_count   smallint not null default 0,
  last_cut_at    timestamptz,
  last_cut_error text check (last_cut_error is null or char_length(last_cut_error) <= 40),  -- a fixed code, never a body
  tunnels_cut_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- DB-level ceiling: root access is never longer than 4 hours, whatever the caller passes.
  constraint rdp_access_grants_window check (expires_at > starts_at and expires_at <= starts_at + interval '240 minutes'),
  constraint rdp_access_grants_state_consistency check ((status = 'active') = (ended_at is null))
);
-- THE LOCK: at most one active grant, enforced in the btree (not by an exists() check).
create unique index rdp_access_grants_one_active_uq on public.rdp_access_grants ((true)) where status = 'active';
create index rdp_access_grants_user_idx       on public.rdp_access_grants (user_id, created_at desc);
create index rdp_access_grants_granted_by_idx on public.rdp_access_grants (granted_by) where granted_by is not null;
create index rdp_access_grants_cut_pending_idx on public.rdp_access_grants (ended_at) where status <> 'active' and tunnels_cut_at is null;

create table public.rdp_access_events (
  id         uuid primary key default extensions.uuid_generate_v7(),
  at         timestamptz not null default now(),
  kind       text not null check (kind ~ '^[a-z_]{3,40}$'),          -- open set; the list lives in src/lib/rdp-access/events.ts + a drift test
  request_id uuid references public.rdp_access_requests (id) on delete restrict,
  grant_id   uuid references public.rdp_access_grants (id) on delete restrict,
  actor_id   uuid references auth.users (id) on delete set null,
  actor_kind text not null check (actor_kind in ('staff', 'owner_cli', 'gateway', 'system')),
  client_ip  inet,
  tunnel_ref text check (tunnel_ref is null or char_length(tunnel_ref) <= 64),
  outcome    text check (outcome is null or char_length(outcome) <= 40),
  detail     jsonb not null default '{}'::jsonb check (octet_length(detail::text) <= 2000)
);
create index rdp_access_events_at_idx      on public.rdp_access_events (at desc);
create index rdp_access_events_grant_idx   on public.rdp_access_events (grant_id, at) where grant_id is not null;
create index rdp_access_events_request_idx on public.rdp_access_events (request_id, at) where request_id is not null;
create index rdp_access_events_actor_idx   on public.rdp_access_events (actor_id) where actor_id is not null;

-- 4. guard triggers (not bypassed by service_role). Same shape as fleet_requests_guard.
create or replace function public.rdp_access_no_truncate() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin raise exception '% is append-only: truncate is forbidden', tg_table_name; end $$;

create or replace function public.rdp_access_requests_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'rdp_access_requests: rows are never deleted'; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.answered_at is not null or new.answered_by is not null
       or new.cancelled_at is not null or new.granted_minutes is not null then
      raise exception 'rdp_access_requests: inserts must be clean pending rows';
    end if;
    return new;
  end if;
  -- retention: the IP may be nulled, under the retention GUC, and nothing else changes
  if new.request_ip is null and old.request_ip is not null
     and coalesce(current_setting('app.rdp_redact_ips', true), '') = 'on'
     and (to_jsonb(new) - 'request_ip') = (to_jsonb(old) - 'request_ip') then return new; end if;
  -- FK ON DELETE SET NULL carve-out (a deleted auth user nulls requester_id / answered_by, nothing else)
  if ((new.requester_id is null and old.requester_id is not null) or (new.answered_by is null and old.answered_by is not null))
     and (to_jsonb(new) - 'requester_id' - 'answered_by') = (to_jsonb(old) - 'requester_id' - 'answered_by') then return new; end if;
  if new.id <> old.id or new.requester_id is distinct from old.requester_id or new.reason <> old.reason
     or new.requested_minutes <> old.requested_minutes or new.created_at <> old.created_at
     or new.expires_at <> old.expires_at or new.request_ip is distinct from old.request_ip then
    raise exception 'rdp_access_requests: core fields are immutable';
  end if;
  if old.status = 'pending' and new.status in ('approved', 'denied', 'expired', 'cancelled') then return new; end if;
  raise exception 'rdp_access_requests: illegal status transition % -> %', old.status, new.status;
end $$;
create trigger rdp_access_requests_guard before insert or update or delete on public.rdp_access_requests
  for each row execute function public.rdp_access_requests_guard();
create trigger rdp_access_requests_no_truncate before truncate on public.rdp_access_requests
  for each statement execute function public.rdp_access_no_truncate();

create or replace function public.rdp_access_grants_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'rdp_access_grants: rows are never deleted'; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'active' or new.ended_at is not null or new.ended_by is not null or new.ended_reason is not null
       or new.files_issued <> 0 or new.cut_attempts <> 0 or new.cut_ok_count <> 0 or new.tunnels_cut_at is not null then
      raise exception 'rdp_access_grants: inserts must be clean active rows';
    end if;
    return new;
  end if;
  new.updated_at := now();
  if ((new.user_id is null and old.user_id is not null) or (new.granted_by is null and old.granted_by is not null)
      or (new.ended_by is null and old.ended_by is not null))
     and (to_jsonb(new) - 'user_id' - 'granted_by' - 'ended_by' - 'updated_at')
       = (to_jsonb(old) - 'user_id' - 'granted_by' - 'ended_by' - 'updated_at') then return new; end if;
  if new.id <> old.id or new.request_id <> old.request_id or new.target <> old.target or new.starts_at <> old.starts_at
     or new.expires_at <> old.expires_at or new.max_files <> old.max_files or new.created_at <> old.created_at
     or new.user_id is distinct from old.user_id or new.granted_by is distinct from old.granted_by then
    raise exception 'rdp_access_grants: core fields are immutable (a grant is never extended in place)';
  end if;
  if old.status = 'active' then
    if new.status = 'active' then
      if new.ended_at is not null or new.cut_attempts <> old.cut_attempts or new.cut_ok_count <> old.cut_ok_count
         or new.tunnels_cut_at is not null then raise exception 'rdp_access_grants: only download counters change while active'; end if;
      return new;
    end if;
    if new.status in ('revoked', 'expired', 'ended') then return new; end if;
    raise exception 'rdp_access_grants: illegal status transition % -> %', old.status, new.status;
  end if;
  -- terminal: only the disconnect bookkeeping may change
  if new.status <> old.status or new.ended_at is distinct from old.ended_at or new.ended_by is distinct from old.ended_by
     or new.ended_reason is distinct from old.ended_reason or new.files_issued <> old.files_issued
     or new.last_file_at is distinct from old.last_file_at then
    raise exception 'rdp_access_grants: an ended grant is frozen except for disconnect bookkeeping';
  end if;
  return new;
end $$;
create trigger rdp_access_grants_guard before insert or update or delete on public.rdp_access_grants
  for each row execute function public.rdp_access_grants_guard();
create trigger rdp_access_grants_no_truncate before truncate on public.rdp_access_grants
  for each statement execute function public.rdp_access_no_truncate();

create or replace function public.rdp_access_events_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.client_ip is null and old.client_ip is not null
     and coalesce(current_setting('app.rdp_redact_ips', true), '') = 'on'
     and (to_jsonb(new) - 'client_ip') = (to_jsonb(old) - 'client_ip') then return new; end if;
  raise exception 'rdp_access_events: append-only (% blocked)', tg_op;
end $$;
create trigger rdp_access_events_guard before update or delete on public.rdp_access_events
  for each row execute function public.rdp_access_events_guard();
create trigger rdp_access_events_no_truncate before truncate on public.rdp_access_events
  for each statement execute function public.rdp_access_no_truncate();

-- 5. RLS + grants. service_role bypasses RLS; the browser roles get only the narrow own-row read below.
alter table public.rdp_access_requests enable row level security;
alter table public.rdp_access_grants   enable row level security;
alter table public.rdp_access_events   enable row level security;
revoke all on table public.rdp_access_requests, public.rdp_access_grants, public.rdp_access_events from public, anon, authenticated;
-- staff read ONLY their own rows and ONLY safe columns (no request_ip, no approver_context, no answered_by, no cut internals)
grant select (id, status, reason, requested_minutes, created_at, expires_at, answered_at, granted_minutes, answer_note, cancelled_at)
  on public.rdp_access_requests to authenticated;
grant select (id, request_id, status, target, starts_at, expires_at, ended_at, ended_reason, files_issued, max_files)
  on public.rdp_access_grants to authenticated;
create policy rdp_access_requests_own_select on public.rdp_access_requests for select to authenticated
  using (requester_id = (select auth.uid()) and (select public.has_platform_permission('rdp.request')));
create policy rdp_access_grants_own_select on public.rdp_access_grants for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_platform_permission('rdp.request')));
-- rdp_access_events: no grants, no policies (owner reads through the service-role module).
```
(המשך המיגרציה — פונקציות — מופיע בסעיף 3. כל הפונקציות בקובץ אחד, אחרי הטבלאות.)

הערת DB חשובה: אינדקס ייחודי חלקי על ביטוי קבוע ((true)) הוא אידיום סטנדרטי של Postgres ל"שורה פעילה אחת"; לא נבדק כאן בפועל (INFERRED) — חייב להיבדק בהרצה המקומית. ON CONFLICT (requester_id) WHERE status='pending' דורש את אותו predicate באינדקס (ידוע שה-PostgREST אינו מסוגל ל-upsert על אינדקס חלקי; לכן הכל ב-RPC — תואם לזיכרון הפרויקט).

=====================================================================
2. הרשאות
=====================================================================
- מפתח חדש יחיד: rdp.request (category 'ops', sort_order 90, תווית 'בקשת גישה לשולחן עבודה מרוחק'). נראה גם במטריצת /admin/roles (נשלפת דינמית מ-platform_permission_definitions, VERIFIED).
- בעלים: מקבל אוטומטית (טריגר platform_permission_grant_owner, וגם has_platform_permission/_for_user מחזירות true לתפקיד בעלים לכל מפתח — VERIFIED ב-20260719215138 וב-20260924034054).
- תפקידים שאינם בעלים (ops_engineer, billing_clerk, support_agent, auditor — VERIFIED שהם קיימים): המיגרציה לא מעניקה כלום. הנימוק: המשאב הוא גישת root, והכלל של הפרויקט הוא לגדר לפי המשאב ולא לפי הסגל של היום (זיכרון "Never design for today's roster"; כמה מהתפקידים ללא אנשים בכלל). אם יהיה צורך, הבעלים מסמן בתיבה ב-/admin/roles. שאלה 1.
- אישור: בעלים בלבד, בלי מפתח. נבדק ב-rdp_answer_request וב-rdp_end_grant דרך is_platform_owner_for_user(approver). הערה: ב-dal.ts צוין (10.9) שיש כמה בעלים, לכן ה-CLI דורש --as כשיש יותר מבעלים אחד (סעיף 6).
- בדיקות הרשאה בכל רמה: (1) שער הדף/הפעולה — requirePlatformPermission('rdp.request') (מחרוזת מילולית, כדי שבדיקת הכיסוי תזהה), (2) ה-RPC בודק has_platform_permission_for_user(user,'rdp.request') בעצמו, (3) בדיקת הגשר בודקת אותו שוב בכל פתיחת מנהרה — הסרת הרשאה/הסרה מה-staff חוסמת מנהרות חדשות מיד, וה-sweep מסיים grants של מי שאיבד גישה (ended_reason='access_removed').
- הוכחת סמכות של ה-CLI: ראו סעיף 2' (שיוך ולא אימות). פרטי ההיישום: ה-CLI פותר approver כך — אם יש בעלים יחיד בדיוק (שאילתת platform_staff+platform_roles.is_owner_role דרך admin client) משתמש בו; אם יותר, חובה --as <uuid|email>. מדפיס לפני כל פעולה "אני פועל כ: <שם הבעלים>" ומבקש אישור (או --yes). ה-RPC בודק שוב.
- בדיקות הרשאה מול תפקידים ללא אנשים: ראו סעיף 9 (סקריפט מקומי שיוצר auth.users ו-platform_staff זמניים בתוך טרנזקציה עם rollback, כמו scripts/check-permission-deny-matrix.sql).

=====================================================================
3. קטלוג ה-RPC (כולם SECURITY INVOKER, search_path='', EXECUTE ל-service_role בלבד)
=====================================================================
כל פונקציה: `language plpgsql security invoker set search_path = ''`, והפונקציות עם OUT-params מתחילות ב-`#variable_conflict use_column`. הזמן הוא תמיד now() של ה-DB (מקור שעון יחיד; לא שעון האפליקציה).
החזרות הן `returns table(...)` ולא jsonb — כך ש-gen:types מייצר טיפוסים מדויקים ואין טיפוסים בכתב יד (כלל הפרויקט). האפליקציה ממפה outcome בעזרת tuple קבוע + switch ממצה, וכל ערך לא מוכר => כשל סגור.

| פונקציה | קורא | outcome / החזרה |
|---|---|---|
| rdp_log(kind, actor_kind, actor, request, grant, ip, tunnel, outcome, detail) | פנימי (נקרא רק מתוך הפונקציות) | void |
| rdp_expire_stale(now) | פנימי + sweep | (requests_expired, grants_expired) |
| rdp_request_access(user, reason, minutes, ip) | Server Action | created / already_pending / has_active_grant / rate_limited / not_allowed |
| rdp_cancel_request(user, request_id) | Server Action | cancelled / not_found_or_not_pending |
| rdp_end_own_grant(user) | Server Action | ended / no_active_grant |
| rdp_begin_file_issue(user, ip) | Route Handler (הורדה) | ok(+grant_id, target, expires_at, files_left) / no_active_grant / file_limit / too_soon / not_allowed |
| rdp_answer_request(request, actor, verdict, minutes, target, note, context) | CLI בלבד | approved / denied / not_owner / not_found / not_pending / expired / invalid_minutes / invalid_target / requester_not_allowed / grant_conflict(+conflicting_grant_id) |
| rdp_end_grant(actor, grant_id?, reason) | CLI בלבד | revoked / no_active_grant / not_owner |
| rdp_check_grant(grant_id, target, phase, ip, tunnel_ref) | נתיב הבדיקה של הגשר | (allow, expires_at) — הסיבה נשארת פנימית ביומן |
| rdp_sweep(now) | worker | (requests_expired, grants_expired, access_removed) |
| rdp_mark_cut(grant_id, ok, error_code) | worker + CLI | void |
| rdp_record_event(kind, ...) | נתיבים שרתיים (allowlist: file_failed, tunnel_closed) | void |
| rdp_redact_old_ips(before) | worker (שלב אופציונלי) | integer; מסרב כש-before חדש מ-30 יום |

DRAFT לליבה (שאר הפונקציות באותו סגנון):

```sql
create or replace function public.rdp_log(p_kind text, p_actor_kind text, p_actor uuid, p_request uuid, p_grant uuid,
                                          p_ip inet, p_tunnel text, p_outcome text, p_detail jsonb default '{}'::jsonb)
returns void language sql security invoker set search_path = '' as $$
  insert into public.rdp_access_events (kind, actor_kind, actor_id, request_id, grant_id, client_ip, tunnel_ref, outcome, detail)
  values (p_kind, p_actor_kind, p_actor, p_request, p_grant, p_ip, p_tunnel, p_outcome, coalesce(p_detail, '{}'::jsonb));
$$;

-- Expiry NEVER depends on the sweep: every function that reads or locks state calls this first.
create or replace function public.rdp_expire_stale(p_now timestamptz default now())
returns table (requests_expired integer, grants_expired integer)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  with e as (update public.rdp_access_requests set status = 'expired'
              where status = 'pending' and expires_at <= p_now returning id),
       l as (insert into public.rdp_access_events (kind, actor_kind, request_id, outcome)
              select 'request_expired', 'system', id, 'expired' from e returning 1)
  select (select count(*) from e)::integer into requests_expired;
  with g as (update public.rdp_access_grants set status = 'expired', ended_at = expires_at, ended_reason = 'expired'
              where status = 'active' and expires_at <= p_now returning id, request_id),
       l as (insert into public.rdp_access_events (kind, actor_kind, request_id, grant_id, outcome)
              select 'grant_expired', 'system', request_id, id, 'expired' from g returning 1)
  select (select count(*) from g)::integer into grants_expired;
  return next;
end $$;

create or replace function public.rdp_request_access(p_user_id uuid, p_reason text, p_minutes integer, p_client_ip inet)
returns table (outcome text, request_id uuid, expires_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare v public.rdp_access_requests%rowtype;
begin
  if p_user_id is null or not public.has_platform_permission_for_user(p_user_id, 'rdp.request') then
    return query select 'not_allowed'::text, null::uuid, null::timestamptz; return; end if;
  perform public.rdp_expire_stale();                       -- a stale pending row must not block a fresh request
  if exists (select 1 from public.rdp_access_grants g where g.user_id = p_user_id and g.status = 'active') then
    return query select 'has_active_grant'::text, null::uuid, null::timestamptz; return; end if;
  if (select count(*) from public.rdp_access_requests r
       where r.requester_id = p_user_id and r.created_at > now() - interval '1 hour') >= 6 then   -- durable limit (the web rate limiter is per-process)
    return query select 'rate_limited'::text, null::uuid, null::timestamptz; return; end if;
  insert into public.rdp_access_requests (requester_id, reason, requested_minutes, request_ip)
  values (p_user_id, btrim(p_reason), p_minutes, p_client_ip)
  on conflict (requester_id) where status = 'pending' do nothing
  returning * into v;
  if not found then                                          -- idempotent double-submit / two tabs
    select * into v from public.rdp_access_requests r where r.requester_id = p_user_id and r.status = 'pending';
    return query select 'already_pending'::text, v.id, v.expires_at; return; end if;
  perform public.rdp_log('requested', 'staff', p_user_id, v.id, null, p_client_ip, null, 'pending',
                         jsonb_build_object('minutes', p_minutes));
  return query select 'created'::text, v.id, v.expires_at;
end $$;

create or replace function public.rdp_answer_request(p_request_id uuid, p_actor_id uuid, p_verdict text, p_minutes integer,
                                                     p_target text, p_note text, p_context jsonb)
returns table (outcome text, grant_id uuid, expires_at timestamptz, conflicting_grant_id uuid)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare v public.rdp_access_requests%rowtype; v_grant uuid; v_exp timestamptz; v_conf uuid;
begin
  if not public.is_platform_owner_for_user(p_actor_id) then
    return query select 'not_owner'::text, null::uuid, null::timestamptz, null::uuid; return; end if;
  if p_verdict not in ('approved', 'denied') then
    return query select 'invalid_verdict'::text, null::uuid, null::timestamptz, null::uuid; return; end if;
  perform public.rdp_expire_stale();                         -- before taking the row lock
  select * into v from public.rdp_access_requests r where r.id = p_request_id for update;
  if not found then return query select 'not_found'::text, null::uuid, null::timestamptz, null::uuid; return; end if;
  if v.status <> 'pending' then
    return query select case when v.status = 'expired' then 'expired' else 'not_pending' end, null::uuid, null::timestamptz, null::uuid; return; end if;
  if p_verdict = 'denied' then
    update public.rdp_access_requests set status = 'denied', answered_by = p_actor_id, answered_at = now(),
           answer_note = left(p_note, 500), approver_context = p_context where id = v.id;
    perform public.rdp_log('denied', 'owner_cli', p_actor_id, v.id, null, null, null, 'denied', '{}'::jsonb);
    return query select 'denied'::text, null::uuid, null::timestamptz, null::uuid; return; end if;
  if p_minutes is null or p_minutes not between 5 and 240 then
    return query select 'invalid_minutes'::text, null::uuid, null::timestamptz, null::uuid; return; end if;
  if p_target is null or p_target !~ '^[A-Za-z0-9.-]{1,253}:[0-9]{1,5}$' then
    return query select 'invalid_target'::text, null::uuid, null::timestamptz, null::uuid; return; end if;
  if v.requester_id is null or not public.has_platform_permission_for_user(v.requester_id, 'rdp.request') then
    return query select 'requester_not_allowed'::text, null::uuid, null::timestamptz, null::uuid; return; end if;
  begin
    insert into public.rdp_access_grants (request_id, user_id, granted_by, target, expires_at)
    values (v.id, v.requester_id, p_actor_id, p_target, now() + make_interval(mins => p_minutes))
    returning id, rdp_access_grants.expires_at into v_grant, v_exp;
  exception when unique_violation then                       -- another approve won the partial unique index
    select g.id into v_conf from public.rdp_access_grants g where g.status = 'active';
    return query select 'grant_conflict'::text, null::uuid, null::timestamptz, v_conf; return;
  end;
  update public.rdp_access_requests set status = 'approved', answered_by = p_actor_id, answered_at = now(),
         granted_minutes = p_minutes, answer_note = left(p_note, 500), approver_context = p_context where id = v.id;
  perform public.rdp_log('approved', 'owner_cli', p_actor_id, v.id, v_grant, null, null, 'approved',
                         jsonb_build_object('minutes', p_minutes, 'self_approved', v.requester_id = p_actor_id));
  return query select 'approved'::text, v_grant, v_exp, null::uuid;
end $$;

create or replace function public.rdp_check_grant(p_grant_id uuid, p_target text, p_phase text, p_client_ip inet, p_tunnel_ref text)
returns table (allow boolean, expires_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare v public.rdp_access_grants%rowtype; v_reason text := 'ok';
begin
  select * into v from public.rdp_access_grants g where g.id = p_grant_id;               -- one PK lookup
  if not found then v_reason := 'no_grant';
  elsif v.status <> 'active' then v_reason := 'not_active';
  elsif v.expires_at <= now() then v_reason := 'expired';
  elsif v.target <> p_target then v_reason := 'target_mismatch';
  elsif v.user_id is null or not public.has_platform_permission_for_user(v.user_id, 'rdp.request') then v_reason := 'access_removed';
  end if;
  if v_reason = 'ok' then
    if p_phase = 'open' then
      perform public.rdp_log('tunnel_check', 'gateway', v.user_id, v.request_id, v.id, p_client_ip, p_tunnel_ref, 'allow');
    end if;
    return query select true, v.expires_at;
  else
    perform public.rdp_log('tunnel_check', 'gateway', null, v.request_id, v.id, p_client_ip, p_tunnel_ref, 'deny:' || v_reason);
    return query select false, null::timestamptz;
  end if;
end $$;
```
שאר הפונקציות לפי אותה תבנית (תיאור התנהגות):
- rdp_cancel_request: UPDATE ... WHERE id=? AND requester_id=p_user AND status='pending' RETURNING => cancelled; אחרת not_found_or_not_pending (לא מבדיל "לא שלי" מ"לא קיים").
- rdp_begin_file_issue: בודק מפתח; rdp_expire_stale; SELECT ... FOR UPDATE על ה-grant הפעיל של המשתמש; no_active_grant / file_limit (files_issued>=max_files) / too_soon (last_file_at בתוך 10 שניות); אחרת files_issued+1 ו-last_file_at, ורושם file_issued — "שריון לפני הקריאה לגשר" (כמו שורת pending ב-ledger של התשלומים). כשל בגשר אחר כך צורך מכסה — מכוון, 20 הורדות מספיקות; ניסיון שנכשל נרשם דרך rdp_record_event('file_failed').
- rdp_end_grant: בעלים; UPDATE ... WHERE status='active' AND (p_grant_id IS NULL OR id=p_grant_id) => status='revoked', ended_at=now(), ended_by, ended_reason='revoked_by_owner'; יומן grant_revoked.
- rdp_end_own_grant: אותו דבר עם user_id=p_user => ended / ended_by_user (מותר גם למי שהמפתח הוסר ממנו).
- rdp_sweep: rdp_expire_stale + UPDATE של grants פעילים שבעליהם איבד מפתח (או user_id null) => revoked/access_removed + יומן; מחזיר ספירות. רשימת ה-grants שדורשים ניתוק נקראת באפליקציה מהטבלה (status<>'active' AND tunnels_cut_at IS NULL AND ended_at > now()-1 day AND cut_attempts<40 AND (last_cut_at IS NULL OR last_cut_at < now()-45s)).
- rdp_mark_cut(grant, ok, code): מעלה cut_attempts; בהצלחה cut_ok_count+1; tunnels_cut_at נקבע רק אחרי שתי הצלחות במרווח של 45 שניות לפחות ("ניתוק שני" שסוגר את חלון ה-check-allow -> revoke -> connect); יומן disconnect_ok/disconnect_failed. השדה last_cut_error הוא קוד קבוע (unreachable/timeout/rejected/bad_response) — לעולם לא גוף תשובה.
- rdp_record_event: allowlist קשיח של סוגים.

בלוק ACL ואימות (בסוף המיגרציה, מבטל את הכול אם נכשל):
```sql
revoke all on function public.rdp_log(text,text,uuid,uuid,uuid,inet,text,text,jsonb) from public, anon, authenticated;
-- ... same revoke for every rdp_* function, then:
grant execute on function public.rdp_log(...), public.rdp_expire_stale(timestamptz), public.rdp_request_access(uuid,text,integer,inet),
  public.rdp_cancel_request(uuid,uuid), public.rdp_end_own_grant(uuid), public.rdp_begin_file_issue(uuid,inet),
  public.rdp_answer_request(uuid,uuid,text,integer,text,text,jsonb), public.rdp_end_grant(uuid,uuid,text),
  public.rdp_check_grant(uuid,text,text,inet,text), public.rdp_sweep(timestamptz), public.rdp_mark_cut(uuid,boolean,text),
  public.rdp_record_event(text,text,uuid,uuid,inet,text,text), public.rdp_redact_old_ips(timestamptz) to service_role;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'rdp\_%' escape '\'
     and (p.prosecdef
          or not coalesce(p.proconfig @> array['search_path=""'], false)
          or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('public', p.oid, 'execute') or not has_function_privilege('service_role', p.oid, 'execute'));
  if v_bad > 0 then raise exception 'rdp_access: % function(s) with wrong security properties', v_bad; end if;

  if exists (select 1 from pg_class c where c.oid in ('public.rdp_access_requests'::regclass, 'public.rdp_access_grants'::regclass, 'public.rdp_access_events'::regclass)
              and (not c.relrowsecurity or has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate')
                   or has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate'))) then
    raise exception 'rdp_access: table ACL / RLS wrong'; end if;
  if has_column_privilege('authenticated', 'public.rdp_access_requests'::regclass, 'request_ip', 'select')
     or has_column_privilege('authenticated', 'public.rdp_access_requests'::regclass, 'approver_context', 'select')
     or has_table_privilege('authenticated', 'public.rdp_access_events'::regclass, 'select') then
    raise exception 'rdp_access: authenticated can read a column or table it must not'; end if;
  if (select count(*) from pg_index i where i.indrelid = 'public.rdp_access_grants'::regclass and i.indisunique
        and pg_get_expr(i.indpred, i.indrelid) = '(status = ''active''::text)') <> 1 then
    raise exception 'rdp_access: the one-active-grant unique index is missing'; end if;
  if (select count(*) from pg_trigger t where not t.tgisinternal and t.tgenabled = 'O'
        and t.tgname in ('rdp_access_requests_guard', 'rdp_access_grants_guard', 'rdp_access_events_guard',
                         'rdp_access_requests_no_truncate', 'rdp_access_grants_no_truncate', 'rdp_access_events_no_truncate')) <> 6 then
    raise exception 'rdp_access: guard triggers missing or disabled'; end if;
  if exists (select 1 from public.platform_role_permissions rp
               join public.platform_permission_definitions d on d.id = rp.permission_id
               join public.platform_roles r on r.id = rp.role_id
              where d.key = 'rdp.request' and not r.is_owner_role) then
    raise exception 'rdp_access: a non-owner role holds rdp.request by default'; end if;
  if not exists (select 1 from public.platform_role_permissions rp
                   join public.platform_permission_definitions d on d.id = rp.permission_id
                   join public.platform_roles r on r.id = rp.role_id where d.key = 'rdp.request' and r.is_owner_role) then
    raise exception 'rdp_access: the owner role does not hold rdp.request'; end if;
  if has_function_privilege('authenticated', 'public.is_platform_owner_for_user(uuid)', 'execute') then
    raise exception 'rdp_access: owner twin executable by a browser role'; end if;
end $$;
```
הערות: (1) המיגרציות האחרונות בוצעו dry-run על ה-DB החי; כאן אסור, לכן ההרצה המקדימה היא רק על סטאק מקומי (סעיף 9). (2) ה-predicate המדויק של אינדקס ((true)) כפי ש-pg_get_expr מדפיס תלוי בגרסה — לאמת בהרצה המקומית ולהתאים את ההשוואה. (3) פונקציות INVOKER רצות כ-service_role: הטבלאות נגישות לו כברירת מחדל והוא עוקף RLS (כמו payment_operation_lines).

=====================================================================
4. פריסת קוד השרת
=====================================================================
עיקרון: ליבה אחת "ללא בקשה" (request-free) שמשמשת את ה-CLI, ה-worker ונתיבי ה-API; אינה מייבאת dal ולא data/admin; משתמשת ב-createAdminClient. זה נדרש גם ע"י .dependency-cruiser.cjs (כלל worker-no-request-scoped-next חל על worker/** ו-scripts/**; `npm run worker:deps` רץ ב-pretest — VERIFIED).

יצירה:
1. supabase/migrations/<ts>_rdp_access_approval.sql
2. src/lib/rdp-access/policy.ts — קבועים יחידים: REQUEST_TTL_MIN=30, MINUTES_MIN=5, MINUTES_MAX=240, MINUTES_DEFAULT=60, MINUTES_PRESETS=[30,60,120,240], MAX_FILES=20, FILE_MIN_INTERVAL_S=10, REQUESTS_PER_HOUR=6, CHECK_BODY_MAX_BYTES=1024, RDP_FILE_MAX_BYTES=16384, COUNTDOWN... (ה-DB מוסיף תקרה קשיחה של 240 דקות ב-CHECK; שינוי התקרה = מיגרציה, בכוונה).
3. src/lib/rdp-access/config.ts — getRdpGatewayConfig(): קורא env, מחזיר {ok:false, missing:[...]} כשחסר משהו (כשל סגור), ומאמת ש-RDPGW_LOOPBACK_URL הוא loopback בלבד (hostname ב-{127.0.0.1, ::1, localhost}) כדי שטעות הגדרה לא תשלח את הסוד לשרת אחר. אין החזרת ערכי סודות בלוגים/CLI status — רק booleans.
4. src/lib/rdp-access/service.ts — עטיפות RPC דקות על createAdminClient: requestAccess, cancelRequest, endOwnGrant, beginFileIssue, answerRequest, endGrant, checkGrant (עם .abortSignal(AbortSignal.timeout(2500)) — VERIFIED ש-postgrest-js תומך), sweep, markCut, recordEvent. טיפוסי החזרה נגזרים מ-Database['public']['Functions'] (אחרי gen:types), בלי טיפוסים בכתב יד.
5. src/lib/rdp-access/gateway-client.ts — לקוח ה-loopback ל-rdpgw (ראו פירוט למטה).
6. src/lib/rdp-access/rdp-file.ts — אימות קובץ ה-.rdp שחזר מ-rdpgw: סטטוס 200, content-type טקסטואלי, גודל <= 16KB, מכיל שורת gatewayaccesstoken, בלי תווי NUL; ומחיל מדיניות שורות הפניה (כיבוי הפניית כוננים/לוח — רשימת המפתחות המותרת תגיע מ-rdp-client-compat; הקובץ מועבר כמות שהוא פרט לכך). הגוף אינו נשמר ואינו נרשם ביומן אף פעם.
7. src/lib/rdp-access/sweep.ts — runRdpAccessSweep(admin) (ראו סעיף 7). בנוי כמו src/lib/data/payment-orphans.ts.
8. src/lib/rdp-access/notify.ts — notifyOwnersOfRdpEvent(...): push לבעלים בלבד (שאילתת platform_staff+platform_roles.is_owner_role בעזרת admin client) + sendSlackAlert category 'security'. הכותרת כוללת את 8 התווים הראשונים של מזהה הבקשה/grant — כי sendSlackAlert מבצע dedup לפי (level|title|source) (תקדים: fleet-agent-cli, "the id is IN THE TITLE on purpose"). ללא שם, ללא סיבה, ללא IP בהתראות.
9. src/lib/rdp-access/copy.ts — כל הטקסט העברי למשתמש (נפרד מהלוגיקה, כדי לאפשר EN/FR בעתיד).
10. src/lib/rdp-access/events.ts — רשימת סוגי האירועים (קבוע) + תוויות בעברית; בדיקת drift שכל kind ב-SQL נמצא ברשימה.
11. src/lib/validation/rdp-access.ts — סכמות Zod 4: requestAccessFormSchema (reason: trim, 10..500; minutes: אחד מ-MINUTES_PRESETS), gatewayCheckBodySchema (strictObject: user: regex ^grant-<uuid>$ שמומר ל-uuid, target: מחרוזת <=255, clientIp: z.union([z.ipv4(), z.ipv6()]), phase: z.enum(['open','recheck']), tunnelRef: אופציונלי <=64), gatewayEventBodySchema (אם יוסכם), ארגומנטי CLI. שימו לב: z.uuid() ב-Zod 4 מחמיר — פיקסצ'רים עם UUID אמיתי (זיכרון הפרויקט).
12. src/lib/data/admin/rdp-access.ts — מודול הצוות. כל פונקציה מתחילה ב-`await requirePlatformPermission('rdp.request')`. פונקציות: getMyRdpAccessState() (קריאה דרך createClient() של העוגייה => RLS "רק שלי" כשכבה שנייה), submitRdpAccessRequest(), cancelMyRdpRequest(), endMyRdpGrant(), issueMyRdpFile(clientIp). מזהה המשתמש נגזר מהערך המוחזר של השער, לעולם לא מ-FormData.
13. src/lib/data/admin/rdp-access-owner.ts — מודול הבעלים בלבד; כל export מתחיל ב-`await requirePlatformOwner()`; קריאה דרך admin client (כמו activity.ts) עם רשימת עמודות מפורשת: listRdpAccessRequests({page,status}), getRdpAccessRequestDetail(id), getRdpAccessOverview(), listRdpAccessEvents({requestId|grantId}). שמות מציגים (profiles.full_name) נשלפים כאן בלבד.
14. src/app/(admin)/admin/rdp-access/: page.tsx, loading.tsx, actions.ts (+ actions.test.ts), request-form.tsx ('use client'), my-access-card.tsx, download-button.tsx ('use client'), status-poller.tsx ('use client'), requests/page.tsx, requests/[id]/page.tsx, requests/loading.tsx.
15. src/app/api/admin/rdp-access/file/route.ts (POST בלבד) — תחת /api/admin כדי שסריקת ENDPOINT_FILES בבדיקת הכיסוי תכלול אותו (VERIFIED: ENDPOINT_DIRS = src/app/(admin)/admin ו-src/app/api/admin).
16. src/app/api/rdp-gateway/check/route.ts (POST) ואופציונלית src/app/api/rdp-gateway/event/route.ts — מחוץ ל-/api/admin כי אין להם session. (+ route.test.ts לכל אחד).
17. scripts/rdp-access-cli.ts (סעיף 6).
18. docs/rdp-access/README.md + runbook (סעיף 10).

עדכון קבצים קיימים:
- src/lib/auth/admin-data-layer-coverage.test.ts: להוסיף 'rdp.request' ל-PERMISSION_CATALOGUE (מוצמד, "Pinned rather than queried"); ב-EXPECTED_PERMISSION: 'src/lib/data/admin/rdp-access.ts': 'rdp.request' ו-'src/lib/data/admin/rdp-access-owner.ts': []; להוסיף את מודול הבעלים לבלוק הטענות לפי-שם של מודולי owner-only (כמו owner-agent.ts, שורה ~814, עם ספירת exports) — המודול חייב להיות נפרד כי הבדיקה המוצמדת בודקת מפתח אחד לכל מודול (תקדים: event-view.ts מול events.ts).
- src/components/admin-shell.tsx: פריט ניווט בקבוצה 'מערכת ותפעול': { href: '/admin/rdp-access', label: 'גישה לשולחן עבודה', icon: Monitor (lucide), permission: 'rdp.request' }.
- src/lib/data/admin/nav-visibility.ts: להוסיף 'rdp.request' ל-NAV_PERMISSION_KEYS (admin-nav-coverage.test.ts נכשל אם נשכח — VERIFIED).
- src/lib/queue/queues.ts: rdpAccessSweep: 'rdp-access-sweep'.
- src/lib/ops/queue-schedule.ts: 'rdp-access-sweep': 3 (בדיקת ה-drift ב-queue-schedule.test.ts תכשל בלי זה — VERIFIED).
- worker/main.ts: boss.work + boss.schedule (סעיף 7).
- next.config.ts: שני בלוקי headers (ראו מטה).
- package.json: סקריפט rdp:access.
- scripts/check-permission-deny-matrix.sql: להוסיף את rdp.request לבדיקת "כל תפקיד שאינו בעלים נדחה" (לא להריץ כאן; מריץ הבעלים אחרי המיגרציה).
- אין צורך ב-ACTION_LABELS של activity.ts (אין שיקוף ל-activity_log).

נתיב הבדיקה של הגשר — POST /api/rdp-gateway/check (תקדים: src/app/api/voximplant/console/authorize/route.ts, VERIFIED, עם ההבדלים הבאים):
סדר שכבות, כשל סגור בכל אחת:
1. אם קיימת אחת מהכותרות x-forwarded-for / x-real-ip / forwarded / x-forwarded-host / x-forwarded-proto => 404. VERIFIED ב-/etc/nginx/conf.d/beta-proxy.conf: ה-nginx של beta.kalfa.me מגדיר תמיד X-Real-IP, X-Forwarded-For, X-Forwarded-Host, X-Forwarded-Proto (ומשם proxy_pass ל-127.0.0.1:3002); קריאה ישירה מ-rdpgw ל-127.0.0.1:3002 אינה נושאת אותן. לא להסתמך על getClientIp לשום החלטת אבטחה: הוא לוקח את הערך הראשון של x-forwarded-for, שהלקוח שולט בו (nginx רק מוסיף), ובנוסף ל-Route Handler אין כתובת socket.
2. שכבת תשתית (פריט ל-plan-infra): `location ^~ /api/rdp-gateway/ { return 404; }` ב-vhost הציבורי. כרגע אין כזה (VERIFIED: רק location / ו-acme). עד אז השכבות 1 ו-3 מגנות.
3. סוד משותף: env RDPGW_CHECK_SECRET; אם חסר => 503 (כשל סגור); השוואה safeTokenEqual(presented, sha256Hex(expected)); כותרת x-rdp-gateway-secret (לא גוף, בניגוד ל-Voximplant שם הסקנריו מגביל).
4. content-length <= 1KB, JSON, Zod strict => 400/413.
5. rate limit כללי (600/דקה; per-process, לא בקרת אבטחה — אותה הערה כמו בראוט הקיים; ה-pm2 הוא fork יחיד (VERIFIED בקובץ ecosystem), אבל מתאפס בכל restart).
6. checkGrant עם timeout של 2.5 שניות. שגיאה/timeout => 503 עם {allow:false}. rdpgw חייב להתייחס לכל דבר שאינו 200+allow:true כהכחשה.
7. תשובה: {allow:true, expires_at} או {allow:false}. אף פעם לא סיבה.
תשובה מיידית ל-"זול": שאילתת PK אחת + קריאת has_platform_permission_for_user + INSERT ליומן רק ב-open או בהכחשה. מיועד גם לסקר חוזר של rdpgw עד פעם ב-30 שניות לכל מנהרה חיה. ה-proxy.ts של Next רץ גם על הנתיב הזה (matcher כללי) וקורא getClaims בלי עוגייה — זול (INFERRED, לא נמדד).
צרכי חוזה מול rdpgw (לרדוף מול rdpgw-eval): (א) בכל מנהרה: שימוש ב-expires_at שחוזר כדי לסגור לבד בלי תלות ב-KALFA, (ב) סקר חוזר (phase:'recheck') כל 30–60 שניות והכחשה = סגירה, (ג) אופציונלי: דיווח tunnel_closed ל-/api/rdp-gateway/event, (ד) endpoint לרשימת מנהרות חיות ("מי מחובר"); בלעדיו who/reconciliation נגזרים מה-DB בלבד.

לקוח ה-loopback ל-rdpgw (gateway-client.ts):
- connectFile({grantId, target}) — קורא ל-/connect ב-loopback במצב header authentication: כותרת המשתמש = `grant-<uuid>` (שם הכותרת, הנתיב והפרמטרים — קונפיגורביליים, לאשר מול rdpgw-eval; INFERRED כרגע) ובנוסף כותרת סוד נפרדת RDPGW_CONNECT_SECRET כדי שרק KALFA (ולא כל תהליך מקומי) יוכל להנפיק.
- disconnectGrant(grantId) ו-(אם קיים) listTunnels() — עם RDPGW_ADMIN_SECRET.
- fetch עם AbortSignal.timeout(4000), redirect:'manual', cache:'no-store'; מיפוי שגיאות לתוצאה טיפוסית {ok:false, kind:'unreachable'|'timeout'|'rejected'|'bad_response'}; לעולם לא כולל גוף תגובה/כותרות/סוד בהודעת שגיאה או בלוג; רק קוד קבוע.
- 3 סודות נפרדים לפי כיוון (אין סוד שמשרת שני כיוונים): RDPGW_CHECK_SECRET (rdpgw->KALFA), RDPGW_CONNECT_SECRET (KALFA->rdpgw /connect), RDPGW_ADMIN_SECRET (CLI/worker->rdpgw ניתוק/רשימה). פלוס קונפיג לא-סודי: RDPGW_LOOPBACK_URL, RDPGW_TARGET (host:port של שולחן העבודה — נקבע בשרת ומוצמד ל-grant בשלב האישור, לא מהמבקש).
  אכסון (VERIFIED כמוסכמה): כמו KALFA_CONSOLE_SECRET — משתנה סביבה ב-.env.local שנקרא ב-process.env, כשל סגור כשחסר, אימות באורך >=32 (scripts/voximplant/set-console-secret.ts), סיבוב = שינוי בשני הצדדים בו-זמנית + restart (pm2 restart בלי --update-env שומר את ה-env של ההפעלה הנקייה; Next טוען את .env.local ב-boot; ה-worker יש לו loadEnv משלו). כל הסודות באותו .env.local, ולכן הפרדת "מי קורא מה" היא לפי נתיב קוד ולא לפי תהליך: Next טוען את כל הקובץ. rdpgw מחזיק עותק משלו בקובץ ההגדרות שלו, ולכן מעבר עתידי ל-Vault מכסה רק את הצד של KALFA: פונקציה אחת getRdpGatewaySecret(name) מאחורי config.ts (היום env; בעתיד integration_connections עם credential_kind='api_key' דרך createCredentialAccessor, VERIFIED קיים ב-src/lib/integrations/credential-accessor.ts), עם cache בתוך התהליך על נתיב ה-check החם (אחרת כל בדיקת מנהרה = קריאת Vault). מעבר זה לא ישנה שום קורא.

נתיב ההורדה — POST /api/admin/rdp-access/file (לא GET: הוא מנפיק טוקן וצורך מכסה; ניווט GET top-level נושא עוגיות Lax):
1. אימות Origin מפורש: Origin חייב להיות שווה ל-await getAppOrigin() (Route Handlers אינם מקבלים את בדיקת Origin/Host האוטומטית של Server Actions — VERIFIED ב-docs/data-security.md); אי-התאמה או היעדר => 403. כשל של getAppOrigin (APP_ORIGIN חסר בפרודקשן) => 500 סגור.
2. שער: getUser() ריק => 401; requirePlatformPermission('rdp.request') בתוך issueMyRdpFile, עם הסבת NEXT_REDIRECT ל-403 (תקדים fleet-file/route.ts, VERIFIED).
3. rate limit per-user בזיכרון (3/דקה) — per-process; הנעילה הנכונה היא ב-DB (too_soon/file_limit).
4. rdp_begin_file_issue(user, ip) => outcome => HTTP: no_active_grant 409, file_limit 429, too_soon 429, not_allowed 403.
5. connectFile; כשל => rdp_record_event('file_failed') ו-502 עם קוד כללי.
6. אימות rdp-file.ts; תשובה: Content-Type application/x-rdp, Content-Disposition: attachment; filename="kalfa-desktop.rdp", Cache-Control: private, no-store, X-Content-Type-Options: nosniff. הגוף מוזרם/מועבר בלי שמירה ובלי לוג.
7. אין גוף בקשה: ה-grant נגזר מהמשתמש בשרת (אף מזהה לא מגיע מהדפדפן).
הלקוח: download-button.tsx עושה fetch POST ומוריד כ-Blob (שגיאות מוצגות בתוך הדף; ניווט טופס היה מציג JSON גולמי).

next.config.ts — שני בלוקי headers חדשים (באותו סגנון כמו /api/voximplant/:path*): source '/api/admin/rdp-access/:path*' ו-source '/api/rdp-gateway/:path*', שניהם: Cache-Control no-store, max-age=0; Referrer-Policy no-referrer; X-Robots-Tag noindex, nofollow.

Server Actions (actions.ts): requestRdpAccessAction, cancelRdpRequestAction, endRdpGrantAction. כל אחת: requirePlatformPermission('rdp.request') ראשון; Zod; קריאה למודול הנתונים; הודעות שגיאה בטוחות בעברית; לאחר created — notifyOwnersOfRdpEvent (best-effort, כשל לא מכשיל את הפעולה). כללית Server Actions מקבלות בדיקת Origin/Host של Next (VERIFIED). rate limit בזיכרון (5/דקה למשתמש) כשכבה ראשונה; הגבלה עמידה (6 בשעה) ב-DB.

=====================================================================
5. UI/UX (עברית, RTL, נגישות)
=====================================================================
טעינת מיומנות הפרויקט building-rtl-ui לפני מימוש; שימוש בתבנית הקיימת של עמודי admin: PageHeading, EmptyState, Badge, Pagination, formatDateTime מ-../_components (VERIFIED); Alert/AlertTitle/AlertDescription, Button, Textarea, RadioGroup, Table, Tabs, AlertDialog מ-src/components/ui (VERIFIED שקיימים); SubmitButton/FieldError/FormError/FormNotice מ-src/components/forms.tsx; LocalDateTime לזמנים תפעוליים (VERIFIED); דפוס הרענון של relocation/_auto-refresh-toggle.tsx כרקע ל-status-poller.tsx (שונה: ברירת מחדל פעיל כל עוד הבקשה pending/grant פעיל, 10 שניות, רק כשהטאב גלוי). ללא פרימיטיבים חדשים.

מה רואה איש הצוות (/admin/rdp-access, שער rdp.request):
- אין בקשה: כרטיס "בקשת גישה" — Textarea "מטרת הגישה" (10–500 תווים; טקסט עזר: "אל תכתבו סיסמאות או מפתחות"), RadioGroup משך (30/60/120/240 דקות, ברירת מחדל 60), כפתור "שליחת בקשה". טקסט הסבר קצר: הבעלים יקבל התראה ויאשר או ידחה; הבקשה תקפה 30 דקות.
- pending: תג "ממתין לאישור", ספירה לאחור עד פקיעת הבקשה (מתעדכנת כל 30 שניות, aria-live="off"; שינוי מצב מוכרז ב-aria-live="polite"), כפתור "ביטול בקשה" (AlertDialog).
- approved/active: תג "פעיל", שעת סיום מוחלטת + "נותרו X דקות", כפתור "הורדת קובץ חיבור" (ראשי), מונה "נותרו N הורדות", כפתור "סיום גישה" (AlertDialog). פסקה אחת: "הקובץ תקף ל-5 דקות מרגע ההורדה — פתחו אותו מיד; לחיבור נוסף הורידו קובץ חדש. Windows: פתחו את הקובץ (Remote Desktop Connection). macOS/iOS/Android: התקינו את Windows App (או Microsoft Remote Desktop) ופתחו את הקובץ. Linux: Remmina או xfreerdp." (נוסח סופי יאושר מול rdp-client-compat).
- denied: "הבקשה נדחתה" + הערת הבעלים אם יש; expired: "הבקשה פגה ללא מענה" + כפתור בקשה חדשה; cancelled/ended: סיכום וכפתור בקשה חדשה.
- מצבי שגיאה: loading.tsx (שלד קיים בסגנון admin), error.tsx של ה-admin, FormError בתוך הטופס, "שער ההתחברות אינו זמין כרגע — פנו לבעלים" ב-502, "הגעת למכסת ההורדות" ב-429, "יש כבר גישה פעילה" ב-has_active_grant, rate_limited. אין הרשאה => redirect('/app') מהשער (התנהגות קיימת).
מה רואה הבעלים: אותו עמוד + קישור "כל הבקשות" (מוצג כש-isPlatformOwner()). /admin/rdp-access/requests: טבלה לקריאה בלבד (נוצר, שם מבקש, דקות מבוקשות/מאושרות, סטטוס כ-Badge+טקסט, מועד החלטה, מאשר) עם Tabs לפי סטטוס ו-Pagination; /admin/rdp-access/requests/[id]: פרטי הבקשה, סיבה, IP (dir="ltr"), grant (תוקף, הורדות, מצב ניתוק), ציר זמן אירועים; ובתחתית הוראה: "אישור/דחייה/ביטול — רק ב-CLI: npm run rdp:access -- show <id>". אין שום מסלול כתיבה בעמודים אלה (תקדים: עמוד relocation, "no mutation path by construction").
RTL ונגישות: מאפייני CSS לוגיים (ms/me/ps/pe, text-start) ו-dir="ltr" למזהים/IP/יעד; סטטוס לא רק בצבע; מטרות מגע של Button ברירת מחדל; מיקוד לשדה/הודעת שגיאה אחרי שליחה; AlertDialog מבוסס Base UI נגיש במקלדת; פורטלים — לפי הכלל "portals ignore dir" (DirectionProvider, זיכרון הפרויקט) — לוודא בדפדפן שה-AlertDialog נפתח נכון ב-RTL.

=====================================================================
6. CLI
=====================================================================
קובץ: scripts/rdp-access-cli.ts. סקריפט package.json (אותו דפוס כמו email:health / fleet:agent, VERIFIED):
`"rdp:access": "esbuild scripts/rdp-access-cli.ts --bundle --platform=node --format=cjs --target=node24 --outfile=dist/rdp-access-cli.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native --log-level=error && node --env-file=.env.local dist/rdp-access-cli.cjs"`
הרצה: `npm run rdp:access -- <פקודה>`. נבנה מחדש בכל הרצה (כמו relocate/email:health), ולכן אין צורך בשינוי בשרשרת deploy או בסקריפט בדיקת-חבילה. @clack/prompts זמין (devDependency, כמו scripts/relocate/cli.ts) ומתאגד ע"י esbuild; parseArgs מ-node:util כמו fleet-agent-cli.
פקודות:
- watch [--interval 5]: polling כל 5 שניות על בקשות pending (אינדקס חלקי), פעמון טרמינל בבקשה חדשה; לכל בקשה: הצגת מזהה קצר, שם מבקש (profiles.full_name), סיבה, דקות מבוקשות, IP בקשה, זמן שנותר; prompt (select): אשר / דחה / דלג; באישור — בחירת דקות (ברירת מחדל min(מבוקש, 60), תקרה 240), אישור סופי. דורש TTY (אחרת יציאה 1 עם הפניה ל-list/approve). שורת סטטוס של ה-grant הפעיל נשארת מוצגת. נבחר polling ולא Realtime/LISTEN: שאילתת service-role זעירה כל 5 שניות, בלי WebSocket ובלי תלות בפרסום Realtime או ב-pooler.
- list [--status pending|active|all] [--json]
- show <id>: בקשה + grant + ציר אירועים (ללא סודות).
- approve <id> --minutes N [--note T] [--as <owner>] [--yes]: ה-target נלקח מ-RDPGW_TARGET בשרת (לא ארגומנט).
- deny <id> [--note T] [--as <owner>] [--yes]
- revoke [<grant-id>] [--reason T] [--as <owner>] [--yes]: סדר: (1) rdp_end_grant (commit), (2) מיד disconnectGrant ו-rdp_mark_cut, (3) דיווח. כשל ניתוק => יציאה 1 עם הודעה "בוטל במסד אך ניתוק המנהרות החיות לא אושר; ה-sweep ינסה כל דקה" (לא מסתירים כשל חלקי).
- status: grant פעיל (מי, תוקף, הורדות, מצב ניתוק), מספר בקשות ממתינות, האם הוגדרו הסודות (true/false בלבד), האם rdpgw נגיש.
- who: מי מחובר — נגזר מה-DB (grant פעיל + אירועי tunnel_check האחרונים) ואם קיים endpoint רשימה ב-rdpgw, גם משם (תלוי בחוזה; אחרת מצוין "DB בלבד").
שיוך: קטע attribution נוצר פעם אחת ונשלח כ-p_context: {os_user: os.userInfo().username, host: os.hostname(), ssh: SSH_CONNECTION (רמז בלבד), tty: isTTY, cli: 'rdp-access-cli/1', pid}. מודפס גם למסוף.
קודי יציאה (המוסכמה, VERIFIED): 0 הצלחה, 1 שגיאה (כולל ניתוק חלקי), 2 אין מה לעשות (לא pending / אין grant פעיל / לא נמצא).
היגיינת פלט: אין הדפסת ערכי env, סודות, טוקנים או תוכן .rdp; מזהים מקוצרים; JSON ב---json חולף את אותה סינון. הודעות שגיאה מ-RPC ממופות לעברית ללא פרטי DB.
התראה לבעלים כשה-CLI אינו פתוח: בעת יצירת הבקשה (ב-Server Action) נשלח push לבעלים בלבד ו-Slack security (warn): "בקשת גישה מרחוק ממתינה — <id8>" ובגוף "<N> דק' — לאישור: npm run rdp:access -- watch"; push עם url=/admin/rdp-access/requests/<id>. הבקשה פגה אחרי 30 דקות אם איש לא ענה (נראה בעמוד הבעלים). ה-CLI עצמו שולח הודעות על approve/deny/revoke (אותן ערוצים, אותה כותרת עם id8).

=====================================================================
7. פקיעה וביטול (jobs)
=====================================================================
עיקרון: הנכונות לא תלויה ב-sweep. rdp_check_grant ו-rdp_answer_request בודקים expires_at>now(); rdp_answer_request/rdp_request_access/rdp_begin_file_issue קוראים ל-rdp_expire_stale לפני שהם נועלים — grant שפג בזמן אך עדיין 'active' לעולם לא חוסם grant חדש.
- תור: rdp-access-sweep (QUEUES.rdpAccessSweep). קדנס: דקה (`'* * * * *'`), עם POLL_MINUTE_CRON (10 שניות) כמו arm ו-workflow-schedule-sweep. QUEUE_EXPECTED_MAX_MINUTES['rdp-access-sweep'] = 3. retention אוטומטי (allowance<=30 => יום, completedRetentionSeconds, VERIFIED). קדנס של 10 דקות כמו fleet-request-expire-sweep גס מדי לגישת root.
- registration: queues.ts (שם התור), queue-schedule.ts (allowance), worker/main.ts: `boss.work(QUEUES.rdpAccessSweep, POLL_MINUTE_CRON, guardedWorker(QUEUES.rdpAccessSweep, async () => { await runRdpAccessSweep(createAdminClient()); }))` ו-`await boss.schedule(QUEUES.rdpAccessSweep, '* * * * *')` (ליד שורות 1640/1647). בדיקת ה-drift ב-queue-schedule.test.ts מאמתת את שלושת המקומות.
- runRdpAccessSweep: (1) rdp_sweep; (2) שליפת grants שדורשים ניתוק (תנאי בסעיף 3); (3) לכל אחד disconnectGrant => rdp_mark_cut; (4) התראות security: שורה ב-cut_attempts>=3 => level error "ניתוק מנהרות נכשל" (כותרת עם grant id8 למניעת dedup); >=10 => הוראת תפעול (עצירת rdpgw לפי ה-runbook). כשל DB ב-rdp_sweep נזרק (guardedWorker מתריע ו-pg-boss מנסה שוב); כשלי ניתוק לא נזרקים אלא נרשמים.
- ה-sweep מבצע ניתוק ל-grants שנסגרו מכל סיבה (revoked/expired/ended/access_removed), עם ניתוק שני ≥45 שניות אחרי הראשון (סוגר את חלון ה-check-allow -> revoke -> connect).
- rdpgw לא נגיש: חסימת מנהרות חדשות נשמרת (בדיקה ב-DB; אם KALFA עצמו לא נגיש ל-rdpgw — rdpgw חייב לסרב); מנהרות חיות נחתכות כשיחזור, וגם לבד ב-expires_at/סקר חוזר אם נוסף לחוזה. ה-CLI/ה-worker מתריעים.
- id דטרמיניסטי: ה-sweep הוא cron ללא jobs ייחודיים. אופציונלי (שלב 9): תור event-driven rdp-access-grant-expire עם job מושהה ל-expires_at: `getWebJobSender().send(QUEUES.rdpAccessGrantExpire, { grantId }, { id: deterministicJobId('rdp-access-expire:' + grantId), startAfter: expiresAt })` (VERIFIED שני ה-helpers קיימים; pg-boss דורש uuid ב-id, ולכן deterministicJobId); ה-CLI ישלח אותו אחרי approve. מומלץ רק אם rdpgw לא יוסיף סקר חוזר/סגירה עצמית (שאלה 10). תור event-driven לא נכנס ל-QUEUE_EXPECTED_MAX_MINUTES.
- שלב אופציונלי: משימה שבועית לאיפוס IP (rdp_redact_old_ips(now()-90 days)) — עוד תור cron עם allowance ל-10 ימים. אפשר לדחות לאחר גרסה 1.
- לא לבנות worker.cjs ידנית; הבעלים מפעיל deploy (זיכרון worker-build-defeats-deploy-restart).

=====================================================================
8. ביקורת והתראות
=====================================================================
אירועים (kind ב-rdp_access_events, נכתבים בתוך אותה טרנזקציה של שינוי המצב כך שלא קיים מצב "שונה בלי יומן"): requested, cancelled, approved (+self_approved), denied, request_expired, file_issued, file_refused, file_failed, tunnel_check (allow/deny:<reason>), tunnel_closed (אם rdpgw ידווח), grant_revoked, grant_expired, grant_ended, access_removed, disconnect_ok, disconnect_failed.
שדות: actor_id (uuid), actor_kind, client_ip (מתאפס אחרי 90 יום), tunnel_ref אטום, outcome קצר, detail עד 2000 בתים (מזהים ומספרים בלבד). לא נשמרים: סיבת הבקשה (נשמרת רק בשורת הבקשה, גלויה לבעלים), טוקן, גוף .rdp, שמות, אימיילים, סודות.
למה לא activity_log ולא support_access_log: (VERIFIED) activity_log הוא יומן מרובה-לקוחות עם event_id/user_id; מדיניות al_org_read מאפשרת למשתמש לקרוא שורות עם user_id=עצמו, ואין בו טריגרי append-only; ופתוח לכל מחזיק view_activity_log. support_access_log מיועד לגישת צוות לנתוני לקוח מזוהה — recordStaffAccess זורק בלי ownerId ו-subject_type הוא אחד מ-event/user/guest_list/call_attempts/campaign. אין כאן לקוח. שני מקורות אמת היו עלולים להתפצל, ולכן נבחר מקור אחד (שאלה 7).
התראות (Slack category 'security' + push לבעלים בלבד; ללא PII/סיבה/IP/שם): בקשה חדשה (warn); אושרה/נדחתה/בוטלה-ע"י-בעלים/פגה (info); בקשה/אישור/ביטול בזמן grant פעיל (error); מנהרה ראשונה נפתחה ב-grant (info, push); ניתוק נכשל >=3 (error); rdpgw לא נגיש (error). הכותרות כוללות id8.

=====================================================================
9. בדיקות
=====================================================================
Vitest (כולם hermetic; סודות רק ב-vi.stubEnv + unstubAllEnvs, לפי vitest.config.mts):
- policy/config: חסר סוד => {ok:false}; URL שאינו loopback נדחה; אין ערכי סוד בהודעות.
- gateway-client: timeout, 5xx, redirect, content-type שגוי, גוף גדול מדי, אין סוד/גוף בשום הודעת שגיאה או console.* (spy).
- rdp-file: דחיית קובץ ללא gatewayaccesstoken / עם NUL / גדול מדי.
- check route: כותרות proxy => 404 (לכל כותרת בנפרד); env חסר => 503; סוד שגוי => 401; גוף שגוי => 400; גדול => 413; allow; deny; RPC שגיאה/timeout => 503 עם allow:false; התשובה לעולם לא כוללת reason; user שאינו grant-<uuid> => 400.
- file route: Origin שגוי/חסר => 403; בלי session => 401; בלי הרשאה (NEXT_REDIRECT) => 403; no_active_grant 409; file_limit/too_soon 429; גשר למטה 502; הצלחה: כל הכותרות; הגוף לא נרשם ביומן.
- actions: השער ראשון; מזהה המשתמש לא נקרא מ-FormData; Zod; dedup (already_pending); כשל notify לא מכשיל.
- sweep: קריאת rdp_sweep, לולאת ניתוק, סף התראות, שגיאת DB נזרקת, כשל ניתוק לא נזרק.
- CLI (פונקציות טהורות מופרדות מ-main כדי לבדוק): ניתוח ארגומנטים, קודי יציאה 0/1/2, פתרון approver (בעלים יחיד/כמה/--as שגוי), סירוב ללא TTY ב-watch, שדות attribution, אין סוד בפלט.
- coverage/nav/queue: כיוונון admin-data-layer-coverage.test.ts (סעיף 4), admin-nav-coverage.test.ts, queue-schedule.test.ts.
- בדיקת קורפוס מיגרציה סטטית בסגנון src/lib/supabase/console-view-grants.test.ts: כל פונקציית rdp_* במיגרציה כוללת revoke מ-public, anon, authenticated, ו-`search_path = ''`, ואינה security definer; ל-3 הטבלאות enable row level security; רשימת ה-kind ב-SQL ⊆ events.ts.
DB — מקומי בלבד, לעולם לא על ה-DB החי (אין --linked): `scripts/check-rdp-access-contract.sql` (טרנזקציה אחת עם rollback, ראשית אוכפת מקומיות: `if inet_server_port() is distinct from 54322 then raise exception` — INFERRED, תלוי בפורט הסטאק המקומי), מכסה:
  - מטריצת הרשאות: owner, ops_engineer, billing_clerk, support_agent, auditor (כולל תפקידים ללא אנשים היום — יוצרים auth.users ו-platform_staff זמניים בתוך הטרנזקציה, כמו scripts/check-permission-deny-matrix.sql), משתמש שאינו staff, user null: rdp_request_access/rdp_begin_file_issue/rdp_check_grant דוחים כולם חוץ מבעלים (ומי שסומן במפורש).
  - מכונת מצבים: כל מעבר לא חוקי זורק; DELETE/TRUNCATE זורקים; UPDATE של expires_at זורק; events לא ניתנים לעדכון חוץ מאיפוס IP תחת ה-GUC.
  - אינדקס grant-פעיל-יחיד: אישור שני grants => unique_violation => grant_conflict.
  - ACL: has_function_privilege/has_table_privilege/has_column_privilege לכל התפקידים.
  - התנהגות: already_pending, rate_limited, has_active_grant, invalid_minutes/target, requester_not_allowed, file_limit/too_soon, mark_cut (שתי הצלחות), approve על בקשה שפגה (expired), expire_stale לפני insert.
  מירוצים אמיתיים (שני חיבורים): `scripts/rdp-access-race-test.mjs` מקומי בלבד, שני חיבורי pg: (א) שני approve של שתי בקשות במקביל => grant אחד בדיוק; (ב) approve מול sweep על בקשה בגבול הפקיעה => אחד מנצח, שני בלי שחיתות; (ג) revoke מול check => כל check אחרי commit מחזיר deny; (ד) שני request_access של אותו משתמש => שורת pending אחת; (ה) N הורדות במקביל => files_issued <= max_files. הסטאק המקומי דורש Docker — לא להרים על שרת הפרודקשן (משאבים ופורטים; זיכרון "אין שרתים/פורטים אד-הוק": הבעלים מפעיל, ואז מאמתים חי).
- אימות ריצה בדפדפן (חובה לפי verification-gate-runtime; הבדיקות הסטטיות אינן מכסות זאת), רק אחרי שהבעלים פרס: עמוד צוות בכל מצב (אין/pending/active/denied/expired), 403/redirect לצוות בלי המפתח ולא-בעלים לעמודי הבעלים, RTL (צילום), מקלדת, AlertDialog ב-RTL, כפתור הורדה במצבי 409/429/502; ו-end-to-end אמיתי עם rdpgw רק בתיאום הבעלים (אישור grant אמיתי לעצמו). לא להרים שרת/פורט זמני.
- שערי Definition of Done: npm run lint; npx tsc --noEmit; npm run build (build בודד, אף פעם לא במקביל — זיכרון concurrent-build-collision); npm run worker:deps (גם ב-pretest); בדיקות ממוקדות קודם ואז npm test מלא; npm run types:check אחרי gen:types. כל בדיקה אדומה מתוקנת גם אם לא שלי. להשתמש במיומנות verifying-kalfa-changes לפני "סיימתי". ללא @ts-ignore וללא any.

=====================================================================
10. סדר מסירה, חזרה לאחור ותיעוד
=====================================================================
שלב 0 — חוזה מול rdpgw-eval/plan-infra (חוסם): שמות כותרת המשתמש/הסוד, נתיב /connect, פורמט הבקשה ל-check (הצעתי: POST JSON {user, target, clientIp, phase, tunnelRef}), תשובה {allow, expires_at}, timeout 3 שניות וכשל סגור, סקר חוזר, disconnect ו-list endpoints, אירוע סגירה, location deny ב-nginx, ו-xrdp לא חשוף. חזרה לאחור: אין (לא נכתב קוד).
שלב 1 — מיגרציה (הבעלים מחיל, אחרי dry-run מקומי) ואז `npm run gen:types` ו-`npm run types:check` (שער ה-drift חוסם deploy — VERIFIED ב-package.json deploy). חזרה: ה-Rollback שבכותרת המיגרציה (drop לפי הסדר) + מחיקת מפתח ההרשאה. אין שום קוד אפליקציה שתלוי בה עד שלב 2.
שלב 2 — ליבת src/lib/rdp-access + validation + בדיקות. חזרה: git revert (אין צריכה).
שלב 3 — נתיב ה-check + בלוק headers + בדיקות. אינרטי עד שמוגדר RDPGW_CHECK_SECRET (503). חזרה: revert, או הסרת הסוד (כשל סגור).
שלב 4 — worker sweep + רישום תור + allowance. פריסת worker ע"י הבעלים בלבד. חזרה: revert והסרת הרישום; ה-sweep אידמפוטנטי.
שלב 5 — CLI + סקריפט. קריאה בלבד בשימוש הראשון (list/status) מול ה-DB החי אחרי שלב 1. חזרה: revert.
שלב 6 — מודול צוות + actions + עמוד + ניווט + עדכוני בדיקת כיסוי. נראה רק למחזיקי rdp.request (בעלים כברירת מחדל). חזרה: revert; ובמקרה חירום — הסרת המפתח מתפקיד.
שלב 7 — נתיב ההורדה + כפתור. חזרה: revert; הנתיב מחזיר 503 בלי RDPGW_CONNECT_SECRET.
שלב 8 — עמודי הבעלים (קריאה בלבד).
שלב 9 (אופציונלי) — job מושהה לפקיעה; איפוס IP שבועי; ספירת בקשות ממתינות בניווט (nav-counts.ts).
תיעוד/הסרת מה שהוחלף: VERIFIED ב-grep — אין בריפו שום מימוש/מסמך RDP קיים (התאמה בודדת ב-calendar.tsx היא מקרית), ולכן אין מה להוציא משימוש בצד האפליקציה; יש להוסיף docs/rdp-access/README.md (ארכיטקטורה וגבול האמון) ו-runbook (סיבוב סודות בשני הצדדים, ביטול חירום, מה עושים כש-rdpgw לא נגיש, שחזור אחרי הסרת מפתח), ולהוסיף הפניה ב-CLAUDE.md רק אם יתבקש. אין commit/push בלי בקשה מפורשת.

=====================================================================
11. שאלות פתוחות וסיכונים (כן/לא + המלצה)
=====================================================================
שאלות:
1. לתת rdp.request בברירת מחדל לתפקיד כלשהו שאינו בעלים (למשל ops_engineer)? המלצה: לא — הבעלים מסמן ב-/admin/roles בעת הצורך.
2. פרמטרים: בקשה פגה אחרי 30 דקות, משך 30/60/120/240 עם ברירת מחדל 60 ותקרה קשיחה 240 (CHECK ב-DB), 20 הורדות ל-grant, 10 שניות בין הורדות, 6 בקשות לשעה? המלצה: כן.
3. האם הכניסה ל-xrdp דורשת סיסמת OS של kalfa.me אצל המקבל? (לתשתית.) אם כן — קיים אישור root לשימוש חוזר מחוץ למערכת, והמלצה לדון בחלופה (חשבון OS נפרד או כניסה בלי סיסמה דרך הגשר).
4. לאכוף קשירת IP לקוח (IP של הדפדפן מול IP של לקוח ה-RDP)? המלצה: לא — לרשום בלבד; הדפדפן והלקוח עשויים לצאת מכתובות שונות (CGNAT/IPv6/VPN), וסמנטיקת הכותרות לא אומתה.
5. לדרוש מ-rdpgw סקר חוזר כל 30–60 שניות, סגירה עצמית ב-expires_at, דיווח tunnel_closed ו-endpoint לרשימת מנהרות? המלצה: כן (הצעד הזול ביותר שעובד גם כש-KALFA לא נגיש).
6. מותר לבעלים לאשר בקשה של עצמו (self_approved נרשם והתראה יוצאת)? המלצה: כן.
7. לשקף אירועי מחזור חיים גם ל-activity_log? המלצה: לא (סעיף 8).
8. לדרוש גורם שני ל-approve ב-CLI (TOTP)? המלצה: לא בגרסה 1 — אין לו ערך אמיתי מול תוקף שכבר שולט ב-OS; הבקרה האפקטיבית היא ההתראה החיצונית.
9. לעדכן את ה-nginx ב-`location ^~ /api/rdp-gateway/ { return 404; }`? המלצה: כן (פריט תשתית).
10. job מושהה ל-expires_at (שלב 9)? המלצה: לא אם שאלה 5 מתקבלת; אחרת כן.
11. שמירת אירועים שנתיים, איפוס IP אחרי 90 יום? המלצה: כן.
12. כתיבות כ-service_role-בלבד (המומלץ כאן) או RPC בסגנון fleet (DEFINER, EXECUTE ל-authenticated, חותם auth.uid())? המלצה: service_role-בלבד — נקודת כניסה אחת שבה נקבעים IP, התראה, Origin ומגבלות; החלופה נותנת ל-DB לדעת מי המשתמש גם אם האפליקציה טעתה, אך מאפשרת עקיפה ישירה מהדפדפן של כל מה שקיים רק בצד האפליקציה.
13. כשיש כמה בעלים, ה-CLI דורש --as: מקובל? המלצה: כן.
14. הורדה כ-fetch+Blob בדפדפן (שגיאות בתוך הדף) ולא כניווט טופס? המלצה: כן.
סיכונים:
- R1 (קבלת הבעלים): חשבון OS משותף root-שקול — המקבל שולט בשרת, ב-.env.local, ב-CLI וכנראה ביומן. הבקרות מול זה: התראה חיצונית בלבד.
- R2: נתיב Tailscale ישיר (ללא גידור) ו-xrdp חשוף עוקפים את הגשר — תשתית.
- R3: rate-limit.ts per-process (pm2 fork יחיד, מתאפס ב-restart/deploy) — לכן כל מגבלה חשובה מוגנת ב-DB.
- R4: הבדיקה עושה round-trip ל-Supabase בכל פתיחת מנהרה — אם Supabase לא נגיש, מנהרות חדשות נחסמות (כשל סגור; מכוון). מנהרות קיימות נשארות עד expires_at אם rdpgw מיישם סגירה עצמית.
- R5: חוזה rdpgw עדיין INFERRED — נעילתו חוסמת שלבים 3 ו-7.
- R6: אינדקס ((true)) החלקי ו-ON CONFLICT על predicate נבדקים רק בהרצה מקומית.
- R7: ה-sweep מחזיר ניתוק רק אחרי שתי הצלחות; אם rdpgw לא יספק endpoint ניתוק לפי grant, אין מנגנון לחתוך מנהרה חיה מ-KALFA.

קבצי עזר שנקראו (נתיבים מוחלטים): /var/www/vhosts/kalfa.me/beta/{CLAUDE.md,supabase/migrations/20260723094500_fleet_requests.sql,20260719215138_platform_permission_matrix_by_role.sql,20260924034054_owner_agent_whatsapp.sql,20260906221951_view_events_permission.sql,20260929001415_test_event_purge.sql,20261006065916_payment_refund_cap.sql,20261006040156_payment_ledger_db_guards.sql,20261006031606_payment_operation_lines.sql,20261004105957_payment_operations_expand.sql, src/lib/auth/dal.ts, src/lib/auth/admin-data-layer-coverage.test.ts, src/app/api/voximplant/console/authorize/route.ts, src/app/api/admin/fleet-file/route.ts, src/lib/data/console-calls.ts, src/lib/security/{token-compare,rate-limit}.ts, src/lib/queue/{queues,web-sender,deterministic-id}.ts, src/lib/ops/queue-schedule.ts, worker/main.ts, ecosystem.config.cjs, next.config.ts, package.json, scripts/fleet-agent-cli.ts, scripts/voximplant/set-console-secret.ts} ו-/etc/nginx/conf.d/beta-proxy.conf (קריאה בלבד).

---

# חלק ב. צד התשתית (שער, nginx, xrdp, חומת אש)

*מוטמע כמות שהוגש, ללא עריכה. ההתאמות לחוזה מול חלק א מפורטות בסעיפים 3א ו-4 למעלה, והן גוברות במקרה של סתירה (כולל `EnableUserToken` ו-`NoUsername`).*

תוכנית תשתית: RD Gateway (rdpgw) למסלול (b) — תכנון בלבד, לא הוחל דבר על השרת
סימון: VERIFIED = קראתי/הרצתי ; INFERRED = הסקה ; UNKNOWN = לא ידוע.
קבצי עבודה (טיוטות, לא הוחלו) ב: /tmp/claude-10003/-var-www-vhosts-kalfa-me-beta/9b86a809-6388-4803-a63f-1d093dfccf79/scratchpad/drafts/  (rdpgw-ops/ = patches/0001,0002 + go.sum + build.sh + PINNED_COMMIT + SHA256SUMS ; rdpgw-proxy.conf ; rdpgw.service ; rdpgw.yaml ; default.rdp ; kalfa-rdp-guard.rules ; kalfa-rdp-guard6.rules)

========== 0. גילוי נאות (חשוב לקרוא ראשון) ==========
א. חריגה מ"אפס כתיבה מחוץ ל-scratchpad": פקודת `go vet` אחת הורצה בלי משתני הסביבה של ה-scratchpad והורידה 15 מודולים (uuid, websocket, prometheus/*, go-cache, testify, x/net, x/sys, protobuf ועוד) אל מטמון המודולים הרגיל /var/www/vhosts/kalfa.me/go/pkg/mod, ויש להניח גם רשומות ב-~/.cache/go-build. אלה מטמונים בלבד (לא קונפיגורציה, לא קוד), לא ניקיתי כלום. אם תאשר: אפשר למחוק רק את הרשומות החדשות (ציון זמן > 2026-10-06 18:40). כל שאר הבנייה/בדיקות רצו עם GOPATH/GOMODCACHE/GOCACHE בתוך ה-scratchpad (קובץ goenv.sh).
ב. הרצות שאינן שינוי מערכת, לשם שקיפות: `go test` מרים שרתי httptest in-process על פורט אפמרלי בלופבק (זה בדיקות, לא שירות); הרצתי את הבינארי המתוקן 8 פעמים עם קונפיג שגוי בכוונה — הוא יוצא ב-log.Fatal לפני שהוא קושר פורט (אומת: אין listener על 3013/3014 לאחר מכן); `nginx -t -c <קונפיג פרטי ב-scratchpad>` (לא נגע ב-nginx החי); `iptables-restore --test` ו-`ip6tables-restore --test` (parse בלבד, ללא commit — אומת שאין שרשרת KALFA חיה); `systemd-analyze verify`; כל פקודות ה-sudo היו קריאה בלבד.
ג. patch 0002 (סוד משותף על /connect) הוא שינוי שלישי מעבר לשניים שביקשת; הוא בקובץ נפרד ושאלת כן/לא בסעיף 10.

========== 1. בנייה, pin ו-patch של rdpgw ==========
1.1 מקור ו-pin
- מודול: github.com/bolkedebruin/rdpgw ; commit מוצמד 16cdaaf4dce6a6567ce9b612f14e71d0ca704148 (Tue Aug 18 2026) VERIFIED (git log בשכפול).
- go.mod דורש `go 1.25.0`. [עודכן 6.10] ב-Go 1.26.2 המותקן ו-GOTOOLCHAIN=local נמצאו 16 פגיעויות מושפעות (10 בספריית Go עצמה, 6 במודולים), ולכן `build.sh` קובע `GOTOOLCHAIN=go1.26.6` (המנגנון המובנה של Go; ה-toolchain יורד מ-proxy.golang.org ומאומת מול sum.golang.org) ו-patch 0003 מעלה את grpc, websocket, x/crypto, x/net, x/text, x/sys לגרסאות המתוקנות. VERIFIED (govulncheck על הקוד ועל הבינארי).
- ממצא: go.sum ב-.gitignore של upstream (git ls-files: רק go.mod) VERIFIED. בלי go.sum הבנייה נכשלת ("missing go.sum entry") VERIFIED. `go mod tidy -compat=1.22` (יעד `make mod`) מייצר go.sum של 184 שורות ולא משנה את go.mod VERIFIED. לכן מאחסנים go.sum משלנו בריפו (sha256 80ce20fe5ebbc2f0aab5766625e86870ded978583cf4c1600a76143357b0795b). הרשת נדרשת: proxy.golang.org ו-sum.golang.org נגישים מהשרת (HTTP 200) VERIFIED.
- דגלים מאומתים: CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags='-buildid=' -o rdpgw ./cmd/rdpgw. [עודכן 6.10: בלי `-s -w`, כדי ש-govulncheck במצב binary יזהה סמלים בפועל; עם strip הוא דיווח 6 ממצאים שנראו תוצר של התאמה ברמת המודול, ובבינארי לא-stripped נשאר ממצא אחד אמיתי.] תוצאה: ELF סטטי עם debug_info, כ-24MB VERIFIED. הבנייה דטרמיניסטית: שתי בניות מספריות שונות נתנו sha256 זהה VERIFIED.
- sha256 של הבינארי הסופי (go1.26.6 + patches 0001+0002+0003 + go.sum שב-`ops/rdpgw/`): ebfcdf0c66bffe9809796d30417d2781ad0775450f9f23639fe81edf41230071 VERIFIED (build.sh מאפס פעמיים, כל השערים ירוקים: vet, govulncheck קוד, `go test -race`, בנייה, govulncheck בינארי, השוואת BINARY_SHA256). נשארים 3 ממצאים ש-govulncheck מגדיר כ"לא נקראים": x/crypto 0.55.0 (GO-2026-6355, GO-2026-6354, תיקון ב-0.56.0) ו-GO-2026-5932 (openpgp, אין תיקון).
1.2 מיקום ב-repo (הצעה) ובעלות
- `ops/rdpgw/` (ב-ops/ יש היום רק probe-server.mjs, probes.mjs): PINNED_COMMIT, patches/0001-kalfa-grant-check-and-disconnect.patch (sha256 b55bd259…8f7f), patches/0002-kalfa-header-shared-secret.patch (sha256 09c3c353…afad), go.sum, build.sh, SHA256SUMS, rdpgw.yaml.template, rdpgw.service, nginx rdpgw-proxy.conf, default.rdp, README (runbook). להוסיף ל-.gitignore: ops/rdpgw/build/. (לפי CLAUDE.md: לא מבצעים commit בלי בקשה מפורשת.)
- build.sh (טיוטה בתיקיית drafts): clone -> checkout --detach $PIN -> אימות HEAD -> git apply --check + apply לכל patch לפי סדר -> cp go.sum -> go vet -> go test -race -> go build -> sha256sum. רץ כמשתמש kalfa.me; תוצר: ops/rdpgw/build/rdpgw (kalfa.me:psacln).
- התקנה (sudo, owner): `sudo install -D -o root -g root -m 0755 ops/rdpgw/build/rdpgw /opt/rdpgw/releases/<sha12>/rdpgw` ואז symlink `/opt/rdpgw/current -> releases/<sha12>`. שני ה-patches עוברים `git apply` נקי על 16cdaaf4 VERIFIED.
1.3 הפירוט הטכני של ה-patch (עוגני שורות בשכפול המקורי)
(א) למה Disconnect הקיים מת/נתקע — VERIFIED גם בהרצה:
 - protocol/track.go:39-49 `Disconnect` שולח `m.Processor.ctl <- ctlDisconnect` (שורה 47). ה-channel נוצר לא-ממוקצב ב-process.go:38 (`ctl: make(chan int)`) ואף goroutine לעולם לא קורא ממנו (grep: השליחה היחידה היא בשורה 47). בנוסף Process() חסום ב-`p.tunnel.Read()` (process.go:48) ולכן גם אילו קרא — לא היה מגיע ל-select. התוצאה: ה-goroutine של הקריאה נתקע לנצח (לא deadlock של מנעולים: ה-RLock משוחרר לפני השליחה, אלא "חוסר מקבל"). הוכחה: בדיקה על הקוד המקורי (worktree נקי) — `Disconnect` לא חזר 2 שניות. הבדיקה הקיימת track_test.go:TestDisconnectKnownConnection מסתירה זאת כי היא בונה `Processor{ctl: make(chan int,1)}` עם buffer.
(ב) תכנון בטוח: לא משתמשים ב-ctl. `Tunnel.Close()` (tunnel.go) סוגר transportIn/transportOut ואת rwc (ה-TCP ל-xrdp) תחת mutex, idempotent; הקריאה החסומה ב-Process נכשלת והלולאה יוצאת דרך ה-defer הקיים (RemoveTunnel + inout.Close). `setRWC` (process.go:142 המקורי) מסרב אם המנהרה כבר נסגרה — סוגר חלון מרוץ בין ביטול ליצירת channel. RemoveTunnel קורא Close (משחרר טיימר ו-transport יתום במסלול legacy).
(ג) בדיקת grant לכל מנהרה חדשה: security/jwt.go:61-112 CheckPAACookie — ההוספה אחרי שורה 109 (`tunnel.User.SetUserName`) ולפני `return true,nil` (שורה 111): `tunnel.SetOwner(subject, clientIp, target)` (לפני הקריאה החיצונית, כדי שביטול שנוחת באמצע הבדיקה ימצא את המנהרה), ואז `requireGrant` (קובץ חדש security/grant.go). Fail-closed: שגיאת רשת/timeout (ברירת מחדל 3000ms)/סטטוס != 200/גוף > 4KB או פגום/allow != true => דחייה; לאחר הבדיקה `if tunnel.IsClosed() => deny`; `SetGrantDeadline(expiresAt)` מפעיל time.AfterFunc שסוגר את המנהרה בפקיעת ה-grant גם אם קריאת הביטול לא הגיעה (חגורה ובורג). הלקוח מקבל E_PROXY_COOKIE_AUTHENTICATION_ACCESS_DENIED (process.go:91-95, ללא שינוי).
   חוזה לאפליקציה (plan-app): POST http://127.0.0.1:3002/<path>, Authorization: Bearer <GRANTCHECKTOKEN>, גוף JSON {user, clientIp, target, tunnelId, rdgConnectionId} — ללא ה-PAA token (נבדק בבדיקה: הגוף הגולמי לא מכיל את הטוקן). תשובה 200 {"allow":true,"grantId":"…","expiresAt":"RFC3339"}; כל דבר אחר = דחייה. כתובת ה-URL חייבת להיות IP לופבק מילולי (127.0.0.1) — "localhost" נדחה בהפעלה VERIFIED.
(ד) Admin API לופבק בלבד (admin/admin.go, מחבר ב-main.go): מאזין נפרד על Server.AdminAddress (127.0.0.1:3014; כתובת לא-לופבק => Fatal VERIFIED), אימות כפול: RemoteAddr לופבק + Bearer (השוואה בזמן קבוע, >=32 תווים). GET /admin/v1/tunnels ; POST /admin/v1/disconnect {"user":…} או {"tunnelId":…} (בדיוק אחד) -> {"closed":N}.
(ה) הפעלה מסרבת בלי ההגנות: header-auth ללא security.grantcheckurl => Fatal ; grantchecktoken/admintoken קצר מ-32 => Fatal ; כתובת לא-לופבק => Fatal. (3 מקרים הורצו ויצאו ב-exit=1 לפני bind VERIFIED.)
(ו) patch 0002 (אופציונלי, כן/לא): web/header.go + config: חובה Header.SecretHeader/Secret על /connect. הסיבה — ממצא: ב-header-only mode ה-route /remoteDesktopGateway/ פתוח לגמרי (main.go:285-288, אין middleware), ו-/connect סומך על כל RemoteAddr בתוך Header.TrustedProxies; לופבק הוא גבול אמון חלש במכונה הזו (כל תהליך מקומי, וגם nginx עצמו שרץ על 127.0.0.1) => ללא סוד, כל תהליך מקומי יכול להנפיק .rdp+PAA token לכל זהות; הוא עדיין ייחסם ע"י בדיקת ה-grant, אבל הסוד מוסיף שכבה.
1.4 תבנית קונפיג מלאה (rdpgw.yaml, 0644 root:root, ללא סודות). שמות הסקציות חייבים אות ראשונה גדולה (koanf case-sensitive; מפתחות בפנים לא) VERIFIED
```yaml
Server:
  Authentication: [header]
  Tls: disable
  BindAddress: 127.0.0.1
  Port: 3013
  GatewayAddress: gw.kalfa.me
  Hosts:
    - nm-digitalhub.tail703115.ts.net:3389
  HostSelection: roundrobin
  TrustedProxies: ["127.0.0.1/32"]
  SessionStore: cookie
  AdminAddress: 127.0.0.1:3014
Header:
  UserHeader: X-Kalfa-Staff-Id
  TrustedProxies: ["127.0.0.1/32"]
  SecretHeader: X-Kalfa-Internal
Caps:
  TokenAuth: true
  IdleTimeout: 30
  EnableClipboard: false
  EnableDrive: false
  EnablePrinter: false
  EnablePort: false
  EnablePnp: false
Client:
  NoUsername: true
  Defaults: /etc/rdpgw/default.rdp
Security:
  VerifyClientIp: true
  EnableUserToken: false
  GrantCheckUrl: http://127.0.0.1:3002/api/internal/rdp-gateway/tunnel-check
  GrantCheckTimeoutMs: 3000
```
נימוקים לכל מפתח:
- Authentication [header] + Header.UserHeader/TrustedProxies: הזהות מוטבעת ע"י KALFA בקריאת לופבק ל-/connect; Header.TrustedProxies חובה אחרת rdpgw לא עולה (main.go:259-261) VERIFIED. 127.0.0.1/32 בלבד, ו-KALFA חייב לקרוא ל-http://127.0.0.1:3013 (לא localhost, כי ::1 לא מאזין).
- Tls: disable + BindAddress 127.0.0.1 + Port 3013: nginx מסיים TLS. פורט 3013 (ו-3014 ל-admin) פנויים VERIFIED (ss; פורטים תפוסים: 3000,3002,3011,3012,3030…) ומחוץ לטווח האפמרלי 32768-60999.
- Hosts: ערך יחיד, באותיות קטנות, עם :3389 — CheckHost משווה מחרוזת מדויקת מול net.JoinHostPort(שם,פורט) שהלקוח שולח (process.go:131, security/basic.go:30-35) VERIFIED; ו-README: mstsc דורש שם ולא IP, ושולח name:port. במקום alias ב-/etc/hosts השתמשתי בשם MagicDNS: מתפרש בשרת ל-100.106.199.107 דרך systemd-resolved/Tailscale (getent + resolvectl) VERIFIED, בלי שינוי /etc/hosts. אם Tailscale DNS יקרוס — החיבור נכשל סגור (fail closed). חלופה אם יתברר שבור (דורשת אישור): שורת /etc/hosts.
- HostSelection roundrobin עם רשימה של אחד (מצבי signed/unsigned/roundrobin מתעלמים מ-AllowedDestinationPorts/AllowPrivateDestinations: ה-destPolicy נבדק רק במצב `any`, web.go getHost) VERIFIED. אסור `any`: net.IP.IsPrivate() של Go לא מכסה 100.64.0.0/10 (CGNAT) => `any` היה מאפשר ריליי לכל peer בטיילנט (INFERRED מהגדרת stdlib). לכן אין צורך ולא מגדירים AllowedDestinationPorts/AllowPrivateDestinations.
- TokenAuth true (ברירת מחדל) ; NoUsername true ; EnableUserToken false (אין token משתמש ב-.rdp).
- VerifyClientIp true — חיווט מקצה לקצה חובה: (1) KALFA קורא ל-/connect עם X-Forwarded-For: <IP הדפדפן של העובד>, ו-(2) לוקח את ה-IP מ-X-Real-IP (ש-beta-proxy.conf מציב מ-$remote_addr) ולא מהרכיב הראשון של X-Forwarded-For (שם beta-proxy משתמש ב-$proxy_add_x_forwarded_for, כלומר הלקוח שולט ברכיב הראשון) VERIFIED מקריאת beta-proxy.conf. (3) Server.TrustedProxies חייב לכלול 127.0.0.1/32 אחרת ה-XFF מתעלם ו-ClientIp = 127.0.0.1 (context.go:81-92). ה-token נושא את ה-IP, ובכל מנהרה CheckSession משווה (jwt.go:52). Dual-stack: ל-ens6 אין IPv6 גלובלי (רק fe80) ול-beta/gw אין AAAA VERIFIED => גם הדפדפן וגם mstsc מגיעים ב-IPv4, אין אי-התאמה v4/v6. נשארו: egress מפוצל (VPN split-tunnel, דפדפן ו-mstsc על מכשירים/רשתות שונות), CGNAT סלולרי, roaming — תוצאה: דחייה שגויה, העובד מוריד .rdp מחדש (אקסיומטי ובטוח). אם בבדיקות יימצא שזה נפוץ: false מחליש (קובץ .rdp גנוב שמיש 5 דקות מכל מקום כל עוד ה-grant פעיל; עדיין תחום ע"י בדיקת ה-grant). המלצה: true.
- Caps.Enable*=false: דגלי ההפניה נשלחים ללקוח (process.go:292) והלקוח אוכף — לא גבול אבטחה; חלים רק על מסלול (b) ולא על הבעלים. IdleTimeout 30 דקות (חצי-אחד: ניתוק מנהרה בלבד, ה-session נשאר).
- default.rdp (מומלץ, בעלות rdp-client-compat): authentication level:i:0 + enablecredsspsupport:i:0 — נבדק מול ה-builder של rdpgw והופיע ב-.rdp VERIFIED. ב-RdpSettings אין `session bpp` => אי אפשר לנעול עומק צבע דרך rdpgw (ראו Policy=Default בסעיף 4).
1.5 מפתחות — יצירה/אחסון בלי להדפיס; מה משתנה בהפעלה מחדש
- 4 מפתחות rdpgw בדיוק 32 תווים כל אחד (אחרת config.Load מחליף ל"random" בכל הפעלה — הראיתי: בלי מפתחות 4 שורות "Setting to random", עם 4 מפתחות hex של 32 תווים 0 שורות VERIFIED). 3 סודות משותפים >=32 תווים.
- שמות משתני סביבה (VERIFIED שהם נקראים: RDPGW_HEADER__SECRET ו-RDPGW_SECURITY__GRANTCHECKTOKEN עברו את ה-guards): RDPGW_SERVER__SESSIONKEY, RDPGW_SERVER__SESSIONENCRYPTIONKEY, RDPGW_SECURITY__PAATOKENSIGNINGKEY, RDPGW_SECURITY__PAATOKENENCRYPTIONKEY (כל אחד openssl rand -hex 16), RDPGW_SECURITY__GRANTCHECKTOKEN, RDPGW_SECURITY__ADMINTOKEN, RDPGW_HEADER__SECRET (כל אחד openssl rand -hex 32).
```bash
sudo install -d -m 0750 -o root -g rdpgw /etc/rdpgw
( umask 077
  for k in SERVER__SESSIONKEY SERVER__SESSIONENCRYPTIONKEY SECURITY__PAATOKENSIGNINGKEY SECURITY__PAATOKENENCRYPTIONKEY; do printf 'RDPGW_%s=%s\n' "$k" "$(openssl rand -hex 16)"; done
  for k in SECURITY__GRANTCHECKTOKEN SECURITY__ADMINTOKEN HEADER__SECRET; do printf 'RDPGW_%s=%s\n' "$k" "$(openssl rand -hex 32)"; done
) | sudo tee /etc/rdpgw/secrets.env >/dev/null
sudo chown root:rdpgw /etc/rdpgw/secrets.env && sudo chmod 0640 /etc/rdpgw/secrets.env
```
 3 הסודות המשותפים צריכים להגיע גם ל-.env.local של KALFA (0600) — בלי הדפסה: מחלצים עם `sudo awk -F= '/^RDPGW_SECURITY__GRANTCHECKTOKEN=/{print "RDPGW_GRANT_TOKEN=" $2}' /etc/rdpgw/secrets.env >> .env.local` (שמות המשתנים ב-KALFA — החלטת plan-app). לוודא אחר כך `stat -c '%a %U:%G' .env.local` = 600.
- הפעלה מחדש של rdpgw: (א) כל המנהרות החיות נחתכות (התהליך מת), ה-session של xrdp לא נפגע; (ב) מפתחות קבועים => cookies/PAA tokens שעדיין בתוקף (5 דקות) ממשיכים להיות תקפים; (ג) אין state על דיסק (SessionStore cookie; os.TempDir משמש רק ל-file store; autocert לא פעיל ב-Tls disable); (ד) mstsc שמתחבר מחדש עם אותו .rdp אחרי 5 דקות נכשל (token פג) — צריך להוריד .rdp חדש מ-KALFA (ה-grant עדיין פעיל). rotation של מפתח: החלפה בקובץ + restart = ניתוק כל המנהרות.

========== 2. ניהול תהליך — המלצה: systemd (יחידה אחת, משתמש ייעודי) ==========
השוואה (קראתי ecosystem.config.cjs, ecosystem.owner-agent.config.cjs, pm2-kalfa.me.service, seating-optimizer.service, ollama.service):
- pm2: תקדים חזק (7 אפליקציות; kalfa-filebrowser = בינארי עם interpreter:'none' ו-bind 127.0.0.1) והדיבאג/ops-agent מזהה pm2. אבל: רץ כ-kalfa.me (שורש-שווה: NOPASSWD sudo + קבוצת docker — עובדה שנתת), אין הגבלת egress/FS, סודות ב-ecosystem או ב-env שנתפס (ה-header של הקובץ מתעד תקלות כאלה), אין pm2-logrotate (יש רק pm2-server-monit; mcp-chrome-error.log=18.7MB) VERIFIED. rdpgw הוא daemon רשת שמנתח פרוטוקול בינארי מהאינטרנט — הכי חשוף במערכת.
- systemd: תקדים קיים: seating-optimizer.service (EnvironmentFile ב-/etc/…/env 0640 root:psacln, Protect*/NoNewPrivileges/Restrict*), ollama.service (משתמש ייעודי) VERIFIED. journald פרסיסטנטי (SystemMaxUse=500M, 41MB בשימוש) VERIFIED => אין בעיית rotation. נתן IPAddressDeny=any + IPAddressAllow=127.0.0.0/8 100.106.199.107/32 — גם אם rdpgw נפרץ הוא לא יכול ליצור חיבורי יציאה אחרים.
=> המלצה: systemd. טיוטת היחידה (systemd-analyze verify עבר; חסר רק הבינארי; `security --offline` = 2.9 OK) :
```ini
[Unit]
Description=KALFA RD Gateway (rdpgw @16cdaaf4 + KALFA patches) - loopback only
After=network-online.target tailscaled.service
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=5
[Service]
Type=simple
User=rdpgw
Group=rdpgw
EnvironmentFile=/etc/rdpgw/secrets.env
ExecStart=/opt/rdpgw/current/rdpgw -c /etc/rdpgw/rdpgw.yaml
Restart=on-failure
RestartSec=3
SyslogIdentifier=rdpgw
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
SystemCallArchitectures=native
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
AmbientCapabilities=
IPAddressDeny=any
IPAddressAllow=127.0.0.0/8 100.106.199.107/32
MemoryMax=256M
TasksMax=256
LimitNOFILE=4096
[Install]
WantedBy=multi-user.target
```
- משתמש: המשתמש rdpgw לא קיים (getent rc=2) VERIFIED => `sudo useradd --system --no-create-home --shell /usr/sbin/nologin rdpgw` ; /opt/rdpgw (root:root 0755), /etc/rdpgw (root:rdpgw 0750). ה-DNS של שם MagicDNS עובר דרך stub 127.0.0.53 (מותר ב-127.0.0.0/8) — INFERRED, יאומת בבדיקת הקבלה (אם נחסם: להוסיף 100.100.100.100/32 ל-Allow).
- מדיניות הפעלה: Restart=on-failure (stop מפורש לא מפעיל מחדש), RestartSec=3, StartLimit 5/120s. לוגים: journald (`journalctl -u rdpgw`), SyslogIdentifier=rdpgw.
- פריסה ואימות ע"י ה-owner (כלל "אין שרתים ad-hoc": ה-owner פורס ואז מאמתים חי): `sudo systemctl daemon-reload && sudo systemctl enable --now rdpgw` ; אימות: `systemctl is-active rdpgw`, `ss -tlnp | grep -E '127.0.0.1:(3013|3014)'`, `journalctl -u rdpgw -n 20 --no-pager`. אופציונלי: להוסיף ל-ops-agent probe `systemctl is-active rdpgw` (כדי שיופיע ב-Debug Mode שמכיר היום רק pm2).

========== 3. פרסום ההוסטניים gw.kalfa.me ==========
3.1 עובדות: אזור kalfa.me מקומי: NS ns1/ns2.kalfa.me = 217.154.17.185/.205 (השרת הזה), `plesk bin dns --info kalfa.me` מחזיר את האזור, named מקומי על :53 VERIFIED. אין DNSSEC (DS ריק) VERIFIED. SOA minimum=10800 (3 שעות — NXDOMAIN שנשמר אצל resolvers) VERIFIED => להוסיף את הרשומה לפני חלון התחזוקה. אין AAAA ל-beta ו-gw (ואין IPv6 גלובלי ב-ens6) VERIFIED.
3.2 DNS (ה-owner; לפי כלל Plesk DNS): 
  `sudo -n plesk bin dns --add kalfa.me -a gw -ip 217.154.17.185 -ttl 300` ; אימות: `sudo -n plesk bin dns --info kalfa.me | grep -i '^gw'` ו-`dig +short gw.kalfa.me @127.0.0.1` ו-`dig +short gw.kalfa.me @8.8.8.8` => 217.154.17.185 ; rollback: `sudo -n plesk bin dns --del kalfa.me -a gw -ip 217.154.17.185`. (הפקודה מאומתת מול ה-help של plesk bin dns.)
3.3 TLS: אין צורך להנפיק. קיים תעודת wildcard `*.kalfa.me` (SAN: *.kalfa.me, kalfa.me), RSA-2048, פגה 2026-11-30, issuer Let's Encrypt YR1, ב-/opt/psa/var/modules/letsencrypt/etc/live/kalfa.me/{fullchain,privkey}.pem (symlinks ל-archive/…5.pem; תיקייה psaadm 0700, nginx master קורא כ-root) VERIFIED. אותו מבנה שבו beta-proxy.conf משתמש.
3.4 אסטרטגיית nginx — המלצה: קובץ conf.d ידני, לא subdomain של Plesk. תקדים: /etc/nginx/conf.d/beta-proxy.conf ו-cto-proxy.conf (ההערה בראש beta-proxy.conf: "Loaded from conf.d before zz010_psa_nginx.conf") ; Plesk מייצר מחדש רק /etc/nginx/plesk.conf.d/* ואת `zz010_psa_nginx.conf` ("DO NOT MODIFY…") VERIFIED => קובץ ידני ב-conf.d שורד. אם בכל זאת רוצים Plesk-native: "Additional nginx directives" נכתב ל-/var/www/vhosts/system/<domain>/conf/vhost_nginx.conf (שורת include בסוף ה-server בקובץ הנוצר; אצל beta הוא ריק, 1 בייט) VERIFIED — אבל ה-vhost של Plesk מביא location ל-PHP/Apache ועוד, ולכן מיותר כאן.
3.5 הקובץ המוצע /etc/nginx/conf.d/rdpgw-proxy.conf (נבדק תחבירית: `nginx -t` על קונפיג פרטי ב-scratchpad עם תעודה עצמית — syntax is ok; לא נגע ב-nginx החי):
```nginx
map $http_upgrade $rdgw_connection_upgrade { default upgrade; '' close; }
limit_req_zone  $binary_remote_addr zone=rdgw_req:10m  rate=5r/s;
limit_conn_zone $binary_remote_addr zone=rdgw_conn:10m;
# בלי $request/$args/$request_uri — שום דבר שיכול לשאת token או query string
log_format rdgw '$remote_addr [$time_iso8601] $request_method $uri $status rt=$request_time bytes=$body_bytes_sent rdgid="$http_rdg_connection_id" upg="$http_upgrade" ua="$http_user_agent"';
server {
    listen 217.154.17.185:443 ssl;
    http2 off;
    server_name gw.kalfa.me;
    ssl_certificate     /opt/psa/var/modules/letsencrypt/etc/live/kalfa.me/fullchain.pem;
    ssl_certificate_key /opt/psa/var/modules/letsencrypt/etc/live/kalfa.me/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256;
    access_log /var/log/rdpgw/nginx-access.log rdgw;
    error_log  /var/log/rdpgw/nginx-error.log warn;
    client_max_body_size 0;
    location / { return 404; }                       # allow-list: כל מה שאינו נקודת ה-RDG הוא 404
    location ^~ /remoteDesktopGateway/ {
        limit_req zone=rdgw_req burst=20 nodelay;
        limit_req_status 429;
        limit_conn rdgw_conn 10;
        proxy_pass http://127.0.0.1:3013;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $rdgw_connection_upgrade;
        proxy_set_header Host       $host;
        proxy_set_header X-Forwarded-For   $remote_addr;   # לא $proxy_add_x_forwarded_for
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Kalfa-Staff-Id "";              # nginx עצמו ב-TrustedProxies: לא מאפשרים הברחת זהות
        proxy_set_header X-Kalfa-Internal "";
        proxy_buffering off; proxy_request_buffering off; proxy_cache off;
        proxy_next_upstream off; proxy_connect_timeout 5s;
        proxy_read_timeout 1d; proxy_send_timeout 1d;
    }
}
```
הסברים: allow-list במקום block-list חוסם /connect, /metrics, /tokeninfo (שלושתם ללא אימות בצד rdpgw: main.go:221-224), וגם /api/v1/*, /static, /assets, /callback, /KdcProxy. nginx מנרמל `..` לפני התאמת location. ה-ciphers מה-README של rdpgw ("Client Caveats", עובד עם mstsc); המפתח RSA לכן נכנסים ECDHE-RSA/DHE-RSA; ssl_dhparam גלובלי קיים (conf.d/ssl.conf) ; ה-ssl_ciphers הגלובלי כולל !EDH, אבל ההגדרה ב-server גוברת. `http2 off`: RD Gateway = HTTP/1.1 + WebSocket Upgrade; ה-upstream חייב HTTP/1.1 (rdpgw עם Tls disable מדבר HTTP/1.1 בלבד; main.go:337 מכבה h2 גם ב-TLS). ALPN ב-nginx 1.30: ההגדרה per-server — INFERRED; מאמתים (בדיקה 8). משתנה ה-map נקרא rdgw_… כדי לא להתנגש ב-$connection_upgrade הקיים. client_max_body_size 0 ו-proxy_request_buffering off נשארים כגיבוי, אבל המסלול ה-legacy מת (ראו 10/סיכון 6): ב-header-only mode ה-RDG_IN_DATA מקבל 401 (tunnelOwnerMatches דורש UserName לא ריק, ו-cookie הסשן אובד ב-hijack) — הרצתי בדיקה in-process על עותק: RDG_OUT_DATA=200, RDG_IN_DATA=401 VERIFIED => WebSocket חובה. הודעתי ל-rdp-client-compat.
 נוסף: ב-/etc/nginx/conf.d/beta-proxy.conf (בלוק 443 של beta.kalfa.me) להוסיף לפני `location /`: `location ^~ /api/internal/rdp-gateway/ { return 404; }` — כי nginx מעביר את כל beta.kalfa.me ל-127.0.0.1:3002 ו-endpoint ה-grant check לא צריך להיות חשוף לציבור (rdpgw קורא ישירות ל-127.0.0.1:3002, לא דרך nginx). זה שינוי ב-vhost הפרודקשן — שער אישור נפרד.
3.6 לוגים: /var/log/rdpgw/ (root:root 0750 — nginx master כותב כ-root) + logrotate ייעודי /etc/logrotate.d/rdpgw-nginx: daily, rotate 30, compress, postrotate `kill -USR1 $(cat /run/nginx.pid)` (לא copytruncate). לא להשתמש ב-/var/log/nginx/*.log: ה-stanza הקיים שם daily אבל בלי rotate => ברירת מחדל גלובלית rotate 4 (4 ימים) VERIFIED (/etc/logrotate.conf: weekly, rotate 4), וקובץ שמתאים לשני stanzas גורם לשגיאת logrotate.
3.7 ModSecurity / Imunify360 / fail2ban — האם יפריעו ל-RDG:
 - ModSecurity: מודול nginx לא נטען (modules.conf.d: רק brotli ו-passenger; modsecurity.load רק ב-available.d) VERIFIED. ה-jail "plesk-modsecurity" קורא /var/log/modsec_audit.log של Apache. => לא חל על בלוק conf.d.
 - fail2ban: 6 jails (apache-auth, apache-badbots, plesk-modsecurity, plesk-one-week-ban, plesk-permanent-ban, sshd) קוראים לוגים של Apache/modsec/auth VERIFIED => אף jail לא קורא לוג nginx => לא יפריע (וגם לא יגן). אופציונלי בעתיד: jail עם backend=systemd על יחידת rdpgw עם failregex `Invalid PAA cookie received from client <HOST>` (השורה מודפסת עם ה-IP האמיתי, process.go:87) — רשת f2b שורדת Plesk apply (הסקריפט מדלג על f2b-).
 - Imunify360: (1) OSSEC מנטר, בין השאר, /var/log/imunify360-webshield/*.log ולא לוגי nginx שלנו VERIFIED (רשימת <location>); (2) WebShield (mode=proxy) מאזין על 52223/52224/52233/52234, ומוסט אליו (DNAT ב-nat PREROUTING) רק תעבורה ממקורות שבערכות i360.ipv4.remote_proxy (0 רשומות) ו-remote_proxy_static (1526 רשומות; ranges של פרוקסי/CDN מוכרים) VERIFIED. עובד שה-egress שלו בתוך הטווחים האלה (ענן/CDN/VPN מוכר) יעבור דרך WebShield (nginx של Imunify, http2 on) ושם התנהגות WebSocket/חיבור ארוך לא ידועה => UNKNOWN; פתרון אם יקרה: whitelist ל-IP ב-Imunify. (3) DOS: default_limit 250 לכל IP ב-30 שניות — מנהרה בודדת קטנה מכך. (4) greylist/blacklist של IP מרמת INPUT_imunify360 משפיע על כל האתרים — כללי.
3.8 בדיקה בטוחה לפני reload: `sudo nginx -t` (גם ExecReload של nginx.service מריץ nginx -t ו-ExecStartPre מריץ -t) ; רק אז `sudo systemctl reload nginx` (graceful: חיבורים קיימים לא נקטעים). rollback: להעביר את הקובץ ל-rdpgw-proxy.conf.DISABLED (המוסכמה הקיימת: openclaw.kalfa.me.conf.DISABLED) ולטעון מחדש. חידוש תעודה: ה-wildcard מתחדש ע"י Plesk (הסימלינק ל-cert5.pem מעודכן 2026-09-01) ; האם nginx נטען מחדש אחרי חידוש — INFERRED שכן (Plesk פורס מחדש לדומיין ש"משתמש" בתעודה); אותה תלות קיימת כבר ב-beta-proxy.conf => בדיקת מעקב: ב-2026-11-02 וב-2026-11-20 `openssl s_client … | openssl x509 -noout -enddate` מבחוץ.

========== 4. הצעות xrdp/sesman ==========
4.1 מה הפעלה מחדש עושה ב-0.9.24 (מקור v0.9.24 + xorgxrdp v0.9.19 המותקן + systemctl; VERIFIED אלא אם צוין):
 - xrdp.service: Requires=xrdp-sesman ; xrdp-sesman.service: BindsTo=xrdp, StopWhenUnneeded (systemctl show) => `restart` של אחד מהם מפעיל מחדש את שניהם.
 - תהליכי ה-session (Xorg :10, xfce4-session, xrdp-chansrv, ה-xrdp-sesman הילד) יושבים ב-session-c7070.scope תחת user.slice (לא ב-cgroup של xrdp-sesman, שבו יש תהליך אחד) => systemd לא הורג אותם בעצירה/restart; `xrdp-sesman --kill` שולח SIGTERM רק לתהליך הראשי (sesman.c:633, ולולאת ה-main יוצאת בלי להרוג ילדים).
 - אבל רשימת ה-sessions של sesman היא `static struct session_chain *g_sessions` בזיכרון בלבד (session.c:50); `session_get_bydata` סורק רק אותה; אין קוד adoption. אחרי restart הרשימה ריקה => החיבור הבא של kalfa.me לא יתחבר ל-:10 אלא ייצור session חדש (:11, כי session_get_avail_display_from_chain מדלג על :10 בגלל הנעילה/socket של X) ; :10 ממשיך לרוץ כיתום שאי אפשר להגיע אליו דרך RDP. (ראיה נלווית: ביומן, 8 הפעלות "starting Xorg session" מאז 5.10 לעומת 10 "reconnected session".)
 - restart של xrdp בנוסף קוטע כל חיבור RDP חי (תהליכי הילד של xrdp ב-cgroup של השירות, KillMode=control-group), כולל חיבור הבעלים במסלול (a).
 => מסקנה: לעולם לא restart ל-xrdp או xrdp-sesman בפרויקט הזה.
 - מה כן בטוח: sesman.ini נטען מחדש ב-SIGHUP (sig.c: sig_sesman_reload_cfg) — `sudo systemctl kill --kill-who=main -s HUP xrdp-sesman` (אין ExecReload ביחידה, לכן `systemctl reload` לא עובד). xrdp.ini נקרא בכל חיבור חדש (xrdp_rdp_create -> xrdp_rdp_read_config; trans_set_tls_mode טוען cert/key בכל חיבור) => שינוי certificate/key_file/security_layer/ssl_protocols נכנס לתוקף בחיבור הבא בלי restart; רק `port`/listen/[Logging] דורשים restart (לא נוגעים). הצד השני של המטבע: טעות בקובץ שוברת מיד כל חיבור חדש (כולל הבעלים) — לכן גיבוי + rollback ב-cp בלבד.
 - הגבלות clipboard ב-sesman.ini חלות רק כש-chansrv מתחיל (chansrv.c קורא את sesman.ini באתחול) => לא ישפיעו על :10 הקיים. ובגלל ש-session אחד משותף — כל הגבלה בצד xrdp פוגעת גם בבעלים; הידית היחידה "רק עובדים" היא Caps של rdpgw, והיא נאכפת בצד הלקוח (לא גבול אבטחה).
 - מה שנוגע לעבודה משותפת (VERIFIED): xorgxrdp 0.9.19 מרשה לקוח אחד בלבד לכל session ("Only allow one client at a time … marking only clientCon for disconnect", ב-tag v0.9.19) => חיבור חדש (עובד) מנתק את החיבור החי של הבעלים, ולהפך (last wins). Policy=Default => session אחד לכל <משתמש, bpp> (הערת sesman.ini בקובץ) — לקוח עם עומק צבע שונה מה-session הקיים מקבל session נפרד על :11. 
4.2 טבלת שינויים מוצעים (כולם אופציונליים — שום שינוי xrdp אינו נדרש לפיצ'ר)
 | שינוי | שורות מדויקות | תועלת | השפעה על מסלול (a) / ה-session |
 | AllowRootLogin | sesman.ini [Security]: AllowRootLogin=false ; ואז HUP | חוסם כניסת root ב-RDP | אפס: הכניסה היא kalfa.me (uid 10003); אין restart |
 | בדיקת קבוצה | `sudo groupadd tsusers && sudo usermod -aG tsusers kalfa.me && id kalfa.me` ואז HUP (TerminalServerUsers=tsusers כבר מוגדר; הקבוצה לא קיימת היום VERIFIED, לכן הבדיקה כבויה) | רק חברי הקבוצה יכולים להיכנס | סיכון נעילה אם kalfa.me לא בקבוצה — לאמת `id` לפני ה-HUP; rollback: groupdel tsusers + HUP. תועלת קטנה (משתמש יחיד) — מומלץ לדחות |
 | תקרת sessions | MaxSessions=3 (כיום 50) ואז HUP | מגביל session "יתומים" שנוצרים מאי-התאמת bpp | אפס |
 | security_layer | xrdp.ini [Globals]: security_layer=tls (כיום negotiate => מאפשר RDP-Security בלי TLS) | מונע downgrade | כל 18 החיבורים האחרונים נבחרו [SSL] VERIFIED (iPad) => אפס למכשירי הבעלים; לקוחות ישנים מאוד נכשלים. נכנס מיד לחיבור הבא |
 | תעודה מהימנה | `tailscale cert` לשם nm-digitalhub.tail703115.ts.net (CertDomains קיים) ואז certificate=/key_file= | ללקוח אין אזהרת תעודה, ו-full address = אותו שם | ראו להלן |
 | clipboard/drive בצד xrdp | RestrictOutboundClipboard / [Channels] rdpdr=false | — | לא מומלץ: חל על כולם ולא על :10 הנוכחי |
 כללי: לשמור KillDisconnected=false, DisconnectedTimeLimit=0, IdleTimeLimit=0 (הם שמאפשרים session מתמשך) — לא לגעת.
 tailscale cert (אופציונלי; הרצה = פעולה כלפי חוץ): (א) השם יפורסם בלוגי Certificate Transparency (כולל שם ה-tailnet) — דורש אישור owner; (ב) תוקף 90 יום => דרוש timer חידוש (systemd timer שבועי שמריץ את אותה פקודה וכותב לקובץ זמני ואז mv — xrdp קורא לכל חיבור); (ג) הקבצים: `sudo install -d -m 0750 -o root -g ssl-cert /etc/xrdp/tls` ; cert 0644, key 0640 root:ssl-cert (xrdp בקבוצת ssl-cert VERIFIED); (ד) אימות מפתח/תעודה בלי להדפיס סוד: השוואת `openssl pkey -in KEY -pubout | sha256sum` מול `openssl x509 -in CRT -noout -pubkey | sha256sum`, ו-`sudo -u xrdp test -r` לשניהם, לפני עריכת xrdp.ini. (ה) חלופה בלי CT: להשאיר self-signed ולהגדיר ב-.rdp authentication level:i:0 — סביר כי היעד הוא אותו שרת (rdpgw על המכונה עצמה). המלצה: לדחות.
 גיבויים לפני כל שינוי (שמות לפי המוסכמה הקיימת xrdp_keyboard.ini.bak-hebrew-20261005): `sudo cp -a /etc/xrdp/xrdp.ini /etc/xrdp/xrdp.ini.bak-rdpgw-20261006` ; אותו דבר ל-sesman.ini ; `sudo iptables-save > ~/backup-rdpgw/iptables-save.txt` ; `sudo plesk ext firewall --export > ~/backup-rdpgw/plesk-fw.json` ; `sudo cp -a /etc/iptables/rules.v4 /etc/iptables/rules.v6 ~/backup-rdpgw/` ; `sudo cp -a /etc/nginx/conf.d ~/backup-rdpgw/nginx-conf.d`.

========== 5. הקשחת רשת: DROP ל-3389 ==========
5.1 מצב קיים (VERIFIED): xrdp מאזין רק על 100.106.199.107:3389 (ss) — לכן על ה-IP הציבורי הפורט "refused" גם בלי חומת אש. אין כלל על 3389. ב-INPUT: כלל 40 `-A INPUT -j ACCEPT` ללא תנאי = ה-catchall של Plesk (חוק id 67 action=allow) VERIFIED. סיכון שנותר (INFERRED): מודל weak-host של לינוקס — חבילה עם יעד 100.106.199.107:3389 שמגיעה ב-ens6 (ממישהו ב-L2 של הספק; מהאינטרנט היעד CGNAT לא ניתן לניתוב) תגיע ל-xrdp (ts-input חוסם רק מקורות 100.64/10, לא יעדים). לכן ה-DROP הוא הגנה לעומק.
5.2 מלכודות שנמצאו (אלה משנים את התכנון):
 (1) חיבור rdpgw -> xrdp עובר דרך `lo`, לא tailscale0: `ip route get 100.106.199.107` = `local … dev lo … src 100.106.199.107` VERIFIED, וכלל ts-input הראשון הוא `-s 100.106.199.107/32 -i lo -j ACCEPT`. DROP של "הכול חוץ מ-tailscale0" היה שובר את מסלול (b). חובה לפטור גם lo. ב-iptables אי אפשר שני `! -i` בכלל אחד => שרשרת ייעודית.
 (2) Plesk `--apply` הורס כללים ידניים: firewall-active.sh מוחק כל `-A INPUT` שאינו f2b (כולל `-j INPUT_imunify360` ו-`-j ts-input`!) ומוסיף רק את כללי Plesk — VERIFIED מקריאת הסקריפט. הוא לא נוגע בטבלת raw (רק filter INPUT/FORWARD/OUTPUT, וניקוי mangle ו-nat). מי מחזיר את הקפיצות ל-imunify/ts-input אחרי apply ובכמה זמן — UNKNOWN (נראה שהסוכנים מחזירים כי הן קיימות כעת).
 (3) כלל DROP שמוסיפים בסוף ה-INPUT מת: ראו כללים 41-43 (DROP 5432 אחרי ה-ACCEPT הכללי) VERIFIED.
5.3 אפשרויות (טרייד-אוף):
 R (מומלץ): טבלת raw, שרשרת KALFA_RDP_GUARD ב-PREROUTING. שורדת Plesk apply; נשמרת ב-/etc/iptables/rules.v4 (בלוק *raw קיים שם; netfilter-persistent פעיל ו-enabled VERIFIED; סקריפט ה-strip של imunify מסיר רק כללים שמפנים לסטים i360 חסרים — לא יפגע בנו VERIFIED). טיוטה (parse נבדק עם --test):
```
*raw
:KALFA_RDP_GUARD - [0:0]
-I PREROUTING 1 -p tcp -m tcp --dport 3389 -j KALFA_RDP_GUARD
-A KALFA_RDP_GUARD -i tailscale0 -j RETURN
-A KALFA_RDP_GUARD -i lo -j RETURN
-A KALFA_RDP_GUARD -j DROP
COMMIT
```
 החלה חיה: `sudo iptables-restore --noflush < kalfa-rdp-guard.rules` (אטומי) ; ב-IPv6 אותו דבר עם `ip6tables-restore` ושרשרת KALFA_RDP_GUARD6. התמדה: עריכה ידנית של בלוק *raw ב-/etc/iptables/rules.v4 (ו-rules.v6): להוסיף `:KALFA_RDP_GUARD - [0:0]` ו-4 השורות כשורת ה-`-A PREROUTING` הראשונה בבלוק, ולאמת `sudo iptables-restore --test --noflush < /etc/iptables/rules.v4` — לא להריץ `netfilter-persistent save` (ידמפ גם כללים דינמיים של docker/imunify/ts). אימות שורד-אתחול: UNKNOWN עד reboot הבא (mtime של rules.v4 = שעת האתחול 2026-10-04 07:41; מי כותב אותו — UNKNOWN).
 P (חלופה): שני כללי Plesk מותאמים: `plesk ext firewall --set-rule` (-name … -direction input -action deny -ports 3389/tcp) ואז (-action allow -ports 3389/tcp -from 100.64.0.0/10). הסדר: כללי custom מסודרים מהמזהה הגבוה לנמוך (176,148,121,95,70 בפלט ה-JSON תואם לסדר בסקריפט) => ליצור קודם deny ואז allow כדי שה-allow יהיה ראשון. התמדה ע"י Plesk DB. החיסרון: כל apply מוחק את קפיצות imunify/ts-input עד שהסוכנים מחזירים; חובה לאמת אחרי `--apply`+`--confirm` ש-`iptables -S INPUT | head -3` מכיל חזרה `INPUT_imunify360` ו-`ts-input` (ו-`-auto-confirm-…` אסור). rp_filter=1 על כל הממשקים VERIFIED מגן מזיוף מקור 100.x.
 F (נדחה): שרשרת filter/INPUT ידנית — נמחקת ע"י כל Plesk apply.
5.4 אימות חיצוני ש-3389 לא נגיש (בלי להריץ דבר בשרת): ממחשב מחוץ ל-tailnet ומחוץ לרשת השרת: `nc -vz -w5 217.154.17.185 3389 ; nc -vz -w5 217.154.17.205 3389` ; או `nmap -Pn -p 3389 217.154.17.185 217.154.17.205` ; או סורק פורטים מקוון / חיפוש Shodan/Censys `ip:217.154.17.185 port:3389`. צפי: לפני הכלל "refused"/closed (RST) ; אחרי הכלל "filtered"/timeout (ה-DROP גם על IP ציבורי). (nmap אינו מותקן בשרת VERIFIED; לא נדרש.) אימות שהנתיב הלגיטימי חי אחרי הכלל: חיבור הבעלים דרך Tailscale ו-חיבור דרך rdpgw (בדיקות 17-18).
5.5 ממצא נפרד (לא מציע לשכתב את חומת האש): Plesk Firewall catchall input = allow (id 67) => ה-INPUT "DROP" הוא למעשה allow-all, וכל listener על 0.0.0.0 חשוף ברמת המארח: למשל 11211 (memcached), 2049/111 (NFS/rpcbind), 6333 (qdrant), 4820, 8080, 8081, 18018, 18789, 5540, 22000/8384 (Syncthing) VERIFIED (ss). האם חומת האש של ספק האירוח (IONOS) חוסמת — UNKNOWN; לאמת מבחוץ. כללי DROP 5432 (41-43) מתים, ו-postgres ממילא על [::1] בלבד. בנוסף: iptables-legacy-restore.service נכשל באתחול האחרון (status=2) VERIFIED ויש שני backends (nft מלא; legacy ריק חוץ מ-raw) — לא נוגעים.
5.6 אופציונלי, כבוי כברירת מחדל: allow-list פר-grant למקורות Tailscale על 3389 (רלוונטי רק אם עובדים יצורפו ל-tailnet). הכלי הנכון הוא Tailscale ACL (מדיניות ה-tailnet; מצבה כרגע UNKNOWN — tailnet עם משתמש יחיד) ולא iptables. אם בכל זאת: ipset `kalfa-rdp-allow` (hash:ip timeout) ; בשרשרת KALFA_RDP_GUARD לפני ה-DROP: `-i tailscale0 -m set ! --match-set kalfa-rdp-allow src -j DROP` ; סקריפט root (systemd timer/הפעלה מהאפליקציה) שלכל grant פעיל מוצא את ה-IP של ה-node דרך `tailscale whois --json <ip>` ומאמת שה-LoginName/Node שייך ל-grantee לפני `ipset add … timeout <ttl>`; ביטול = `ipset del`. הבעלים: להוסיף את מכשיריו קבוע. מצריך שינוי ה-RETURN של tailscale0 (כנ"ל) — לא ממומש כעת.

========== 6. מנגנון ביטול (revoke) ==========
מה נחתך: רק מנהרת ה-gateway. מה לא נחתך: ה-session של xrdp (Xorg :10 ו-xfce4-session וכל התהליכים).
סדר פעולות באפליקציה: (1) DB: grant=revoked/expired — מהרגע הזה כל בדיקת CheckPAACookie מחזירה allow:false (מנהרות חדשות נחסמות); (2) `POST http://127.0.0.1:3014/admin/v1/disconnect {"user":"<id>"}` עם Bearer ADMINTOKEN => Tunnel.Close() לכל מנהרה של המשתמש (גם כאלו שבדיקת ה-grant שלהן באמצע — SetOwner קדם לבדיקה, וה-IsClosed אחריה); (3) רשת ביטחון: expiresAt שהוחזר בבדיקה קובע טיימר סגירה בתוך rdpgw עצמו; (4) retry/התראה באפליקציה אם שלב 2 נכשל; (5) בדיקה תקופתית (pg-boss קיים ב-kalfa-worker) של GET /admin/v1/tunnels מול ה-grants הפעילים: מנהרה בלי grant => disconnect (חגורה שנייה).
טווח הזמן: סגירה מיידית (מילישניות); מנהרה שנוצרה לפני הביטול ללא נתיב ביטול — מקסימום עד expiresAt.
אימות שהמנהרה נעלמה: `ss -tn dst 100.106.199.107:3389 | tail -n +2 | wc -l` => 0 (שני קצוות המקומי) ; `curl -s -H "Authorization: Bearer <ADMINTOKEN מהקובץ, לא להדפיס>" http://127.0.0.1:3014/admin/v1/tunnels` ללא המשתמש ; `journalctl -u rdpgw --since -2min | grep -E 'admin disconnect|Error reading from local conn'` ; בצד xrdp: /var/log/xrdp.log "xrdp_process_data_in"/"SSL_shutdown" (דפוס דומה מופיע כבר ביומן בניתוקים רגילים) ; `pgrep -a Xorg | grep ':10'` עדיין קיים (ה-session חי).
מה נשאר בדסקטופ המשותף ומה הבעלים צריך לדעת: (א) כל מה שהעובד הפעיל נשאר רץ — טרמינלים (שורש-שווה: NOPASSWD sudo + docker), תוכניות פתוחות, הדפדפן/Chrome המחובר, vim, וגם נתוני ה-clipboard של chansrv (משותף); (ב) ה-session נשאר במצב מנותק ללא לקוח (KillDisconnected=false) עד שמישהו מתחבר; (ג) מי שיתחבר הבא (הבעלים) יראה את הכול בדיוק כפי שהושאר; (ד) אין זיהוי משתמש ב-xrdp: כל חיבורי מסלול (b) מופיעים ב-xrdp/sesman מ-100.106.199.107 (המקור הוא ה-IP של המארח עצמו) ולכן ייחוס אישי נעשה רק ב-rdpgw/KALFA (ה-"Connected client computer name" ב-xrdp.log הוא שם עצמי של הלקוח). (ו) אופציה (שאלה): נעילת מסך ב-:10 בכל ביטול — לא נבדק אם מותקן locker (UNKNOWN).

========== 7. ניטור ולוגים ==========
- rdpgw: journald (`journalctl -u rdpgw`). אין token/סוד בלוגים: עברתי על כל log.Printf/Fatalf שמזכירים token/cookie/key/secret — אף אחד לא מדפיס ערך (ההודעות מדפיסות שגיאות/שמות מפתחות בלבד) VERIFIED. שורות להתראה: חיבור: "Establishing connection to RDP server: <host>" + "Connection established" (process.go:141,150) ; דחייה: "Invalid PAA cookie received from client <ip>" (process.go:87), "grant check denied user …", "grant check failed for user … (denying): …" (KALFA לא זמין/איטי/שגוי) ; ביטול: "admin disconnect: user=… closed=N" ; rejects: "header auth: rejecting request …" ; "rejecting reuse of Rdg-Connection-Id".
- nginx: /var/log/rdpgw/nginx-access.log (פורמט rdgw: ללא query/token) ו-nginx-error.log ("limiting requests"); התראה על 429/5xx ועל זינוק בבקשות ל-/remoteDesktopGateway/ מ-IP יחיד.
- xrdp: /var/log/xrdp.log ו-/var/log/xrdp-sesman.log + journald (EnableSyslog=true): "login successful for user kalfa.me on display 10", "reconnected session … display :10.0" (בכל חיבור — IP יהיה 100.106.199.107 במסלול (b)), כשלי PAM `pam_unix(xrdp-sesman:auth)`. התראה: "starting Xorg session" (נוצר session חדש => התקלה של Policy/bpp או restart) — זה האות החשוב ביותר.
- KALFA: כל בדיקת grant היא כבר אירוע באפליקציה (ה-endpoint עצמו כותב audit: allow/deny + tunnelId + user + clientIp). סיום מנהרה/משך: polling של GET /admin/v1/tunnels (למשל כל 60 שניות מ-kalfa-worker) והשוואה לקבוצה הקודמת => אירועי disconnect עם משך. (אין callback מ-rdpgw לאפליקציה; אם יידרש — תוספת patch קטנה.)
- כללי: לא ללוגג PAA token, ADMINTOKEN, GRANTCHECKTOKEN, HEADER__SECRET, גוף /connect, או את קובץ ה-.rdp.

========== 8. סדר פריסה, שערי אישור, חלון, kill switch, rollback ==========
הערה: כל צעד "נוגע במסלול (a)" מסומן [A]. אין להפעיל restart ל-xrdp/sesman בשום צעד.
S0 גיבויים (סעיף 4) — קריאה/העתקה בלבד. שער: אין.
S1 קוד: להוסיף ops/rdpgw/ לריפו (patches, go.sum, build.sh, תבניות) — שער: אישור התוכנית + Review של ה-patches; commit רק בבקשה. rollback: git.
S2 בנייה: `cd ops/rdpgw && ./build.sh` (רשת: הורדת מודולים; מטמון Go הרגיל) — שער: כן. השוואת sha256 לצפוי. rollback: מחיקת ops/rdpgw/build.
S3 הכנה: useradd rdpgw; /opt/rdpgw/releases/<sha12>/rdpgw + symlink; /etc/rdpgw/{rdpgw.yaml,default.rdp,secrets.env}; /etc/systemd/system/rdpgw.service; daemon-reload. לא מפעילים. שער: כן. rollback: `systemctl disable rdpgw; rm` + `userdel rdpgw`.
S4 DNS: הוספת A ל-gw (סעיף 3.2), עדיף 3+ שעות לפני החלון (SOA minimum). שער: כן. rollback: dns --del.
S5 nginx: /var/log/rdpgw + logrotate + rdpgw-proxy.conf (+ ה-deny location ב-beta-proxy.conf); `sudo nginx -t` && `sudo systemctl reload nginx`. שער: כן; סיכון: שינוי ב-vhost הפרודקשן של beta (שגיאת תחביר נתפסת ב-nginx -t; reload graceful). rollback: הסרת הקובץ/השורה ו-reload. אחרי S5 ללא rdpgw — gw.kalfa.me מחזיר 404 ל-/ ו-502 ל-/remoteDesktopGateway/.
S6 הפעלת rdpgw: `sudo systemctl enable --now rdpgw` ; בדיקות 1-12 (סעיף 9). שער: כן. rollback: `systemctl disable --now rdpgw`.
S7 האפליקציה (plan-app, פריסה ע"י ה-owner): endpoint ה-grant, קריאת /connect, ביטול. שים לב: kalfa-beta מופעל מחדש בכל פריסה (↺ 13 ב-3 שעות VERIFIED) => בזמן restart בדיקות grant למנהרות חדשות נכשלות סגור (עובד מקבל "access denied" ומנסה שוב); מנהרות קיימות ממשיכות. לא לפרוס אפליקציה בזמן שעובד מחובר.
S8 בדיקת קצה-לקצה בחלון [A]: חיבור דרך gw מנתק את חיבור הבעלים החי (last wins) — הבעלים מנותק מ-RDP בזמן הבדיקה (חיבור הבעלים אחרי הבדיקה מתחבר ל-:10). שער: כן.
S9 אופציונלי [A]: (א) כלל ה-raw (סעיף 5) — סיכון: טעות ב-rules => חסימת הבעלים; מבצעים כשהבעלים מחובר ב-SSH/פלאש ושומרים `iptables-save` ל-rollback; החלה חיה ואז אימות 17-18 ; rollback מיידי: `sudo iptables -t raw -D PREROUTING -p tcp --dport 3389 -j KALFA_RDP_GUARD && sudo iptables -t raw -F KALFA_RDP_GUARD && sudo iptables -t raw -X KALFA_RDP_GUARD`. (ב) sesman.ini HUP. (ג) xrdp.ini security_layer=tls [A: חיבורי הבעלים הבאים]. (ד) tailscale cert. כל אחד בנפרד.
S10 ניטור: logrotate, (אופציונלי) fail2ban jail, probe ל-ops-agent.
חלון תחזוקה מומלץ: 45-60 דקות, בשעת שהבעלים לא משתמש ב-RDP, בלי פריסה בזמן אמת; DNS מראש. בגלל last-wins: הבעלים מתאם עם העובד.
Kill switch (הכי מהיר לנטרל מסלול b לגמרי), מהמהיר לעמוק:
 1. `sudo systemctl stop rdpgw` — ~1 שנייה, קוטע את כל המנהרות, ו-nginx מחזיר 502; Restart=on-failure לא מפעיל מחדש stop מפורש. ה-session ומסלול (a) לא נפגעים.
 2. קבוע: `sudo systemctl disable --now rdpgw && sudo systemctl mask rdpgw`.
 3. סגירת השער בחזית: `sudo mv /etc/nginx/conf.d/rdpgw-proxy.conf{,.DISABLED} && sudo nginx -t && sudo systemctl reload nginx`.
 4. בצד האפליקציה: flag שמפסיק הנפקת .rdp ובדיקות grant שמחזירות deny (בלי rdpgw חי — מיותר אך מומלץ).
 (הסרת רשומת DNS אינה kill switch: cache שלילי/חיובי עד 3 שעות.)
rollback מלא (בסדר הפוך): kill switch -> הסרת rdpgw-proxy.conf ושורת ה-deny ב-beta-proxy.conf + reload -> dns --del -> הסרת יחידה/משתמש/קבצים -> החזרת גיבויי xrdp/iptables אם שונו.
צעדים שנוגעים במסלול (a) [A]: S8 (last-wins), S9(א) חסימת פורט, S9(ב) HUP ל-sesman, S9(ג) security_layer, S9(ד) תעודה; ובנוסף כל Plesk firewall apply (אם יבוצע) מוחק זמנית קפיצות ts-input/imunify.

========== 9. בדיקות קבלה (פקודה => תוצאה צפויה) ==========
מקומי, קריאה בלבד (אחרי S6):
 1. `ss -tlnp | grep -E ':(3013|3014)\b'` => שני listeners ב-127.0.0.1 בלבד, שייכים ל-rdpgw; אין 0.0.0.0.
 2. `systemctl show rdpgw -p User -p ActiveState -p NRestarts` => User=rdpgw ActiveState=active NRestarts=0 ; `systemd-analyze security rdpgw | tail -1` => exposure < 3.
 3. `sudo -u nobody test -r /etc/rdpgw/secrets.env; echo $?` => 1 (לא קריא).
 4. `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3014/admin/v1/tunnels` => 403 (בלי Bearer).
 5. `curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Kalfa-Staff-Id: x' http://127.0.0.1:3013/connect` => 401 (חסר הסוד המשותף; patch 0002).
 6. `sudo -u rdpgw getent hosts nm-digitalhub.tail703115.ts.net` => 100.106.199.107 (אימות DNS מתוך ה-sandbox; אם נכשל — להוסיף 100.100.100.100/32 ל-IPAddressAllow).
מבחוץ (מחוץ ל-tailnet):
 7. `for p in /connect /metrics /tokeninfo /api/v1/user / /static/app.js; do curl -sS -o /dev/null -w "$p %{http_code}\n" https://gw.kalfa.me$p; done` => 404 לכולם.
 8. `curl -sS -o /dev/null -w '%{http_code}\n' https://gw.kalfa.me/remoteDesktopGateway/` => 200 גוף ריק (GET אינו RDG_IN/OUT ולכן gateway.go:86-111 נופל החוצה; INFERRED מהקוד).
 9. `echo | openssl s_client -connect gw.kalfa.me:443 -servername gw.kalfa.me -alpn h2,http/1.1 2>/dev/null | grep -E 'ALPN|Verify return|subject=|notAfter'` => `ALPN protocol: http/1.1` (אם h2 — `http2 off` לא נאכף ב-ALPN: לדווח), Verify return code: 0, CN kalfa.me, notAfter 2026-11-30 (עד חידוש).
 10. `openssl s_client -tls1_2 -cipher ECDHE-RSA-AES256-GCM-SHA384 -connect gw.kalfa.me:443 </dev/null` => handshake מצליח ; עם `-cipher AES256-SHA` => נכשל.
 11. `for i in $(seq 40); do curl -s -o /dev/null -w '%{http_code} ' https://gw.kalfa.me/remoteDesktopGateway/; done` => מופיע 429 לאחר ה-burst.
 12. `dig +short gw.kalfa.me @ns1.kalfa.me` => 217.154.17.185 ; `nc -vz -w5 217.154.17.185 3389` => refused (לפני כלל ה-raw) / timeout (אחריו).
קצה-לקצה (עם האפליקציה):
 13. grant פעיל + mstsc דרך gw => ב-journal של rdpgw "Establishing connection to RDP server: nm-digitalhub.tail703115.ts.net:3389"; ב-/var/log/xrdp-sesman.log "reconnected session … display :10.0" (ולא "starting Xorg session"); `sudo ss -tn state established '( dport = :3389 )'` מראה חיבור מקור=יעד 100.106.199.107 ; `pgrep -a Xorg` — רק :10.
 14. ביטול: `ss -tn dst 100.106.199.107:3389 | wc -l` => 1 (כותרת בלבד) תוך ~2 שניות; `pgrep -a Xorg | grep ':10'` עדיין חי.
 15. אחרי ביטול, ניסיון חיבור חדש עם אותו .rdp => לקוח: access denied ; journal: "grant check denied user …".
 16. KALFA לא זמין (בחלון בלבד, למשל restart של kalfa-beta): מנהרה חדשה נדחית, journal: "grant check failed … (denying)" ; מנהרה קיימת ממשיכה.
 17. מסלול (a) ללא שינוי: חיבור הבעלים דרך Tailscale מ-100.x.x.x מתחבר ל-:10; `sudo ss -tn state established '( dport = :3389 )'` מראה מקור tailnet של הבעלים.
 18. אחרי כלל ה-raw: `sudo iptables -t raw -S | grep KALFA` (4 שורות), מונה בשרשרת `sudo iptables -t raw -L KALFA_RDP_GUARD -n -v` ; חזור על 13 ו-17 — **גם rdpgw->xrdp (דרך lo) וגם Tailscale חייבים לעבוד**; 12 מבחוץ => timeout.
 19. kill switch: `sudo systemctl stop rdpgw; curl -s -o /dev/null -w '%{http_code}\n' https://gw.kalfa.me/remoteDesktopGateway/` => 502 ; `sudo systemctl start rdpgw` מחזיר 200.
 20. יום 2026-11-02 ו-2026-11-20: בדיקה 9 מבחוץ => notAfter חדש (חידוש wildcard נקלט ב-nginx).

========== 10. סיכונים, אלמוני ושאלות ל-owner (המלצה שלי בסוגריים) ==========
סיכונים:
 R1 last-wins ו-session משותף: חיבור עובד מנתק את הבעלים (VERIFIED בקוד xorgxrdp 0.9.19) ; כל מה שהעובד עושה הוא שורש-שווה ונשאר אחרי הניתוק.
 R2 Policy=Default (<user,bpp>): לקוח עם עומק צבע אחר יוצר session נפרד :11; rdpgw לא יכול לנעול bpp. מקטין: MaxSessions=3 + התראה על "starting Xorg session".
 R3 restart של xrdp/sesman מאבד את :10 לשימוש (סעיף 4.1) — לא לבצע.
 R4 לופבק אינו גבול אמון (nginx, תהליכים מקומיים) — מטופל: allow-list ב-nginx, ניקוי headers, סוד משותף (0002), בדיקת grant, deny של נתיב ה-grant ב-beta-proxy.
 R5 ביטול תלוי באפליקציה; hard-expiry בתוך rdpgw מגבה; kill switch ידני.
 R6 legacy HTTP transport מת ב-header-only (VERIFIED) — לקוח בלי WebSocket לא יעבוד.
 R7 Plesk apply מוחק כללי INPUT ידניים וקפיצות imunify/ts-input (VERIFIED) — לכן raw.
 R8 תעודת ה-wildcard: חידוש + reload (INFERRED); 2026-11-30.
 R9 Imunify WebShield redirect ללקוחות מ-ranges מוכרים (UNKNOWN התנהגות).
 R10 הסיסמה המשותפת של kalfa.me היא הגורם השני היחיד אחרי ה-gateway; ל-xrdp אין rate-limit/jail (אין jail ל-xrdp ב-fail2ban VERIFIED) והמקור תמיד 100.106.199.107 — אין להסתמך על זיהוי IP ב-xrdp. (שאלה לתוכנית האפליקציה: איך העובד מקבל את הסיסמה/האם ללוגין אוטומטי.)
 R11 ממצאי חומת אש נפרדים (סעיף 5.5): catchall allow ופורטים חשופים על 0.0.0.0 — לא נוגעים, מדווחים.
 R12 ה-patch הוא fork מקומי של 700+ שורות: צריך סקירה, ושדרוג upstream הוא ידני (בנייה דטרמיניסטית עם PINNED_COMMIT).
אלמוני (UNKNOWN): תזמון החזרת קפיצות imunify/ts-input אחרי Plesk apply; מי כותב את rules.v4; מצב ה-ACL של ה-tailnet; ALPN/h2 בפועל (בדיקה 9); התנהגות WebShield ל-WebSocket; האם mstsc/לקוחות נוספים עובדים מול WebSocket בלבד (rdp-client-compat); קיום locker ב-:10.
שאלות כן/לא:
 Q1 systemd עם משתמש ייעודי במקום pm2? (כן)
 Q2 לאשר את patch 0002 (סוד משותף על /connect)? (כן)
 Q3 לאשר הורדת מודולי Go מהרשת לבנייה, ולמחוק את רשומות המטמון שנוצרו בטעות (סעיף 0א)? (כן לשתיים)
 Q4 לאשר conf.d ידני (rdpgw-proxy.conf) ושינוי beta-proxy.conf (deny לנתיב ה-grant)? (כן)
 Q5 לאשר כלל raw ל-3389 (+ עדכון rules.v4) בחלון תחזוקה? (כן, בסוף, אחרי שמסלול b עובד)
 Q6 לבצע tailscale cert (חשיפת השם ב-CT + timer חידוש)? (לא כעת; להשתמש ב-authentication level:i:0)
 Q7 AllowRootLogin=false ו-MaxSessions=3 (HUP, ללא restart)? (כן). קבוצת tsusers? (לא כעת)
 Q8 להשבית clipboard/drive/printer/pnp/port במסלול (b) כברירת מחדל? (כן, ניתן להפעלה לפי בקשה)
 Q9 לקבל ש-last-wins מנתק את הבעלים בכל חיבור עובד, ולתאם? (כן; אפשר להוסיף חסימה באפליקציה כשהבעלים מחובר — החלטת plan-app)
 Q10 gw.kalfa.me כשם המארח, ו-IdleTimeout 30 דקות? (כן)
 Q11 לוגי nginx של השער ל-30 ימים עם logrotate ייעודי? (כן)
 Q12 jail ב-fail2ban על "Invalid PAA cookie" (backend=systemd)? (לא כעת; אחרי שיש נתוני בסיס)
 Q13 נעילת מסך ב-:10 בכל ביטול? (לבדוק קיום locker; כן אם קיים)
