#!/usr/bin/env node
/*
 * All Company site → internal portal (owner decisions 2026-09-06).
 *
 * Provisions on https://kalfarsvp.sharepoint.com/sites/allcompany:
 *   1. Brand: KALFA "K" logo (public/icons/icon.svg → PNG → Site Assets → site
 *      logo + thumbnail), tenant theme "KALFA Coral" (logo coral darkened to
 *      WCAG AA against white text), web title "KALFA", header Compact/Strong,
 *      horizontal navigation.
 *   2. Page SitePages/Portal.aspx: strong-emphasis intro band (the Hero web part
 *      and full-width sections exist only on Communication sites), two Quick
 *      Links web parts (systems / archive), procedures + operational calendar
 *      in a one-third layout. Quick Links are verified after create and fall
 *      back to text link lists if they did not land.
 *   3. Welcome page = Portal.aspx; navigation nodes; the portal pinned as a
 *      "SharePoint pages" tab in the KALFA RSVP team's General channel.
 *
 * Shared mechanics (auth, theme, logo, page building, gotchas) live in
 * scripts/lib/sharepoint.cjs. Idempotent; nothing is deleted except the page
 * this script generates (recreated on each run because Graph PATCH drops
 * standard web parts) and a stale Website-type tab of the same name.
 *
 *   node scripts/sharepoint-intranet-provision.cjs --dry-run
 *   node scripts/sharepoint-intranet-provision.cjs
 *   node scripts/sharepoint-intranet-provision.cjs --text-only   # no Quick Links
 */

const path = require('node:path');

const sp = require('./lib/sharepoint.cjs');

const HOST = 'kalfarsvp.sharepoint.com';
const SITE_PATH = '/sites/allcompany';
const DRY_RUN = process.argv.includes('--dry-run');
const TEXT_ONLY = process.argv.includes('--text-only');

const PAGE_NAME = 'Portal.aspx';
const PAGE_TITLE = 'פורטל KALFA';
const SITE_TITLE = 'KALFA'; // web title only; the M365 group stays "All Company" (Viva Engage)
const LOGO_SVG = path.join(__dirname, '..', 'public', 'icons', 'icon.svg');
const LOGO_NAME = 'kalfa-logo.png';
const LOGO_CORAL = '#FF5A3C';
const THEME_NAME = 'KALFA Coral';

// Teams: a Website tab pops SharePoint pages out to the browser; the
// "SharePoint pages and lists" tab app renders them inline. Graph's docs call
// it non-configurable, but the configuration PnP PowerShell sends works
// (pnp/powershell src/Commands/Teams/AddTeamsTab.cs, read 2026-09-06).
const TEAMS_TEAM_ID = '60cdfb5b-6907-4063-834d-e82f8016bbde';
const TEAMS_CHANNEL_ID = '19:ZnlsI5sCanAniiupgMRmediu_tsGhFbjCJGW4Dctdi41@thread.tacv2';
const TEAMS_SHAREPOINT_APP = '2a527703-1f6f-4559-a332-d8a7d288cd88';
// Document library tabs ARE configurable via Graph (live docs: entityId "",
// contentUrl = library root URL, websiteUrl/removeUrl null).
const TEAMS_FILES_APP = 'com.microsoft.teamspace.tab.files.sharepoint';
const TEAMS_TAB_NAME = 'פורטל KALFA';

// ─── Links ──────────────────────────────────────────────────────────────────

const ARCHIVE = `https://${HOST}/sites/KALFARSVP`;
const TEAMS_CHANNEL =
  'https://teams.cloud.microsoft/l/channel/19%3AZnlsI5sCanAniiupgMRmediu_tsGhFbjCJGW4Dctdi41%40thread.tacv2/KALFA%20RSVP?groupId=60cdfb5b-6907-4063-834d-e82f8016bbde&tenantId=11926da5-9d16-45e3-947b-27b2909ba6c5';
const REPO = 'https://github.com/nm-digitalhub/KALFA-RSVP-React';

// [label, url, fluentIcon, description]
const SYSTEMS = [
  ['ניהול KALFA (beta)', 'https://beta.kalfa.me/admin', 'Settings', 'לוח הניהול של האפליקציה'],
  ['Supabase', 'https://supabase.com/dashboard/project/cklpaxihpyjbhymqtduv', 'Database', 'מסד הנתונים והאחסון (פרויקט beta)'],
  ['Meta Business Suite', 'https://business.facebook.com/latest/home', 'Globe', 'נכסי Meta, דפים ופרסום'],
  ['WhatsApp Manager', 'https://business.facebook.com/wa/manage/home/', 'Chat', 'תבניות, מספרים ואיכות'],
  ['Voximplant', 'https://manage.voximplant.com/', 'Phone', 'טלפוניה ושיחות AI'],
  ['ElevenLabs Agents', 'https://elevenlabs.io/app/agents', 'Microphone', 'סוכני הקול'],
  ['SUMIT', 'https://app.sumit.co.il/', 'Money', 'סליקה, קבלות ומסמכים'],
  ['GitHub', REPO, 'Code', 'מאגר הקוד'],
  ['PM2 Plus', 'https://app.pm2.io/#/r/wqhd9pr6xtnqpv4', 'Health', 'ניטור השרת והתהליכים'],
  ['Microsoft 365 admin', 'https://admin.cloud.microsoft/', 'Admin', 'ניהול הטננט'],
];

const ARCHIVE_LINKS = [
  ['Contracts', `${ARCHIVE}/Contracts`, 'Certificate', 'חוזים חתומים של העסק — ארכיון הרשומה'],
  ['Contracts-Working', `${ARCHIVE}/ContractsWorking`, 'Edit', 'טיוטות ומו"מ בלבד'],
  ['Customer-Agreements', `${ARCHIVE}/CustomerAgreements`, 'People', 'עותקי הסכמי לקוחות שנחתמו במערכת'],
  ['Disposition-Log', `${ARCHIVE}/Lists/DispositionLog`, 'Delete', 'יומן ביעור — כל מחיקה נרשמת לפני שמבצעים'],
  ['כללי הארכיון', `${ARCHIVE}/Contracts/_ARCHIVE-RULES.md`, 'ReadingMode', 'התקציר שיושב בתוך הארכיון'],
  ['אתר הצוות KALFA RSVP', ARCHIVE, 'SharepointLogo', 'האתר שמארח את הארכיון'],
  ['הצוות ב-Teams', TEAMS_CHANNEL, 'TeamsLogo', 'ערוץ General'],
];

const DOCS_LINKS = [
  ['תיקיית docs במאגר', `${REPO}/tree/main/docs`, 'Documentation', 'כל מסמכי התכנון והתפעול'],
  ['תכנון הארכיון', `${REPO}/blob/main/docs/sharepoint-contracts-archive-plan-2026-09-06.md`, 'Archive', 'מבנה, שמות, שימור, נהלים'],
  ['NotebookLM — תיעוד הפרויקט', 'https://notebooklm.google.com/notebook/96aee872-921d-4add-9dd7-38e884eddf5a', 'ReadingMode', 'שאלות על התיעוד המלא'],
  ['README', `${REPO}#readme`, 'Info', 'תיאור הפרויקט והרצה מקומית'],
];

const NAV_NODES = [
  ['ארכיון חוזים', `${ARCHIVE}/Contracts`],
  ['הסכמי לקוחות', `${ARCHIVE}/CustomerAgreements`],
  ['יומן ביעור', `${ARCHIVE}/Lists/DispositionLog`],
  ['אתר הצוות KALFA RSVP', ARCHIVE],
];

// ─── Page content ───────────────────────────────────────────────────────────

const { esc, linkList, textPart, quickLinksPart, section, column } = sp;

const HTML_INTRO = `<h2>פורטל פנימי — KALFA</h2><p>נקודת הכניסה לכל המערכות, לארכיון החוזים ולנהלים הקבועים. הארכיון עצמו יושב באתר הצוות KALFA RSVP; הדף הזה רק מצביע.</p>`;
const HTML_SYSTEMS = `<h3>מערכות</h3>${linkList(SYSTEMS)}`;
const HTML_ARCHIVE = `<h3>ארכיון חוזים</h3>${linkList(ARCHIVE_LINKS)}`;
const HTML_DOCS = `<h3>מסמכים ותיעוד</h3>${linkList(DOCS_LINKS)}`;
const HTML_RULES = `<h3>נהלים קבועים</h3><ul>
<li><strong>שם קובץ:</strong> <code>YYYY-MM-DD_Counterparty_DocType_vN_status.pdf</code> (למשל <code>&lrm;2026-07-15_Voximplant_MSA_v1_signed.pdf</code>) — תאריך החתימה, ASCII בלבד, "_" בין שדות ו-"-" בתוך שדה.</li>
<li><strong>טיוטה מול חתום:</strong> טיוטות ומו"מ רק ב-Contracts-Working. ל-Contracts נכנסת רק הגרסה החתומה הסופית, עם צד שני, סוג, תאריכים, "שימור עד" ו-SHA-256.</li>
<li><strong>אי-שינוי:</strong> PDF חתום לא נערך לעולם. תיקון או הארכה = קובץ חדש עם "מתקן את", והמקורי מסומן Superseded.</li>
<li><strong>שימור:</strong> "שימור עד" = 31 בדצמבר של שנת סיום החוזה + 7 שנים. הסכמי לקוחות: שנת האירוע.</li>
<li><strong>ביעור:</strong> רק דרך התצוגה Due-for-disposition, אחרי בדיקת הקפאה משפטית, ועם שורה ב-Disposition-Log לפני המחיקה.</li>
<li><strong>הקפאה משפטית:</strong> הליך תלוי או דרישת רשות = LegalHold מסומן. מסירים רק בכתב.</li>
</ul><p>המסמך המלא: <a href="${esc(REPO)}/blob/main/docs/sharepoint-contracts-archive-plan-2026-09-06.md">docs/sharepoint-contracts-archive-plan-2026-09-06.md</a> במאגר.</p>`;
const HTML_CALENDAR = `<h3>לוח תפעולי</h3><ul>
<li><strong>יומי, 03:50:</strong> ייצוא אוטומטי של הסכמי לקוחות שנחתמו ל-Customer-Agreements (מתג ב-/admin/settings; כשלים מגיעים ל-Slack).</li>
<li><strong>חודשי:</strong> סריקת Contracts-Working ומחיקת טיוטות של חוזים שכבר נחתמו.</li>
<li><strong>ינואר:</strong> ביעור לפי Due-for-disposition, בדיקת SHA-256 לכל הארכיון, סקירת מידע עודף, ו-dry-run של סקריפט ההקמה לגילוי סחיפה.</li>
</ul>`;

function buildCanvas(useQuickLinks) {
  const systems = useQuickLinks ? quickLinksPart('מערכות', SYSTEMS, 'CompactCard') : textPart(HTML_SYSTEMS);
  const archive = useQuickLinks ? quickLinksPart('ארכיון חוזים', ARCHIVE_LINKS, 'List') : textPart(HTML_ARCHIVE);
  const docs = useQuickLinks ? quickLinksPart('מסמכים ותיעוד', DOCS_LINKS, 'CompactCard') : textPart(HTML_DOCS);
  return {
    horizontalSections: [
      section(1, 'oneColumn', 'strong', [column(1, 12, [textPart(HTML_INTRO)])]),
      section(2, 'twoColumns', 'none', [column(1, 6, [systems]), column(2, 6, [archive])]),
      section(3, 'oneColumn', 'none', [column(1, 12, [docs])]),
      section(4, 'oneThirdRightColumn', 'soft', [column(1, 8, [textPart(HTML_RULES)]), column(2, 4, [textPart(HTML_CALENDAR)])]),
    ],
  };
}

// ─── Teams tab ──────────────────────────────────────────────────────────────

function teamsTabs(siteUrl, portalUrl) {
  return [
    {
      name: TEAMS_TAB_NAME,
      app: TEAMS_SHAREPOINT_APP,
      configuration: {
        entityId: null,
        contentUrl: `${siteUrl}/_layouts/15/teamslogon.aspx?spfx=true&dest=${encodeURIComponent(portalUrl)}`,
        websiteUrl: portalUrl,
        removeUrl: null,
      },
    },
    {
      name: 'ארכיון חוזים',
      app: TEAMS_FILES_APP,
      configuration: { entityId: '', contentUrl: `${ARCHIVE}/Contracts`, websiteUrl: null, removeUrl: null },
    },
    {
      name: 'הסכמי לקוחות',
      app: TEAMS_FILES_APP,
      configuration: { entityId: '', contentUrl: `${ARCHIVE}/CustomerAgreements`, websiteUrl: null, removeUrl: null },
    },
  ];
}

async function ensureTeamsTabs(g, siteUrl, portalUrl, { log, plan }) {
  const tabsPath = `/teams/${TEAMS_TEAM_ID}/channels/${encodeURIComponent(TEAMS_CHANNEL_ID)}/tabs`;
  const existing = (await g.get(`${tabsPath}?$select=id,displayName&$expand=teamsApp($select=id)`)).value;
  for (const tab of teamsTabs(siteUrl, portalUrl)) {
    const same = existing.filter((t) => t.displayName === tab.name);
    const good = same.find((t) => t.teamsApp && t.teamsApp.id === tab.app);
    for (const t of same.filter((x) => x !== good)) {
      plan(`remove stale "${tab.name}" tab (${t.teamsApp ? t.teamsApp.id : 'unknown app'})`);
      if (!DRY_RUN) await g.delete(`${tabsPath}/${t.id}`);
    }
    if (good) {
      log(`  Teams tab exists: ${tab.name}`);
      continue;
    }
    plan(`pin Teams tab "${tab.name}" (${tab.app}) in KALFA RSVP / General`);
    if (DRY_RUN) continue;
    const body = {
      displayName: tab.name,
      'teamsApp@odata.bind': `${sp.GRAPH}/appCatalogs/teamsApps/${tab.app}`,
      configuration: tab.configuration,
    };
    try {
      await g.post(tabsPath, body);
    } catch (e) {
      if (!/install/i.test(e.message)) throw e;
      log('  tab app not installed in the team — installing, then retrying');
      await g.post(`/teams/${TEAMS_TEAM_ID}/installedApps`, {
        'teamsApp@odata.bind': `${sp.GRAPH}/appCatalogs/teamsApps/${tab.app}`,
      });
      await g.post(tabsPath, body);
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

const log = (...a) => console.log(...a);
const plan = (...a) => console.log(DRY_RUN ? '[dry-run]' : '[do]', ...a);
const ctx = { log, plan, dryRun: DRY_RUN };

(async () => {
  log(DRY_RUN ? '== DRY RUN — no writes ==' : '== PROVISION ==');
  const { g, sp: rest, site } = await sp.connect({ host: HOST, sitePath: SITE_PATH });
  log('site:', site.displayName, site.webUrl);

  log('\n[1] logo');
  await sp.ensureLogo(g, rest, { siteId: site.id, sitePath: SITE_PATH, svgPath: LOGO_SVG, fileName: LOGO_NAME, ...ctx });

  log('\n[2] theme');
  await sp.ensureTheme(rest, { name: THEME_NAME, primary: sp.accessiblePrimary(LOGO_CORAL), ...ctx });

  log('\n[3] site title, header + navigation style');
  await sp.ensureSiteTitle(rest, { title: SITE_TITLE, ...ctx });
  await sp.ensureHeaderAndNav(rest, { want: { HeaderLayout: 1, HeaderEmphasis: 3, HorizontalQuickLaunch: true, MegaMenuEnabled: false }, ...ctx });

  log('\n[4] portal page');
  await sp.ensurePage(g, {
    siteId: site.id,
    name: PAGE_NAME,
    title: PAGE_TITLE,
    build: buildCanvas,
    expectedQuickLinkCounts: [SYSTEMS.length, ARCHIVE_LINKS.length, DOCS_LINKS.length],
    textOnly: TEXT_ONLY,
    ...ctx,
  });

  log('\n[5] welcome page');
  await sp.ensureWelcomePage(rest, { pageName: PAGE_NAME, ...ctx });

  log('\n[6] navigation nodes');
  await sp.ensureNavigation(rest, { nodes: NAV_NODES, ...ctx });

  log('\n[7] Teams tabs');
  await ensureTeamsTabs(g, site.webUrl, `${site.webUrl}/SitePages/${PAGE_NAME}`, ctx);

  log('\ndone.', DRY_RUN ? 'Re-run without --dry-run to apply.' : `Open: ${site.webUrl}/SitePages/${PAGE_NAME}`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
