# חומר מחקר: תהליך אישור גישה ל-xrdp (2026-10-06)

מסמך מלווה ל-`docs/remote-desktop-access-approval-plan-2026-10-06.md`. כל הבדיקות בקריאה בלבד. מקרא: **[אומת]** · **[מסקנה]** · **[לא נבדק]**.

## א. מפת התשתית הקיימת בשרת (נאספה על ידי הסוכן הראשי)

| נושא | ממצא | סטטוס |
|---|---|---|
| xrdp | גרסה 0.9.24. `port=tcp://100.106.199.107:3389`, sesman על `127.0.0.1/::1:3350`, `security_layer=negotiate`, TLS 1.2/1.3, תעודה עצמית ברירת מחדל `CN=ubuntu` עד 2035 | אומת |
| NLA | ב-xrdp.log: ה-iPad ביקש `SSL|HYBRID|HYBRID_EX|RDP` ו-xrdp בחר `SSL`, וההתחברות הצליחה | אומת, נתיב ישיר בלבד |
| sesman | `AllowRootLogin=true`, `AlwaysGroupCheck=false` (הקבוצה `tsusers` לא קיימת), `KillDisconnected=false`, `DisconnectedTimeLimit=0`, `IdleTimeLimit=0`, `MaxSessions=50`, clipboard וכוננים פתוחים | אומת |
| הזדהות OS | PAM `xrdp-sesman` → `common-auth` (pam_unix, pam_plesk, pam_imunify). xrdp 0.9.24 מעביר ל-PAM רק `PAM_TTY` ולא `PAM_RHOST` (קוד upstream של התג v0.9.24) | אומת |
| חשבונות | כניסת RDP: `kalfa.me` (uid 10003; sudo ללא סיסמה + קבוצת docker = שקול ל-root). ל-root יש סיסמה פעילה. נוספים: nmdigitalhub, newuser, newuser1, hivemind | אומת |
| Tailscale | גרסה 1.102.5, tailnet עם משתמש אחד (זהות GitHub). הצומת מפרסם 0.0.0.0/0 (אישור בקונסולה לא נבדק). יכולות https, funnel. אין serve/funnel פעילים. אין Windows ברשימת המכשירים. `tailscale whois` ממפה כתובת למכשיר ומשתמש | אומת |
| ACL של Tailscale | בקונסולת הניהול ולא נקראת מהשרת | לא נבדק |
| חומת אש | iptables-nft. מדיניות INPUT DROP אבל כלל 40 `ACCEPT` כללי (135K מנות). אין כלל ל-3389. `ts-input` מקבל `tailscale0` וחוסם מקורות 100.64/10 מממשקים אחרים. אין jail ל-xrdp ב-fail2ban. `rp_filter=1` | אומת |
| WireGuard | `wg0` (10.8.0.1/24, UDP 51820), לא בשימוש xrdp | אומת |
| nginx | 1.30.5, בלי מודול stream, עם http_v2 ו-http_v3. מאזין על שתי כתובות ציבוריות, wg0, כתובות Tailscale (IPv4 ו-IPv6). `beta.kalfa.me` → `127.0.0.1:3002`; `cto.kalfa.me` → `:3001`; השאר דרך Apache של Plesk (`7081`). אין `auth_basic` | אומת |
| TLS | Let's Encrypt, wildcard `*.kalfa.me` (עד 2026-11-30), `*.beta.kalfa.me`, `*.agents.kalfa.me` | אומת |
| DNS | ל-`rdp.kalfa.me` ול-`gw.kalfa.me` אין רשומה. `named` מקומי; הזון `kalfa.me` מקומי | אומת |
| Plesk | Obsidian 18.0.81.2; הרחבות: letsencrypt, firewall, sslit, sectigo | אומת |
| משאבים | 8 ליבות, 16GB (כ-8.4GB זמינים), 139GB פנויים. Docker 29.8.2, Go 1.26.2, Redis ו-Postgres מקומיים | אומת |
| sshd | פורטים 22 ו-2222, PasswordAuthentication ו-PermitRootLogin מופעלים | אומת |
| תהליכים (pm2) | kalfa-beta (:3002), kalfa-worker, kalfa-ops-agent (:3012), kalfa-fleet, kalfa-owner-agent, kalfa-pgboss-ui (:3011), kalfa-filebrowser | אומת |
| מקומות חופשיים בלופבק | 3000, 3002, 3011, 3012, 3030 תפוסים. 3013 ו-3014 פנויים | אומת |

**ממצא צדדי (לא חלק מהפיצ'ר):** ה-catch-all של Plesk הופך את INPUT ל-allow-all, וכמה שירותים מאזינים על `0.0.0.0` (memcached 11211, rpcbind/NFS 111/2049, qdrant 6333, ופורטי docker מפורסמים). לא נבדק מבחוץ, ולא ידוע אם חומת אש של הספק חוסמת.

## ב. הערכת rdpgw מול הקוד והתיעוד

*(דוח סוכן ההערכה, כמות שהוגש. אימתתי בעצמי בקוד שלושה ממצאים: טוקן של 5 דקות קשיח, בדיקה רק ביצירת מנהרה, ו-`Disconnect` שהוא קוד מת.)*

דוח הערכה: rdpgw (github.com/bolkedebruin/rdpgw), קריאה בלבד. נבדק מול master @16cdaaf4 (2026-08-18) ומול התג v2.2.0. נתיבים יחסיים לשורש הריפו. תגיות: [V]=VERIFIED, [I]=INFERRED, [U]=UNKNOWN. לא הותקן/הורץ/נבנה דבר; שיבוט שטחי בלבד ב-scratchpad; קריאות gh api מסוג GET בלבד.

== פסק דין ==
rdpgw מתאים כרכיב המנהרה לנתיב (b), אבל לא מכסה: זרימת בקשה/אישור, CLI, חנות grants, בדיקת grant בכל חיבור חדש, וניתוק מנהרה חיה. מה שקיים: טוקן PAA חתום עם TTL קשיח של 5 דקות שנבדק רק ביצירת מנהרה. כדי לעמוד בדרישה "קובץ שהורד לא פותח חיבור חדש אחרי ביטול" צריך fork קטן (עשרות שורות Go) או לקבל את 5 הדקות כתקרה ולוותר על ביטול באמצע.

== 1. מהו, רישיון, תחזוקה, פריסה ==
- מימוש Go של פרוטוקול MS-TSGU (RD Gateway) מעל HTTPS/WebSocket [V: README.md:12-15, :17-19]. רישיון Apache-2.0 [V: LICENSE; gh api license=Apache-2.0].
- תג אחרון v2.2.0, פורסם 2025-09-18 [V: releases/latest]. קיים גם תג v9.0.1, אבל הוא מ-2022-10-06 (תג תועה) [V]. 0 נכסי release (אין בינאריים) [V].
- master: קומיט אחרון 2026-08-18 (bump של grpc), 31 קומיטים לפני v2.2.0 [V: compare]. הקשחת האבטחה (בעלות על מנהרה, XFF רק מפרוקסי מהימן, סירוב לסודות דוגמה, הגבלת any, BindAddress) נמצאת רק ב-master ולא בגרסה שפורסמה [V: CHANGELOG.md:8-47; בדיקת v2.2.0 דרך contents: אין BindAddress/TrustedProxies/AllowedDestinationPorts, ו-PAA עדיין נושא AccessToken].
- איתותי בריאות: 1127 כוכבים; 66 פתוחים לפי GitHub, מהם 56 issues [V] (השאר PRs [I]). הרבה שאלות בלי מענה מאז 2022-2024; #204/#205 מ-09/2026 ללא תגובה; PR #199 (TTL ניתן להגדרה) נסגר ע"י מחברו ללא merge ב-2026-09-19, סיבה לא מתועדת [V/U].
- פריסה: `make` בונה `rdpgw` ו-`rdpgw-auth` (Makefile); go.mod:3 דורש Go 1.25.0 (README:264 אומר 1.19, מיושן) [V]. rdpgw-auth דורש cgo/PAM ורלוונטי רק ל-local/NTLM. Docker image ב-Docker Hub נבנה בכל push ל-master ובכל תג (.github/workflows/docker-image.yml), אבל dev/docker/Dockerfile עושה `git clone` של HEAD ולא של התג [V], לכן תמונת תג אינה ניתנת לשחזור [I]. אין systemd unit ל-rdpgw בריפו (יש דוגמה רק ל-rdpgw-auth: docs/pam-authentication.md:173-187) [V].

== 2. אימות ==
(i) פורטל /connect: רק openid (OIDC) או header. הנתיב /connect נרשם אך ורק בשני המצבים (cmd/rdpgw/main.go:236, :271) [V]. header = פרוקסי מהימן מחתים כותרת משתמש; חובה Header.TrustedProxies אחרת fatal (main.go:259-261; web/header.go:75-133) [V]. OIDC מפיק שם משתמש מ-preferred_username/unique_name/upn/username (web/oidc.go:148-158) [V].
(ii) המנהרה עצמה (/remoteDesktopGateway/): או עוגיית PAA (TokenAuth, ברירת מחדל true: config/configuration.go:228), או אימות HTTP: Basic מול PAM דרך gRPC ל-rdpgw-auth (web/basic.go; proto/auth.proto:28-31), NTLM (משתמשים וסיסמאות גלויות בקובץ rdpgw-auth: docs/ntlm-authentication.md), Kerberos/SPNEGO (main.go:315-330) [V]. ב-openid-בלבד או header-בלבד נקודת הקצה של השער נרשמת ללא אימות HTTP, והשער היחיד הוא עוגיית PAA (main.go:251-254, :285-288) [V]. אי אפשר לשלב openid עם local/kerberos (README.md:79-80) [V].
- אין מצב "פתוח": אבל header-בלבד עם TokenAuth:false לא נדחה בקונפיג (config/configuration.go:307-309 בודק רק openid) ואז CheckPAACookie=nil ודילוג על הבדיקה (protocol/process.go:89) [V]; עם HostSelection:any זה ממסר פתוח [I]. להשאיר TokenAuth:true.
- קישור זהות למנהרה: ה-sub של ה-JWT מוצמד למשתמש (security/jwt.go:107-109) [V]. בקשות השער מגיעות בלי עוגיית סשן, לכן זהות הבקשה אנונימית והקישור הוא רק דרך הטוקן [I: context.go:53-98].
- authorizer חיצוני/פלאגין: אין. grep על webhook/exec.Command/plugin/http.Post בקוד: ריק [V]. רק שדות פונקציה ב-Go (protocol/gateway.go:33-39): CheckPAACookie, CheckClientName, CheckHost. CheckClientName אינו מחובר ב-main.go [V]. שירות ה-gRPC מבצע רק user/pass ו-NTLM.

== 3. זרימת connect ==
- GET /connect[?host=...&<פרמטרי RDP>] -> HandleDownload (web/web.go:509-635). פרמטרי RDP רק אם הותרו ב-client.rdpoverridablekeys (README.md:309-346). תשובה: Content-Type application/x-rdp + attachment עם שם hex אקראי (web.go:576-579) [V].
- תוכן הקובץ: תבנית + gatewayhostname, full address, gatewaycredentialssource:i:5 (cookie), gatewayprofileusagemethod:i:1, gatewayusagemethod:i:1, gatewayaccesstoken:s:<JWT>, ו-username אלא אם NoUsername (web.go:603-614; rdp/rdp.go:27, :37-45) [V].
- מצבי בחירת host (web.go:456-507): roundrobin (בפועל אקראי, web.go:450-454; README:169), unsigned (host בשאילתה חייב להיות ברשימה), signed (host = JWT HS256 עם QueryTokenSigningKey), any (host מהשאילתה, מוגבל ל-AllowedDestinationPorts ברירת מחדל 3389 וללא loopback/RFC1918/link-local אלא אם AllowPrivateDestinations; ב-master בלבד: web.go:141-193, CHANGELOG:33-37). מצב signed אינו נתמך בשלב המנהרה: security/basic.go:20-22 מחזיר שגיאה, והבדיקה basic_test.go:35-40 קובעת "signed host selection isnt supported at the moment" [V]. כלומר signed + PAA לא עובד.
- חתימת קובץ: אם מוגדרים Client.SigningCert/SigningKey (PEM, מפתח RSA לא מוצפן) הקובץ נחתם עם rdpsign (web.go:216-223, :616-634; README:236-242) [V]. התנהגות לקוחות שאינם mstsc מול קובץ חתום: [U].
- הטוקן: JWT חתום HS256 עם PAATokenSigningKey; claims: iss=rdpgw, aud=rdpgw-paa, sub=משתמש, exp=עכשיו+5 דקות, remoteServer, clientIp (security/jwt.go:114-143, :124-135). אין jti/nbf/iat [V]. PAATokenEncryptionKey כבר לא בשימוש לטוקן PAA (grep: מוקצה ב-main.go:95 ולא נקרא); README מיושן [V]. מאז PR #187 אימות הטוקן עצמאי ולא פונה ל-IdP [V].
- חיי הטוקן ורענון: 5 דקות קשיח (jwt.go:127); מבוקש ב-#114, PR #199 נסגר בלי merge [V]. אין נקודת רענון (רשימת הנתיבים main.go:217-330) [V]. אין הגנת replay: אותו טוקן פותח מנהרות רבות מאותו IP בתוך 5 הדקות [V: אין מצב בצד שרת; I לגבי "ללא הגבלה"].
- קישור: למשתמש (sub), ל-host (CheckSession, jwt.go:45) ול-IP (jwt.go:52, כש-VerifyClientIp=true, ברירת מחדל config:227). מקור ה-IP הוא RemoteAddr, או האיבר הראשון של X-Forwarded-For רק אם הבקשה הגיעה מ-Server.TrustedProxies (web/context.go:79-93; master בלבד; ב-v2.2.0 XFF נאמן ללא תנאי ולכן ניתן לזיוף). #180 (פתוח): dual-stack, אימות ב-IPv6 וחיבור ב-IPv4 נדחה [V].
- היכן נבדק: עוגייה ב-PKT_TYPE_TUNNEL_CREATE (protocol/process.go:79-99); host+IP ב-PKT_TYPE_CHANNEL_CREATE (process.go:121-140) [V]. בשום מקום אחר.

== 4. פקיעה / ביטול ==
- אחרי 5 דקות אותו קובץ לא יוצר מנהרה חדשה (exp נבדק בכל TUNNEL_CREATE: jwt.go:91-95) [V]. ניתוק רשת ארוך מ-5 דקות -> חיבור מחדש נכשל; הלקוח צריך להוריד קובץ חדש [I: השרת דוחה; התנהגות reconnect של הלקוח לא נמצאת במקורות].
- מנהרה קיימת: לא נבדקת שוב, אין משך מקסימלי. IdleTimeout רק נשלח ללקוח כ-capability (process.go:288-293; grep: אין אכיפה בשרת) [V].
- ניתוק מנהרה חיה: יש protocol.Disconnect(id) (protocol/track.go:39-49), אבל זה קוד מת: אין קורא, והוא כותב ל-Processor.ctl (track.go:47) שאף אחד לא קורא ממנו (grep; process.go:38 יוצר, לולאת Process ב-:45-189 לא עושה select עליו), לכן היה נתקע לנצח [V]. אין API אדמין, אין רשימת חיבורים (#125 פתוח), אין hooks/events (#44: המתחזק מאשר "hooks/triggers ... not currently") [V].
- נקודת הרחבה לבדיקה בכל חיבור חדש: רק שדות הפונקציה ב-Go, ללא callback/webhook בקונפיג. המקום הטבעי: security.CheckPAACookie (מחובר ב-main.go:209), שמקבל ctx עם tunnel (משתמש, IP, יעד). מה צריך לשנות ב-fork:
  1. jwt.go אחרי אימות ה-claims (סביב שורה 105): קריאה לחנות האישורים (HTTP ל-localhost של KALFA או DB) לפי sub + clientIp + remoteServer + מזהה grant (claim חדש ב-customClaims), ודחייה = E_PROXY_COOKIE_AUTHENTICATION_ACCESS_DENIED (process.go:92).
  2. ניתוק חי: לגרום ל-Process להגיב ל-ctl או לסגור את p.tunnel.rwc (שדה לא מיוצא, לכן בתוך חבילת protocol), ולחשוף נקודת admin על loopback שעוברת על protocol.Connections (track.go:9); לשמור grant id על ה-Tunnel.
  הערכה [I]: כמה עשרות שורות לבדיקה, ועוד ~50-100 לניתוק.

== 5. הגבלת יעד ==
- כן. עם Hosts עם רשומה אחת (למשל alias:3389) במצב roundrobin/unsigned יש אכיפה כפולה בשרת ב-CHANNEL_CREATE: host חייב להיות שווה ל-remoteServer שבטוקן (jwt.go:45) וגם להיות ברשימת Hosts (security/basic.go:23-37) [V]. גם טוקן מזויף עם מפתח שדלף לא יגיע ליעד מחוץ לרשימה במצבים האלה [V: basic.go]. במצב any הבדיקה השנייה מוסרת (basic.go:17-19) ושם ההגנה היא רק הטוקן ו-destPolicy; ה-DNS נפתר פעמיים (web.go:167 מול process.go:142) [I].
- 127.0.0.1:3389 לא יעבוד כי xrdp קשור רק לכתובת Tailscale; היעד צריך להיות 100.106.199.107:3389 [I].
- README.md:376-378: mstsc דורש שמות שרת ולא IP, וה-host ב-Hosts חייב לכלול פורט. לכן להשתמש בשם (alias ב-/etc/hosts של מכונת השער שמצביע ל-100.106.199.107, או שם MagicDNS). ההתנהגות המדויקת של IP ב-full address: [U].

== 6. דרישות פריסה ==
- פורטים: Server.Port ברירת מחדל 443 (config:218). BindAddress קיים רק ב-master. Tls:auto דורש :80 ל-ACME ומטמון ב-/tmp/rdpgw (main.go:169-187). Tls:disable = HTTP פשוט מאחורי פרוקסי (main.go:144-146) [V].
- TLS: README:21-27, :105-127: הלקוח דורש תעודה שנחתמה ע"י CA מהימן וש-CN/SAN תואם לשם השער, אחרת mstsc לא מתחבר. nginx כפרוקסי פועל: docs/header-authentication.md:155-229; #30 (תצורה עובדת מ-openid+mstsc); README:371-374 נותן ssl_ciphers ש-mstsc מקבל [V]. השרת הפנימי כבה HTTP/2 (main.go:337), אז upstream ב-HTTP/1.1 [I].
- טרנספורט: WebSocket מועדף; legacy (RDG_IN_DATA/RDG_OUT_DATA דרך hijack) כשאין Upgrade (protocol/gateway.go:86-111) [V]. ב-master, tunnelOwnerMatches (gateway.go:118-131) מחזיר false כשהשם ריק; במצב PAA-בלבד הבקשה השנייה של legacy אנונימית, ולכן legacy כנראה נדחה ב-401 [I: נגזר מהקוד, ללא בדיקה]. WebSocket לא משתמש במטמון הזה [V]. #20: המתחזק אומר ש-mstsc ולקוח ה-Mac פותחים WebSocket כברירת מחדל.
- מצב ו-HA: אין אחסון מתמיד. מפת מנהרות בזיכרון (track.go) ו-go-cache לחצאי legacy (gateway.go:58); סשן-ווב בעוגייה (stateless) או קובץ ב-os.TempDir (web/session.go:30). טוקן PAA stateless (HMAC), אז כמה מופעים אפשריים אם המפתחות משותפים (README:190-197) [V]. legacy דורש stickiness [I]. אין HA מובנה.
- חשיפות לא רצויות: /metrics ו-/tokeninfo על אותו listener ללא אימות (main.go:221, :224) [V]; לחסום ב-nginx.
- מפתחות: אורך != 32 -> נוצר אקראי בכל הפעלה, והטוקנים נפסלים אחרי restart (config:268-293) [V]; להגדיר PAATokenSigningKey (32 תווים) במפורש. ברירת מחדל Server.Authentication=openid ללא ProviderUrl -> fatal (main.go:47-50) [I].
- משאבים: אין נתונים במקורות [U]; בינארי Go יחיד, goroutine למנהרה [I]. המתחזק טוען 1000+ משתמשי mstsc בו-זמנית בפרודקשן (#20, 2021) [V כטענה].

== 7. אי-תאימות והסתייגויות (רק מהמקורות) ==
- README:356-390: mstsc לא תומך ב-Basic; דורש תעודה תקפה; מגביל cipher suites; דורש שמות ולא IP; host עם פורט. לקוח ה-Store דורש אותם credentials לשער ולמארח. לקוח ה-Mac "הכי גמיש" (Basic/OIDC/Kerberos). iOS/Android "נראים" גמישים יותר; FreeRDP "אולי" [V, ניסוח לא מאומת].
- #91, #126 (פתוחים): mstsc נתקע ב-"configuring remote session"; עקיפה EnableUserToken:false עבדה ב-#91 ולא ב-#126. ב-#126 המדווח אומר ש-iOS RD Client עבד עם אותו קובץ .rdp (OIDC) בעוד mstsc נתקע [V].
- #170: שתי השהיות של 30 שניות, לדברי תגובה "נגרם ע"י mstsc" [V].
- #145 (פתוח): אפליקציית Microsoft Remote Desktop/Windows App החדשה באנדרואיד נכשלת מול NTLM; תגובה: ב-iOS רק Basic עובד. זה לגבי NTLM/Basic ולא PAA [V].
- #20: Remmina תומך WebSocket מ-1.4.17 ושער מ-1.4.21, כבוי כברירת מחדל. #30: Remmina נתקע בתזמון מול nginx. #133/#41: FreeRDP נכשל מול NTLM. תמיכת PAA ב-FreeRDP/Remmina: [U].
- #26 (סגור, 2021): רגרסיה בלקוח macOS 10.7.2. #205: משתמש מערער על טבלת התאימות של README (לא נבדקה בפועל).
- #164 (פתוח): panic במצב header; נראה שטופל ב-master (context.go:93 תמיד קובע AttrClientIp; jwt.go:134 משתמש בו) [I].
- תמיכת Windows App/iOS/Android ב-gatewayaccesstoken: אין אישור מפורש במקורות מעבר לדיווח #126 ול-README:384-387 [U].

== 8. פערים מול ה-use case והמינימום לבנייה ==
פערים: (1) אין זרימת בקשה/אישור/דחייה וחנות grants. (2) אין CLI אדמין ואין API אדמין כלל. (3) TTL קשיח 5 דקות במקום תוקף grant. (4) אין בדיקת grant בכל חיבור. (5) אין ניתוק מנהרה חיה. (6) אין אירועי audit מובנים, רק log.Printf (#44, #125).
הבידול בין אישור-שער לאימות חשבון OS מתקיים מעצמו [V]: אימות השער הוא עוגיית PAA בלבד (process.go:88-96); כניסת PAM של xrdp קורית בשכבת ה-RDP אחרי פתיחת המנהרה, ו-rdpgw לא רואה סיסמת OS. ללא NoUsername הקובץ ממלא username מזהות האתר (web.go:603-608), לכן NoUsername:true ו-EnableUserToken:false.
המינימום:
 א. KALFA: התחברות, בקשה, טבלת grants, CLI אדמין, ונקודת הורדה שבודקת grant פעיל ואז: אפשרות 1 קוראת ל-/connect של rdpgw (מצב header, TrustedProxies=loopback) ומחזירה את הקובץ (TTL 5 דקות); או אפשרות 2 מפיקה בעצמה JWT PAA (HS256 עם המפתח המשותף ו-claims לפי jwt.go:124-135 + מזהה grant) ובונה את ה-.rdp, ולכן TTL קצר בשליטה, בלי /connect [I: מבנה הטוקן גלוי בקוד]; מחיר: מפתח החתימה יושב באפליקציית ה-Web.
 ב. rdpgw רגיל: Authentication [header], Tls disable, BindAddress 127.0.0.1 (master בלבד), Hosts רשומה אחת (alias:3389), TokenAuth true, NoUsername true, EnableUserToken false, מפתחות 32 תווים קבועים, VerifyClientIp לפי הרשת (בעיית dual-stack). לקבע קומיט של master כי v2.2.0 חסר את ההקשחה, ולבנות עם Go 1.25.
 ג. patch ב-fork: בדיקת grant ב-CheckPAACookie + ניתוק חי (סעיף 4).
 ד. nginx: תעודה ציבורית, WebSocket upgrade, ssl_ciphers, חסימת /metrics ו-/tokeninfo (ו-/connect באפשרות 2), ו-`proxy_set_header X-Forwarded-For $remote_addr;` ולא $proxy_add_x_forwarded_for כמו בדוגמת התיעוד (docs/header-authentication.md:209), כי rdpgw לוקח את האיבר הראשון (context.go:87) והלקוח יכול לזייף אותו [I].
 ה. alias ל-100.106.199.107 במכונת השער.

== 9. חלופות (רק אם rdpgw לא מתאים; לא נחקרו במקורות, INFERRED) ==
- WireGuard/Tailscale פר-משתמש עם תפוגה (אישור = הוספת peer או ACL, ביטול = הסרה): 3389 נשאר פרטי והביטול נקי, אבל דורש התקנה אצל הלקוח.
- Apache Guacamole: שער RDP בדפדפן, סותר את דרישת "לקוח RDP מקומי".
- Microsoft RD Gateway על Windows Server: מדיניות CAP/RAP מלאה, אבל לא לינוקס.
- SSH bastion עם תעודות קצרות-חיים: פותר ביטול, אבל לא "לפתוח קובץ .rdp".
- משתמש ב-#20 כתב שאין חלופה חינמית אחרת לשער RDP; לא חיפשתי חלופות OSS אחרות [U].

== מגבלות הבדיקה ==
לא נבדקה התנהגות בפועל מול לקוח אמיתי; כל מה שמסומן [I] נגזר מקריאת הקוד ולא אומת בהרצה. השיבוט נשאר ב-/tmp/claude-10003/-var-www-vhosts-kalfa-me-beta/9b86a809-6388-4803-a63f-1d093dfccf79/scratchpad/rdpgw-src/repo.

---

## ג. מטריצת תאימות לקוחות RDP

*(דוח סוכן התאימות, כמות שהוגש.)*

מטריצת תאימות לקוחות RDP (קריאה בלבד, 2026-10-06): מסקנות, מטריצה, צ'קליסט, סיכונים. תגיות: V=נקרא ממקור ראשי (קוד/תיעוד), I=הסקה, U=לא ידוע. מקורות [S#] בסוף.

== 0. תיקוני הנחות (קודם כל) ==
1. עמוד "Supported RDP properties" החי [S1] (ms.date 2026-05-16, updated 2026-08-10, commit 2ef3249) אינו כולל טבלת תמיכה לפי לקוח, ואין בו אף מאפיין gateway*, full address, server port, gatewayaccesstoken, use redirection server name. יש בו רק "Applies to" לפי מוצר (AVD/RDS/Remote PC). authentication level חל שם רק על RDS ו-Remote PC; promptcredentialonce ו-username רק על RDS. הכתובת הישנה rdp-files מפנה לאותו עמוד.
2. סמנטיקת gateway* קיימת רק בגרסה הישנה [S2] (windowsserverdocs commit 785c6d2, 2020-09-14; בלי gatewayaccesstoken/gatewaybrokeringtype/use redirection server name/server port) ובעמודי Win32 [S3]. הטבלה היחידה לפי-לקוח שנמצאה: "Remote Desktop URI scheme" [S20] (עמודות Android/Mac/iOS). היא חלה על rdp:// ולא על קובץ .rdp.
3. המכונה הזו (קריאה בלבד; המפתח לא נקרא): xrdp 0.9.24-4ubuntu0.1~esm1, מאזין רק על 100.106.199.107:3389, security_layer=negotiate, TLS 1.2/1.3. התעודה היא snakeoil: CN=ubuntu, SAN=DNS:ubuntu, תקפה 2025-03-22 עד 2035-03-20, RSA-2048, ללא EKU. כל חיבור דרך IP או שם MagicDNS גורר אי-התאמת שם ובנוסף אי-אמון.
4. xrdp לעולם לא מנהל NLA (V, xrdp_iso.c גם ב-0.9.24 "We don't yet support CredSSP" וגם ב-0.10.6.1 "At present we only support SSL and RDP security" [S18]). הוא בוחר TLS או RDP קלאסי. לכן כל לקוח שמכריח NLA נכשל בשני המסלולים (a),(b) עוד לפני שה-gateway רלוונטי.

== 1. טבלה A: (a) פתיחת .rdp, (b) RD Gateway + transport, (d) הזדהות ל-gateway בלי דומיין ==
mstsc (Windows מובנה):
 (a) V: mstsc file.rdp [S6]. מאפריל 2026 (CVE-2026-26151) כל פתיחה מציגה דיאלוג, ובקובץ לא חתום "Caution: Unknown remote connection" עם כל ה-redirections כבויים [S5]. קובץ חתום (rdpsign /sha256) מקבל באנר "Verify the publisher". דילוג על האזהרה אפשרי רק למכשיר מנוהל עם GPO של thumbprint [S5b].
 (b) V: gateway נתמך (Vista+) [S3]. Transport: I (HTTP/WebSocket בלקוחות מודרניים; לא אומת כאן). V: MS ממליצה על cert ציבורי ל-gateway, ובפרטי חייבים לפזר את שרשרת האמון מראש [S22]. V (vendor): rdpgw README קובע שהלקוח מסרב אם ה-cert לא CA-trusted או שה-CN לא תואם ל-DNS של ה-gateway [S17].
 (d) V: PAA token = gatewaycredentialssource:5 + gatewayaccesstoken, Windows 8.1+ [S4]. I: Azure Bastion native client משתמש באותו מנגנון (תשובת MVP [S4b]). Basic לא נתמך ב-mstsc (I; rdpgw docs ו-issue #205). NTLM prompt אפשרי מול rdpgw NTLM (I, vendor).
Windows App ב-Windows (2.0.1375.0):
 (a,b,d) U. V: Remote PC ב-preview מ-2.0.964.0, RDS ❌, והמסמך מפנה ל-mstsc [S7][S8]. המלצה: ב-Windows לתמוך רק ב-mstsc.
Windows App ב-macOS (11.4.2):
 (a) V: release notes: 11.0.7 "Blocked the launch and import of RDP files for AVD based connections" (כלומר ל-Remote PC מותר), 11.1.1 קורא את dynamic resolution מהקובץ, 11.1.4 דיאלוג שגיאה כש-import נכשל [S8]. הלקוח הישן: File>Import (V) [S9a]. שיוך double-click: I.
 (b) V (לקוח ישן): Preferences>Gateways, user/pass או "Use connection credentials" [S9a]; תמיכה גם ב-RPC-over-HTTPS (10.3.5) וגם ב-HTTP [S9b]. V: Windows App 11.2.4 תיקן RD Gateways על 2012R2 [S8]. Transport של Windows App: I.
 (d) V (לקוח ישן ≥10.3.9): "connections initiated using the GatewayAccessToken RDP file property" עובדים [S9b]. Windows App הנוכחי: I (אותו ליבה). Basic/NTLM מול rdpgw: I (issue #205: "Windows App/Mac עובד", דיווח משתמש פתוח).
Windows App ב-iOS/iPadOS (11.3.7):
 (a) V (לקוח ישן): launch מקובץ/URI (10.0.3) ו-toggle ל-auto-import (10.0.5) [S10]. Windows App: I, Share→Windows App + "Always import RDP files" (תשובת משתמש 2025-11-26 + תלונה שאין import מפורש [S11]). סיכון: ה-token תקף 5 דקות (V, jwt.go), ו-import שומר bookmark עם token ישן.
 (b) V (לקוח ישן): Settings>Gateways [S10b]. Windows App: I.
 (d) U. issue #145 comment: ב-iOS "only local authentication" (I, דיווח משתמש).
Windows App ב-Android ו-ChromeOS (11.0.26081.13925):
 (a) U: אין תיעוד לפתיחת .rdp באנדרואיד (הדוקס הישנים: הוספה ידנית) [S12]. אפליקציית Android היא גם ChromeOS; MS ממליצה ל-Chromebooks אחרי 2020 [S8]. ה-web client לא תומך Remote PC/RDS (V) [S7].
 (b) V (ישן): Settings>Gateways; 10.0.12 הוסיף אזהרה "לא להשתמש ב-gateway לכתובות מקומיות" [S12]. Windows App: I.
 (d) U. issue #145 (I, דיווח): Windows App Android נכשל מול NTLM של rdpgw ("remote server does not support the required NTLM features"), כלומר אין fallback אינטראקטיבי.
FreeRDP 3.32.1 (xfreerdp/wlfreerdp/sdl-freerdp):
 (a) V: xfreerdp file.rdp (.rdp ו-.rdpw) [S13]. שיוך desktop תלוי בחבילה (U).
 (b) V: RDG מעל HTTP (WebSocket upgrade, אחריו legacy HTTP in/out) עם fallback ל-RPC-over-HTTP; /gateway:type:rpc|http|auto [S13]. V: fallback RPC לא נושא token (הטוקן נקרא רק ב-rdg.c).
 (d) V: gatewayaccesstoken => extAuth=PAA (rdg.c:2276). בלי token: Negotiate/NTLM דרך SSPI בלבד. Basic לא קיים בקוד (V). 
Remmina 1.4.43:
 (a) V: MIME *.rdp→application/x-remmina, Exec "remmina-file-wrapper -c %U", import plugin ל-.rdp/.RDP [S14]. אותו glob *.rdp תפוס גם ע"י KRDC (V), ולכן ייתכן קונפליקט שיוך.
 (b) V: דרך FreeRDP; http|rpc|auto + checkbox WebSockets; I: ברירת מחדל כבוי, כלומר קובץ מיובא עובד במצב HTTP legacy (rdpgw תומך בשניהם, issue #26).
 (d) V: gatewayaccesstoken מיובא ומועבר ל-FreeRDP (PR #1621, v1.2.30 [S14b]).
KRDC 26.08.1:
 (a) V: *.rdp→application/x-krdc; loadUrlFromFile קורא רק full address(:port), username, domain, password [S15].
 (b) V: gateway רק ידנית ב-Preferences (server/user/pass/domain, rpc/http/auto); פורט ברירת מחדל 3389 כשחסר (rdpsession.cpp:675). אין שדה token ואין קריאה של gatewayaccesstoken, לכן מסלול (b) עם rdpgw+PAA לא אפשרי.
GNOME Connections 51.0:
 (a) V: add_connection_from_file מטפל רק ב-application/x-vnc, ו-.rdp נותן "unknown mime type" (טקסט העזרה "vnc or rdp" מטעה); desktop MimeType=application/x-vnc בלבד [S16].
 (b) V: אין קוד gateway ב-gtk-frdp. => לא נתמך בשום מסלול (b).

== 2. טבלה B: אילו מאפייני קובץ נקראים/מתעלמים ==
(V לפי קוד אלא אם סומן אחרת. "MS-mob/mac" = Windows App/לקוח ישן, לפי טבלת URI [S20] = חל על rdp:// בלבד)
gatewayhostname: mstsc V | MS-mob/mac V(URI) | FreeRDP V (host[:port], ברירת מחדל 443) | Remmina V | KRDC ✗ | GNOME ✗
gatewayusagemethod: mstsc V (0-4 [S3]) | MS V(URI: 1 או 2; macOS 10.5.0 תיקן ייבוא 0/4) | FreeRDP V | Remmina חלקי: ערך 2=>detect, כל ערך אחר=>"always use" | KRDC ✗ | GNOME ✗
gatewayprofileusagemethod: mstsc V | MS U (לא בטבלת URI) | FreeRDP ✗ (נקרא, לא מיושם) | Remmina ✗ | KRDC ✗ | GNOME ✗
gatewaycredentialssource: mstsc V (5=cookie [S2]) | MS U | FreeRDP ✗ אין השפעה (השדה deprecated; PAA נבחר לפי קיום gatewayaccesstoken) | Remmina ✗ | KRDC ✗ | GNOME ✗
gatewayaccesstoken: mstsc V [S4] | macOS ישן V (≥10.3.9); Windows App I; iOS/Android U | FreeRDP V | Remmina V | KRDC ✗ | GNOME ✗
gatewaybrokeringtype: mstsc: קיים כ-API (Win 8.1, write-only, משמעות לא מתועדת) [S3], U | MS U | FreeRDP ✗ (לא נקרא) | Remmina ✗ | KRDC ✗ | GNOME ✗
full address: כולם V; FreeRDP: alternate full address גובר (כמו mstsc); Remmina: alternate לא מיובא
server port: mstsc V | MS U (לא בטבלת URI) | FreeRDP V | Remmina ✗ (לשים port בתוך full address) | KRDC ✗ | -
authentication level: mstsc: משמעות V [S1] (0=התחבר בלי אזהרה); השפעה אחרי עדכון אפריל 2026: U | MS: URI מקבל 0/1; ב-macOS הישן ערכי authentication level ו-enablecredsspsupport מכובדים רק אם ClientSettings.EnforceCredSSPSupport=0 (V טקסט 10.2.2 [S9b]; ברירת מחדל enforce = I) | FreeRDP V: ערך 0 מדלג לגמרי על אימות cert של ה-host (tls.c:1840; לא ל-gateway; ברירת מחדל 2) | Remmina V: מיובא ומוגדר ל-FreeRDP (תלוי גרסת lib: I) | KRDC ✗ | GNOME ✗
enablecredsspsupport: mstsc V | macOS כנ"ל | FreeRDP V (0 מכבה NLA+Ext) | Remmina ✗ | KRDC ✗ (הגדרה ב-Preferences) | -
promptcredentialonce: mstsc V (RDS בלבד לפי S1) | U | FreeRDP V (=GatewayUseSameCredentials) | ✗ | ✗ | ✗
username: כולם V (FreeRDP מפרק user/domain; GNOME לא רלוונטי)
use redirection server name: mstsc V | MS V(URI) | FreeRDP ✗ (נקרא, לא מיושם) | ✗ | ✗ | ✗

== 3. טבלה C: (e) cert מסוג self-signed של xrdp, NLA, ו-(f) באגים/מגבלות ==
mstsc: cert לא מהימן + שם לא תואם => אזהרה (I). authentication level:0 מוגדר כ"בלי אזהרה" (V) אבל לא נבדק על Windows 11 אחרי אפריל 2026 (U). NLA לא נכפה מהקובץ; mstsc ו-xrdp מתועדים כעובדים יחד (V, README של xrdp). (f): V דיאלוג אפריל 2026; ה-gateway חייב cert מהימן (אין override, I).
macOS: V (ישן) 10.6.4 תיקן 0x907 על cert תקף >825 יום (שלנו ~3650 יום, I נכון גם ל-Windows App); 10.2.0 מאפשר gateway עם cert לא מהימן אחרי אישור אזהרה; 10.9.8 "fallback to TLS when NTLM isn't available in NLA context" (משמעות לגבי xrdp: I). (f): 10.7.2 לא ביקש WebSocket upgrade ושבר rdpgw עד 10.7.4 (issue #26, V) => תלות בגרסת לקוח.
iOS: V (ישן) 10.1.0 הוסיף "option to disable NLA enforcement under iOS Settings > RD Client" => ברירת מחדל מכריחה NLA (I) וייתכן כישלון מול xrdp. דיאלוג cert: Accept + "Don't ask me again" (V, ישן). Windows App: U.
Android/ChromeOS: דיאלוג cert "tap Connect" + "Don't ask me again" (V, ישן). NLA: U.
FreeRDP: אימות cert: prompt Y/T/N ב-stdin (client.c:828) => הפעלה בלחיצה כפולה בלי טרמינל לא יכולה לענות (I). /cert:ignore|tofu|deny|fingerprint. (f): V בלי CMake WITH_FREERDP_DEPRECATED_COMMANDLINE (ברירת מחדל OFF; nightly/CI מדליקים) הדגלים /g /gu /gp /gt /gat /gd אינם קיימים; התחביר החדש /gateway:g:H[:P],u:,d:,p:,access-token:,type:[rpc|http|auto],usage-method:[direct|detect].
Remmina: דיאלוג cert משלו (V); "cert_ignore" צ'קבוקס נפרד מ-authentication level (V). (f): server port לא מיובא.
KRDC: דיאלוג accept זמני/קבוע (V); authentication level מהקובץ מתעלם (V). 
GNOME Connections: דיאלוג cert V; NLA+TLS+RDP כולם מופעלים עם negotiate (V); אבל לא פותח .rdp.
(f) כללי: rdpgw v2.2.0 [S17]: ה-token JWT תקף 5 דקות (jwt.go); web.go מקבע gatewaycredentialssource=5, gatewayprofileusagemethod=1, gatewayusagemethod=1; VerifyClientIp (ברירת מחדל true) עלול להפיל הורדה בדפדפן ופתיחה באפליקציה מכתובת אחרת (Wi-Fi/סלולר, IPv4/IPv6); username בקובץ = ה-identity של OIDC (web.go:178-184) אלא אם NoUsername:true, ולכן לא ייתן חשבון PAM; issue #59 "2 caps are required by the server" = הלקוח לא שלח PAA cookie; issue #133: מול gateway עם cert לא תקף Store-RD ו-FreeRDP נכשלו.
הפרדה בין שתי שכבות הזדהות: (1) gateway/אישור = דפדפן + PAA cookie בקובץ (gatewaycredentialssource:5), בלי סיסמה בלקוח; (2) חשבון OS = xrdp (TLS בלבד) שמקבל username/password מהלקוח או ממסך ה-greeter ל-PAM. promptcredentialonce:1 (ברירת מחדל rdpgw) צריך לוודא שלא מקפיץ prompt gateway מיותר.

== 4. צ'קליסט למכשיר אמיתי (לפני rollout) ==
1. כל לקוח (mstsc, Windows App mac/iOS/Android, Remmina, xfreerdp) מול xrdp ישירות על Tailscale: האם מתחבר בכלל (NLA enforcement)? iOS: בדוק Settings>NLA toggle אם קיים. macOS: ברירת מחדל EnforceCredSSPSupport.
2. mstsc על Windows 11 מעודכן (אפריל 2026+): קובץ לא חתום ואז חתום (rdpsign /sha256): מה מוצג? האם authentication level:i:0 מדכא את אזהרת ה-cert? האם קיימת אזהרת שם (CN=ubuntu)?
3. Windows App (macOS/iOS/Android): האם gatewayaccesstoken + gatewaycredentialssource:5 מתקבלים מקובץ? לוג ב-rdpgw: Tunnel auth עם ext auth 2 (כמו issue #26). אם מופיע "2 caps are required" = הטוקן לא נשלח.
4. iOS: הורדה ב-Safari ואז Share→Windows App, עם/בלי "Always import RDP files", ואז פתיחה אחרי >5 דקות: האם נכשל? ו-VerifyClientIp בין Wi-Fi לסלולר.
5. Android + ChromeOS: האם בכלל אפשר לפתוח .rdp (Files app, Chrome download)? אם לא: מה ה-fallback ללא token?
6. gateway עם cert Let's Encrypt על FQDN: כל לקוח; ואז cert לא מהימן כדי לראות אילו לקוחות נכשלים קשה (mstsc) ואילו מציגים אזהרה (macOS).
7. FreeRDP: xfreerdp /help | grep -E "/gat|/gateway" בדיסטרו היעד; הפעלה בלחיצה כפולה מקובץ .desktop בלי טרמינל עם cert לא מהימן.
8. Remmina: האם שיוך double-click ל-.rdp הוא Remmina או KRDC; כבר ה-token הוא פתיחה אחת תוך 5 דקות.
9. כל לקוח: האם מופיע prompt סיסמה ל-gateway (לא אמור), ואז prompt/greeter ל-PAM (אמור).
10. חיבור דרך gateway ל-xrdp ב-100.106.199.107: ה-gateway ב-tailnet; האם cert validation ב-client נעשה מול full address (השם בקובץ)?

== 5. הסיכונים הגדולים (לפי סדר) ==
1. NLA: xrdp בלי CredSSP + לקוחות Apple שמכריחים NLA כברירת מחדל (V ישן: iOS toggle, macOS EnforceCredSSPSupport; Windows App U). זה יכול לחסום שני המסלולים. בדוק ראשון.
2. Windows App על iOS/Android/macOS ו-gatewayaccesstoken: אין תיעוד נוכחי (macOS ישן V בלבד). בלי token אין fallback (issue #145 NTLM נכשל באנדרואיד; #205 Basic רק ב-MS clients, דיווח לא מאומת). Android: גם פתיחת .rdp עצמה U.
3. authentication level:i:0 בטוח רק בחלק מהלקוחות: ב-FreeRDP/Remmina הוא מבטל לחלוטין אימות cert של ה-host (V), ב-Apple כנראה מתעלמים (I), ב-mstsc אחרי אפריל 2026 U. מעבר ל-gateway ציבורי זה פותח MITM של ה-gateway על הסשן. חלופה: cert תקף ל-xrdp, למשל tailscale cert לשם ה-MagicDNS המדויק שב-full address (I; דורש MagicDNS + Enable HTTPS, תוקף 90 יום, והשם נחשף ב-Certificate Transparency [S19]).
4. mstsc אפריל 2026: משתמשי B2C בלי GPO יראו תמיד דיאלוג; חתימת rdpgw (SigningCert/SigningKey) משנה באנר ל"Verify the publisher" אבל לא מבטלת דיאלוג, ו-redirections כבויים כברירת מחדל (V). האם cert חתימה ציבורי נדרש: U.
5. טוקן 5 דקות + VerifyClientIp + iOS import שמור: חוויית "הורד ופתח" שבירה (V לטוקן, I להשפעה).
6. Linux: רק FreeRDP/Remmina ניתנים לנתיב (b); KRDC רק ל-(a); GNOME Connections לא נתמך. דגלי FreeRDP ישנים מושבתים בבילד ברירת מחדל.
7. תלות בגרסת לקוח: issue #26 (macOS 10.7.2 שבר WebSocket) ו-11.2.4/11.2.1 (RD Gateways ישנים). לנעוץ גרסאות ולבדוק אחרי עדכונים.
הערה צדדית (מחוץ לסקופ): NEWS של xrdp 0.10.6.1 מציין 10+ CVE מ-2026; החבילה המותקנת 0.9.24 ESM, לא אומת מה עבר backport.

== מקורות (תאריכי גרסה/commit) ==
S1 https://learn.microsoft.com/en-us/azure/virtual-desktop/rdp-properties (2026-05-16; upd 2026-08-10; commit 2ef3249)
S2 https://github.com/MicrosoftDocs/windowsserverdocs/blob/785c6d2c1bf3a4b5471e5f9cabb49c5ac89c2c38/WindowsServerDocs/remote/remote-desktop-services/clients/rdp-files.md (2020-09-14)
S3 https://learn.microsoft.com/en-us/windows/win32/termserv/imsrdpclienttransportsettings-gatewayusagemethod ; .../imsrdpclienttransportsettings-gatewaycredssource ; .../imsrdpclienttransportsettings4-gatewaybrokeringtype (2018-05-31)
S4 https://github.com/microsoftarchive/msdn-code-gallery-community-m-r/blob/master/Remote%20Desktop%20Gateway%20Pluggable%20Authentication%20and%20Authorization%20Sample/README.md ; S4b https://learn.microsoft.com/en-us/answers/questions/923455/whats-the-required-data-format-for-axmstsclib-axms (MVP 2022-11-01)
S5 https://learn.microsoft.com/en-us/windows-server/remote/remote-desktop-services/remotepc/understanding-security-warnings (2026-04-07; upd 2026-04-14) ; S5b .../manage-rdp-file-security-settings-with-group-policy (2026-07-14)
S6 https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/mstsc (2022-10-19; upd 2026-09-08)
S7 https://learn.microsoft.com/en-us/windows-app/overview (2026-07-09)
S8 https://learn.microsoft.com/en-us/windows-app/whats-new (2026-08-24; upd 2026-09-25): Windows 2.0.1375.0, macOS 11.4.2, iOS 11.3.7, Android 11.0.26081.13925
S9a https://learn.microsoft.com/en-us/previous-versions/remote-desktop-client/remote-desktop-macos (2024-07-03) ; S9b .../whats-new-macos (2024-08-02)
S10 .../previous-versions/remote-desktop-client/whats-new-ios-ipados (2024-07-08) ; S10b .../remote-desktop-ios-ipados (2024-07-03)
S11 https://learn.microsoft.com/en-us/answers/questions/2126241/how-can-i-import-a-rdp-file-in-the-windows-app-for (תשובות 2024-12-06 ו-2025-11-26, של משתמשים)
S12 .../previous-versions/remote-desktop-client/whats-new-android-chrome-os (2024-04-11) ; .../remote-desktop-android (2024-07-03)
S13 FreeRDP 3.32.1 (2026-09-28): client/common/file.c, cmdline.c, cmdline.h, client.c; libfreerdp/crypto/tls.c:1840; libfreerdp/core/gateway/rdg.c, http.c; libfreerdp/core/transport.c; CMakeLists.txt:156
S14 Remmina v1.4.43 (2026-02-20): plugins/rdp/rdp_file.c, rdp_plugin.c:1860-1950, data/desktop/*.xml,*.in ; S14b https://github.com/FreeRDP/Remmina/pull/1621
S15 KRDC v26.08.1: rdp/rdpviewfactory.cpp, rdp/rdpsession.cpp, org.kde.krdc-mime.xml
S16 GNOME Connections 51.0 (2026-09-14): src/application.vala:152-169, data/org.gnome.Connections.desktop.in ; gtk-frdp master src/frdp-session.c
S17 rdpgw v2.2.0 (2025-09-18): README.md, docs/pam-authentication.md, cmd/rdpgw/web/web.go, cmd/rdpgw/security/jwt.go; issues #26 #41 #59 #133 #145 #205 (https://github.com/bolkedebruin/rdpgw/issues/205)
S18 xrdp v0.9.24 + v0.10.6.1 (2026-07-07) libxrdp/xrdp_iso.c ; /etc/xrdp (קריאה בלבד)
S19 https://tailscale.com/kb/1153/enabling-https
S20 https://learn.microsoft.com/en-us/windows-server/remote/remote-desktop-services/remote-desktop-uri (2024-07-03; upd 2026-01-02)
S21 https://learn.microsoft.com/en-us/previous-versions/remote-desktop-client/overview (2025-03-05; upd 2026-02-14): לקוחות Mac/iOS הישנים הוחלפו ב-Windows App; ה-MSI וה-Store של Windows לא תומכים ב-RDS/Remote PC
S22 https://learn.microsoft.com/en-us/windows-server/remote/remote-desktop-services/remote-desktop-gateway-role (2025-06-24)
הוסרו בכוונה: טענות לקוח מסיכום ראשוני של rdpgw README שלא נמצאו בקובץ עצמו (IP לעומת שם, פורטים, cipher), ותקצירי חיפוש שלא נקראו בעמוד המקור (כולל רשימת אפשרויות F5).

---

## ד. רכיבים קיימים ב-KALFA לשימוש חוזר

*(דוח סוכן מיפוי הקוד, כמות שהוגש.)*

מיפוי read-only הושלם. תגיות: V = נקרא בקוד, I = הסקה או ממקור משני (memory, docs, config מקומי). הנתיבים יחסיים ל-/var/www/vhosts/kalfa.me/beta. docs/project/02 מיושן (21.7) ולכן מצוטט dal.ts ולא הוא.

1. אימות לא-צוות
- Cookie sessions: src/lib/auth/dal.ts getUser/requireUser, getUser() נבדק מול שרת ה-Auth (V). src/lib/supabase/proxy.ts updateSession הוא אופטימי בלבד (V).
- זרימות: login/signup/requestPasswordReset ב-src/app/auth/actions.ts; אימות מייל ב-src/app/auth/confirm/actions.ts (POST verifyOtp). Passkey: signInWithPasskey/registerPasskey בצד לקוח (V). הפעלה בפרודקשן I, כי [auth.passkey] ב-supabase/config.toml מוער.
- OTP טלפון: src/app/(customer)/app/settings/actions.ts, updateUser({phone}) + verifyOtp('phone_change'), רק למשתמש מחובר, ולא כניסה (V). שליחה דרך hook ל-supabase/functions/sms-hook ו-ExtrA (I).
- OTP עצמאי: src/lib/data/otp.ts requestOtp/verifyOtp, טבלת otp_challenges, hash של sha256(code:phone), TTL 5 דקות, 5 ניסיונות, 5 קודים בשעה (V). חולשה: ה-consume הוא select ואז update, לא אטומי.
- 2FA/TOTP: אין שימוש ב-auth.mfa או aal2 ב-src (V). config.toml מראה TOTP כבוי, אבל זה config מקומי ולכן מצב הפרודקשן I.
- ציר הרשאות: platform_staff (requirePlatformStaff, requirePlatformPermission, hasPlatformPermission) מול לקוח/ארגון מול console_agents (V). has_platform_permission_for_user(uid,key) פתוחה ל-service_role בלבד, מיגרציה 20260924034054 (V).
- אין תפקיד "מבקש חיצוני". כל signup הוא customer (handle_new_user -> profiles, V). הפריסדנט היחיד לאישור אדם שאינו צוות: owner_agent_allowlist.approval_kind='external_override' עם approved_by/approved_at/approval_note (V, מיגרציה 20260927003348). פסיקת הבעלים "B2C פרטי בלבד" (I, memory). זו שאלת תכנון פתוחה ואיני מכריע בה.

2. מודל נתונים (V: supabase/migrations/20260723094500_fleet_requests.sql)
- fleet_requests הוא התבנית הקרובה ביותר: RLS פעיל, request_key ייחודי, expires_at (ברירת מחדל 72 שעות), trigger של מכונת מצבים, DELETE ו-TRUNCATE חסומים.
- מענה רק דרך RPC מסוג SECURITY DEFINER שמחתים auth.uid()+now(). צריכה חד-פעמית דרך RPC של service_role (CAS). revoke מ-public וגם מ-anon וגם מ-authenticated.
- זהירות: fleet_answer_request עדיין בודקת has_role('admin'), הציר שסומן deprecated ב-dal.ts. חדש צריך להשתמש ב-is_platform_staff/has_platform_permission. האם המיגרציה מ-10.9 המירה גם אותה: I.
- מפתח הרשאה חדש הוא שורה ב-platform_permission_definitions. ה-owner מקבל אותו אוטומטית בטריגר (V, 20260906221951_view_events_permission.sql).
- קריאה מבוקרת של צוות: recordStaffAccess (src/lib/data/admin/access-log.ts) כותב ל-support_access_log, fail-closed (V).

3. Audit ו-rate limit
- logActivity (src/lib/data/activity.ts) קורא requireUser, ולכן אינו שמיש ב-CLI, worker או bearer route (V). מחוץ ל-request: admin.from('activity_log').insert({event_id:null,user_id:null,action,meta}), כמו src/lib/data/payment-orphans.ts:81 (V). event_id הוא nullable. meta בלי PII.
- src/lib/security/rate-limit.ts: Map בזיכרון ו-per-process, ללא store משותף (V). getClientIp קורא x-forwarded-for. מפתחות נבנים עם tokenFingerprint (src/lib/security/token-fingerprint.ts). CSRF לנתיבי כסף: isAllowedOrigin ב-src/lib/http/allowed-origin.ts (V).

4. Jobs (pg-boss)
- שמות ב-src/lib/queue/queues.ts. הלולאה createQueue ב-worker/main.ts עוברת על Object.values(QUEUES). ב-1533-1540 ו-1640: boss.work(q, POLL_SLOW_CRON, guardedWorker(...)) ו-boss.schedule(q,'*/10 * * * *') (V).
- תבנית ל-sweep: src/lib/fleet/expire.ts runFleetExpireSweep(admin) מסמן pending שעבר expires_at כ-'expired' ושולח התראת Slack (V).
- נלווים חובה: רשומה ב-QUEUE_EXPECTED_MAX_MINUTES (src/lib/ops/queue-schedule.ts). לפי הערת הקובץ, test נכשל בלעדיה (בדיקה לא נקראה, I). כלל dependency-cruiser אוסר על מודול של worker לייבא dal (V בהערות). deterministicJobId(name) ב-src/lib/queue/deterministic-id.ts מפיק uuid v5 (V).
- sweep הוא ניקיון ולא אכיפה. expire.ts עצמו מציין שה-RPC כבר מסרב לשורה שפגה. dal.ts מסביר ש-claims מתבטלים רק בפקיעה, ולכן ביטול דורש קריאת טבלה בכל בדיקה (V).

5. התראות לאדמין
- Slack: sendSlackAlert (src/lib/alerts/slack.ts), לא-PII, fail-safe, מחזיר ts ל-thread, dedup של 60 שניות. AlertCategory כולל 'security' (V). אין פעולה אינטראקטיבית.
- Push: sendPushToUser(userId,payload) ב-src/lib/data/push-delivery.ts (worker-safe), ו-notifyAdmins ב-scripts/fleet-agent-cli.ts:483 שרץ על platform_staff (V).
- מייל: getEmailSender().send({to,subject,html,idempotencyKey}) (V). SMS: getSmsSender() (ExtrA). WhatsApp: sendWhatsAppText ב-src/lib/whatsapp/client.ts. אפשר גם כפתורי owner-agent (V בקוד, מצב go-live I).

6. CLI
- תבנית: scripts/*.ts עם esbuild (alias של server-only ו-next/* ל-worker/empty.js) ואז node --env-file=.env.local dist/x.cjs (package.json, V). קיימים גם tsx (voximplant, relocate), parseArgs מ-node:util ב-fleet-agent-cli, ו-@clack/prompts ב-scripts/relocate/cli.ts. מוסכמת exit: 0 הצלחה, 1 שגיאה, 2 no-op (מתועד ב-docs/fleet/03, I).
- אימות: כל ה-CLIs רצים כ-service_role דרך createAdminClient, או כ-cert (exo.cjs). אין זהות אדם, ולכן אישור מה-CLI לא יתיחס לאדם מסוים.
- גשרי זהות קיימים: requireConsoleAgent + callerHasPlatformPermission ב-src/lib/auth/console-agent.ts (Bearer JWT, JSON 401/403, V). ו-/api/mcp עם OAuth של Supabase, כש-sub עובר ל-has_platform_permission_for_user (src/lib/owner-agent/mcp/oauth.ts, V).
- ops-agent (127.0.0.1:3012, ops/probe-server.mjs): GET בלבד, 4 נתיבים קבועים, bearer OPS_AGENT_TOKEN. אינו ערוץ כתיבה (V).

7. אירוח והורדה
- kalfa-beta: next start -H 127.0.0.1 -p 3002, תהליך יחיד ללא cluster (ecosystem.config.cjs, V). nginx conf.d/beta-proxy.conf ו-Plesk (I, memory ו-docs, לא נקראו). restart ב-fork mode פירושו חלון refused קצר, כלומר בדיקת חיבור שתלויה באפליקציה תיכשל סגור בכל deploy (I).
- sidecars בלולאה מקומית: pgboss-ui :3011 דרך proxy מאומת, ops-agent :3012, filebrowser :8082 דרך SSH tunnel (V). פסיקות בעלים: אין שרתים או פורטים אד-הוק, והבעלים מבצע deploy (I, memory no-adhoc-servers-temp-ports).
- תבנית download: src/app/api/admin/fleet-file/route.ts. שער הרשאה ראשון, 404 גנרי, Content-Disposition עם filename*, Cache-Control 'private, no-store', nosniff (V). לנתיב טוקן חדש נדרש בלוק headers משלו ב-next.config.ts: no-store, no-referrer, noindex, כמו /r /g /cb (V). route handlers משתמשים ב-runtime='nodejs' ו-dynamic='force-dynamic'.

8. טוקנים (שני סגנונות אחסון)
- ברור בטבלה: rsvp_token (128 ביט, מבוטל ע"י rsvp_token_revoked_at, ללא תפוגה, src/lib/data/rsvp-links.ts), intake_token (עם תפוגה וחד-פעמי, מיגרציה 20260914114331) (V).
- Hash בלבד: mintDialToken/verifyDialToken ב-src/lib/data/console-calls.ts:1001/1032. 32 בתים hex עם prefix, sha256 בלבד, TTL 60 שניות, חד-פעמי ב-CAS, השוואה constant-time ב-JS, prefix כבול לזרימה (V). זו התבנית המומלצת לטוקן הורדה. גם src/lib/workflow/webhook-token.ts, והשוואה ב-safeTokenEqual/sha256Hex (src/lib/security/token-compare.ts) (V).
- תבנית קריאה חוזרת מגורם חיצוני: src/app/api/voximplant/console/authorize/route.ts (V). POST עם {secret,token}, השוואת secret ל-KALFA_CONSOLE_SECRET ב-safeTokenEqual, fail-closed 503 אם לא מוגדר, Zod, תקרת 1KB, rate limit גס פר-IP (120/דקה), תשובה {ok:true,...} או {ok:false}, ובדיקה מחדש של מצב חי. src/app/api/voximplant/mtg/ctx/[token]/route.ts: 404 גנרי לכל כשל, shape-guard, rate limit לפי fingerprint+IP, ובדיקת שורה חיה ולא snapshot (V).
- ה-token שם חד-פעמי (consumed). חיבור RDP חוזר או gateway שבודק לכל חיבור ידרוש בדיקה לא-צורכת או טוקן לכל חיבור.
- createHmac ב-repo משמש רק לאימות נכנס (src/lib/security/elevenlabs-webhook.ts, תוקף 30 דקות). מנפיק קישורים חתומים לא נמצא (I, לפי grep ולא קריאת כל הקבצים).

חסר למקרה השימוש
1. תפקיד מבקש חיצוני והחלטה על זהותו (customer, חשבון נפרד, או הזמנה). פתוח.
2. טבלאות request/grant, RPCs (answer/consume/revoke), ומפתח הרשאה חדש.
3. זהות המאשר ב-CLI (Bearer JWT או OAuth). בלעדיה אין ייחוס.
4. נקודת אכיפה בזמן חיבור. אין שום קוד RDP ברשת ב-repo (grep עם גבולות מילה). ניתן ללמוד מ-voximplant authorize, אך הצד שמבצע את ה-RDP מחוץ ל-repo.
5. מחולל קובץ .rdp ונתיב הורדה עם headers משלו.
6. store משותף ל-rate limit (היום per-process בלבד).
7. step-up או MFA (אין בקוד). אין מנפיק קישורי HMAC.
8. התראת אדמין עם כפתור פעולה (Slack ללא אינטראקציה).
9. עמידה בשערים: admin-data-layer-coverage.test.ts (כל מודול data של admin נקשר למפתח הרשאה, מוזכר בהערה ב-dal.ts), רישום ב-queue-schedule לכל cron, כלל ה-worker, types.generated.ts רק דרך gen:types (I, memory), ומיגרציה שמוחלת ע"י הבעלים.