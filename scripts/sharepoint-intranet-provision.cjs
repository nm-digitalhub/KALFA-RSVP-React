#!/usr/bin/env node
/*
 * All Company site → internal portal (owner decisions 2026-09-06).
 *
 * What it provisions on https://kalfarsvp.sharepoint.com/sites/allcompany:
 *   1. Brand: the KALFA "K" logo (public/icons/icon.svg → PNG via sharp, uploaded
 *      to Site Assets, set as site logo + thumbnail), a coral theme derived from
 *      the logo colour, header layout Compact with Strong emphasis, horizontal
 *      navigation. Rendered live per the docs' "Change the look" options; all
 *      of it is REST (_api/web, _api/thememanager, _api/siteiconmanager).
 *   2. Page SitePages/Portal.aspx (Graph): a strong-emphasis intro band (the
 *      Hero web part and full-width sections exist only on Communication
 *      sites), two Quick Links web parts (systems / archive), then a
 *      one-third layout with the standing procedures and the operational
 *      calendar. Graph documents a bug where Quick Links items come back
 *      nested; the script verifies the created web parts and falls back to
 *      text link lists if the items did not land.
 *   3. Welcome page = Portal.aspx; left/top navigation nodes for the archive.
 *
 * Accessibility: the logo coral #FF5A3C gives only ~3:1 against white text,
 * below WCAG AA. The theme primary is darkened along the same hue until white
 * text reaches 4.5:1 (links, buttons, header bar); the logo image itself keeps
 * the original coral.
 *
 * Idempotent: re-running updates the page in place, re-applies theme/header
 * settings, re-uploads the logo only when missing, adds nav nodes only when
 * missing. Nothing is deleted — the original Viva Engage Home.aspx stays.
 *
 * Auth: same certificate + app as scripts/exo.cjs (Graph Sites.FullControl.All
 * + SharePoint Sites.FullControl.All, both application permissions).
 *
 *   node scripts/sharepoint-intranet-provision.cjs --dry-run
 *   node scripts/sharepoint-intranet-provision.cjs
 *   node scripts/sharepoint-intranet-provision.cjs --text-only   # skip Quick Links
 */

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { ClientCertificateCredential } = require('@azure/identity');
const sharp = require('sharp');

const TENANT = '11926da5-9d16-45e3-947b-27b2909ba6c5';
const CLIENT = '69535c9d-b933-4c4b-a39d-aee3e2ecf70a';
const CERT = '/var/www/vhosts/kalfa.me/beta/m365-auth/graph-cert.pem';

const SP_HOST = 'kalfarsvp.sharepoint.com';
const SITE_PATH = '/sites/allcompany';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const REST = `https://${SP_HOST}${SITE_PATH}/_api`;
const DRY_RUN = process.argv.includes('--dry-run');
const TEXT_ONLY = process.argv.includes('--text-only');

const PAGE_NAME = 'Portal.aspx';
const PAGE_TITLE = 'פורטל KALFA';
// SharePoint web title only (the Microsoft 365 group behind the site keeps its
// own name, "All Company", which is the Viva Engage community).
const SITE_TITLE = 'KALFA';
const LOGO_SVG = path.join(__dirname, '..', 'public', 'icons', 'icon.svg');
const LOGO_NAME = 'kalfa-logo.png';
const LOGO_CORAL = '#FF5A3C';
const THEME_NAME = 'KALFA Coral';

// Graph "Create sitePage" supported standard web part types (live docs, 2026-09-06).
const WEBPART_QUICK_LINKS = 'c70391ea-0b10-4ee9-b2b4-006d3fcad0cd';

// ─── Links ──────────────────────────────────────────────────────────────────

const ARCHIVE = `https://${SP_HOST}/sites/KALFARSVP`;
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

const NAV_NODES = [
  ['ארכיון חוזים', `${ARCHIVE}/Contracts`],
  ['הסכמי לקוחות', `${ARCHIVE}/CustomerAgreements`],
  ['יומן ביעור', `${ARCHIVE}/Lists/DispositionLog`],
  ['אתר הצוות KALFA RSVP', ARCHIVE],
];

// ─── Colour helpers (theme) ─────────────────────────────────────────────────

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (hex, target, t) => rgbToHex(hexToRgb(hex).map((v, i) => v + (hexToRgb(target)[i] - v) * t));
const lum = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

/** Darken the logo coral along its hue until white text reaches WCAG AA (4.5:1). */
function accessiblePrimary(base) {
  let c = base;
  let t = 0;
  while (contrast(c, '#ffffff') < 4.5 && t < 0.6) {
    t += 0.02;
    c = mix(base, '#000000', t);
  }
  return c;
}

function themePalette(primary) {
  return {
    themePrimary: primary,
    themeLighterAlt: mix(primary, '#ffffff', 0.95),
    themeLighter: mix(primary, '#ffffff', 0.85),
    themeLight: mix(primary, '#ffffff', 0.7),
    themeTertiary: mix(primary, '#ffffff', 0.45),
    themeSecondary: mix(primary, '#ffffff', 0.1),
    themeDarkAlt: mix(primary, '#000000', 0.1),
    themeDark: mix(primary, '#000000', 0.25),
    themeDarker: mix(primary, '#000000', 0.4),
    neutralLighterAlt: '#faf9f8',
    neutralLighter: '#f3f2f1',
    neutralLight: '#edebe9',
    neutralQuaternaryAlt: '#e1dfdd',
    neutralQuaternary: '#d0d0d0',
    neutralTertiaryAlt: '#c8c6c4',
    neutralTertiary: '#a19f9d',
    neutralSecondary: '#605e5c',
    neutralPrimaryAlt: '#3b3a39',
    neutralPrimary: '#323130',
    neutralDark: '#201f1e',
    black: '#000000',
    white: '#ffffff',
    primaryBackground: '#ffffff',
    primaryText: '#323130',
    disabledBackground: '#f3f2f1',
    disabledText: '#c8c6c4',
    error: '#a4262c',
  };
}

// ─── Page content ───────────────────────────────────────────────────────────

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const linkList = (items) =>
  `<ul>${items.map(([label, href]) => `<li><a href="${esc(href)}">${esc(label)}</a></li>`).join('')}</ul>`;

const HTML_INTRO = `<h2>פורטל פנימי — KALFA</h2><p>נקודת הכניסה לכל המערכות, לארכיון החוזים ולנהלים הקבועים. הארכיון עצמו יושב באתר הצוות KALFA RSVP; הדף הזה רק מצביע.</p>`;
const HTML_SYSTEMS = `<h3>מערכות</h3>${linkList(SYSTEMS)}`;
const HTML_ARCHIVE = `<h3>ארכיון חוזים</h3>${linkList(ARCHIVE_LINKS)}`;
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

// No @odata.type on web parts: the live create example omits it, and a PATCH
// carrying it on a standard web part fails with an OData "entity set" error.
const textPart = (html) => ({ id: randomUUID(), innerHtml: html });

/**
 * Quick Links standard web part. Shape taken from the live Graph/Q&A samples:
 * items[] with sourceItem{url,itemType:2}, thumbnailType 2 = icon (fabricReactIcon),
 * layoutId 'CompactCard' (icons, 48px) or 'List' (icon + description).
 * serverProcessedContent carries the links/texts SharePoint indexes and fixes up.
 */
function quickLinksPart(title, links, layoutId) {
  const items = links.map(([label, url, icon, description], i) => ({
    id: i + 1,
    title: label,
    description: description || '',
    altText: label,
    sourceItem: { url, itemType: 2, fileExtension: '', progId: '' },
    thumbnailType: 2,
    fabricReactIcon: { iconName: icon || 'Link' },
  }));
  const links_ = items.map((it, i) => ({ key: `items[${i}].sourceItem.url`, value: it.sourceItem.url }));
  const texts = [{ key: 'title', value: title }];
  items.forEach((it, i) => {
    texts.push({ key: `items[${i}].title`, value: it.title });
    if (it.description) texts.push({ key: `items[${i}].description`, value: it.description });
    texts.push({ key: `items[${i}].altText`, value: it.altText });
  });
  return {
    id: randomUUID(),
    webPartType: WEBPART_QUICK_LINKS,
    data: {
      title: 'Quick links',
      description: 'Quick links',
      dataVersion: '2.0',
      properties: {
        items,
        isMigrated: true,
        layoutId,
        shouldShowThumbnail: true,
        hideWebPartWhenEmpty: true,
        title,
        listLayoutOptions: { showDescription: layoutId === 'List', showIcon: true },
        buttonLayoutOptions: {
          showDescription: false,
          buttonTreatment: 2,
          iconPositionType: 2,
          textAlignmentVertical: 2,
          textAlignmentHorizontal: 2,
          linesOfText: 2,
        },
      },
      serverProcessedContent: { links: links_, searchablePlainTexts: texts },
    },
  };
}

function canvasLayout(useQuickLinks) {
  const systems = useQuickLinks ? quickLinksPart('מערכות', SYSTEMS, 'CompactCard') : textPart(HTML_SYSTEMS);
  const archive = useQuickLinks ? quickLinksPart('ארכיון חוזים', ARCHIVE_LINKS, 'List') : textPart(HTML_ARCHIVE);
  return {
    horizontalSections: [
      // Intro band on the theme colour — the team-site substitute for a Hero.
      { layout: 'oneColumn', id: '1', emphasis: 'strong', columns: [{ id: '1', width: 12, webparts: [textPart(HTML_INTRO)] }] },
      {
        layout: 'twoColumns',
        id: '2',
        emphasis: 'none',
        columns: [
          { id: '1', width: 6, webparts: [systems] },
          { id: '2', width: 6, webparts: [archive] },
        ],
      },
      // Procedures wide, calendar narrow — progressive disclosure per the design guidance.
      {
        layout: 'oneThirdRightColumn',
        id: '3',
        emphasis: 'soft',
        columns: [
          { id: '1', width: 8, webparts: [textPart(HTML_RULES)] },
          { id: '2', width: 4, webparts: [textPart(HTML_CALENDAR)] },
        ],
      },
    ],
  };
}

// ─── Clients ────────────────────────────────────────────────────────────────

const log = (...a) => console.log(...a);
const plan = (...a) => console.log(DRY_RUN ? '[dry-run]' : '[do]', ...a);

async function tokens() {
  const cred = new ClientCertificateCredential(TENANT, CLIENT, CERT);
  return {
    graph: (await cred.getToken('https://graph.microsoft.com/.default')).token,
    sp: (await cred.getToken(`https://${SP_HOST}/.default`)).token,
  };
}

function graphClient(token) {
  const call = async (method, p, body, contentType = 'application/json') => {
    const r = await fetch(GRAPH + p, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body: body == null ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
    });
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${json && json.error ? json.error.code + ': ' + json.error.message : text.slice(0, 300)}`);
    return json;
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    patch: (p, b) => call('PATCH', p, b),
    delete: (p) => call('DELETE', p),
    putBytes: (p, bytes, type) => call('PUT', p, bytes, type),
  };
}

function restClient(token) {
  const call = async (method, p, body, extra = {}) => {
    const r = await fetch(REST + p, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json;odata=nometadata',
        'Content-Type': 'application/json;odata=nometadata',
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!r.ok) {
      const msg = json && json['odata.error'] ? json['odata.error'].message.value : text.slice(0, 300);
      throw new Error(`REST ${method} ${p} -> ${r.status} ${msg}`);
    }
    return json;
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    merge: (p, b) => call('POST', p, b, { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' }),
  };
}

// ─── Steps: brand ───────────────────────────────────────────────────────────

async function ensureLogo(g, sp, siteId) {
  const findAssets = async () =>
    (await g.get(`/sites/${siteId}/lists?$select=id,displayName,webUrl,list&$top=200`)).value.find(
      (l) => l.list && l.list.template === 'documentLibrary' && /\/SiteAssets$/i.test(l.webUrl),
    );
  let assets = await findAssets();
  if (!assets) {
    // SharePoint creates Site Assets lazily; the REST method creates it on demand.
    plan('create Site Assets library (EnsureSiteAssetsLibrary)');
    if (DRY_RUN) {
      plan(`upload SiteAssets/${LOGO_NAME} and set site logo + thumbnail`);
      return;
    }
    const created = await sp.post('/web/lists/EnsureSiteAssetsLibrary');
    // Graph's list index lags a freshly created library; address it by the id
    // REST just returned and give the index a few seconds before giving up.
    for (let i = 0; i < 5 && !assets; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      assets = (await findAssets()) || (created && created.Id ? { id: created.Id } : null);
    }
    if (!assets) throw new Error('Site Assets library still missing after EnsureSiteAssetsLibrary');
  }
  const drive = await g.get(`/sites/${siteId}/lists/${assets.id}/drive?$select=id`);
  let exists = true;
  try {
    await g.get(`/drives/${drive.id}/root:/${LOGO_NAME}?$select=id`);
  } catch (e) {
    if (/-> 404/.test(e.message)) exists = false;
    else throw e;
  }
  if (!exists) {
    const png = await sharp(fs.readFileSync(LOGO_SVG)).resize(192, 192).png().toBuffer();
    plan(`upload SiteAssets/${LOGO_NAME} (${png.length} bytes, 192×192 from public/icons/icon.svg)`);
    if (!DRY_RUN) await g.putBytes(`/drives/${drive.id}/root:/${LOGO_NAME}:/content`, png, 'image/png');
  } else log(`  SiteAssets/${LOGO_NAME} exists`);

  const relative = `${SITE_PATH}/SiteAssets/${LOGO_NAME}`;
  const web = await sp.get('/web?$select=SiteLogoUrl');
  if (web.SiteLogoUrl && web.SiteLogoUrl.includes(LOGO_NAME)) {
    log('  site logo ok');
    return;
  }
  plan('set site logo + thumbnail →', relative);
  if (DRY_RUN) return;
  // aspect: 1 = logo, 0 = thumbnail; type 0 = web (siteiconmanager, live docs).
  await sp.post('/siteiconmanager/setsitelogo', { relativeLogoUrl: relative, type: 0, aspect: 1 });
  await sp.post('/siteiconmanager/setsitelogo', { relativeLogoUrl: relative, type: 0, aspect: 0 });
}

async function ensureTheme(sp) {
  const primary = accessiblePrimary(LOGO_CORAL);
  log(`  theme primary ${primary} (logo ${LOGO_CORAL}; contrast vs white ${contrast(primary, '#ffffff').toFixed(2)}:1)`);
  const themeJson = JSON.stringify({ isInverted: false, palette: themePalette(primary) });
  // ApplyTheme applies a TENANT theme by name (live docs: "apply tenant theme to
  // site"). Applying a name that is not in the tenant catalog updated the
  // classic ThemeData but left the modern engine on the default Teal
  // (verified 2026-09-06 via window.__themeState__). So: register/update the
  // tenant theme first, then apply it.
  let inCatalog = false;
  try {
    const opts = await sp.post('/thememanager/GetTenantThemingOptions');
    inCatalog = (opts.themePreviews || []).some((t) => t.name === THEME_NAME);
  } catch (e) {
    log('  theming options unreadable:', e.message.slice(0, 120));
  }
  plan(`${inCatalog ? 'update' : 'add'} tenant theme "${THEME_NAME}", then apply it to this site`);
  if (DRY_RUN) return;
  await sp.post(`/thememanager/${inCatalog ? 'UpdateTenantTheme' : 'AddTenantTheme'}`, { name: THEME_NAME, themeJson });
  await sp.post('/thememanager/ApplyTheme', { name: THEME_NAME, themeJson });
}

async function ensureSiteTitle(sp) {
  const web = await sp.get('/web?$select=Title');
  if (web.Title === SITE_TITLE) {
    log('  site title ok:', SITE_TITLE);
    return;
  }
  plan(`site title "${web.Title}" → "${SITE_TITLE}"`);
  if (!DRY_RUN) await sp.merge('/web', { Title: SITE_TITLE });
}

async function ensureHeaderAndNav(sp) {
  // HeaderLayout: 0 Standard, 1 Compact, 2 Minimal, 3 Extended. HeaderEmphasis: 0 None, 1 Neutral, 2 Soft, 3 Strong.
  const want = { HeaderLayout: 1, HeaderEmphasis: 3, HorizontalQuickLaunch: true, MegaMenuEnabled: false };
  let current;
  try {
    current = await sp.get('/web?$select=HeaderLayout,HeaderEmphasis,HorizontalQuickLaunch,MegaMenuEnabled');
  } catch (e) {
    log('  header/nav settings unavailable via REST:', e.message);
    return;
  }
  const diff = Object.entries(want).filter(([k, v]) => current[k] !== v);
  if (!diff.length) {
    log('  header/nav ok (Compact, Strong, horizontal)');
    return;
  }
  plan('header/nav:', diff.map(([k, v]) => `${k}=${v}`).join(' '));
  if (!DRY_RUN) await sp.merge('/web', Object.fromEntries(diff));
}

// ─── Steps: page ────────────────────────────────────────────────────────────

async function pageByName(g, siteId) {
  const pages = (await g.get(`/sites/${siteId}/pages/microsoft.graph.sitePage?$select=id,name,title,publishingState`)).value;
  return pages.find((p) => p.name === PAGE_NAME) || null;
}

async function writePage(g, siteId, useQuickLinks) {
  const existing = await pageByName(g, siteId);
  const canvas = canvasLayout(useQuickLinks);
  let pageId = existing ? existing.id : null;
  const createBody = {
    '@odata.type': '#microsoft.graph.sitePage',
    name: PAGE_NAME,
    title: PAGE_TITLE,
    pageLayout: 'home',
    showComments: false,
    showRecommendedPages: false,
    canvasLayout: canvas,
  };
  if (existing && useQuickLinks) {
    // PATCH keeps text web parts but silently drops standard web parts (verified
    // 2026-09-06: a probe page CREATED with Quick Links stored them intact, the
    // same payload on PATCH did not). The portal page is generated entirely by
    // this script, so recreate it instead of updating in place.
    plan(`recreate page ${PAGE_NAME} (quick links need a fresh create)`);
    if (!DRY_RUN) {
      await g.delete(`/sites/${siteId}/pages/${pageId}`);
      pageId = (await g.post(`/sites/${siteId}/pages`, createBody)).id;
    }
  } else if (existing) {
    plan(`update page ${PAGE_NAME} (text lists)`);
    if (!DRY_RUN) {
      await g.patch(`/sites/${siteId}/pages/${pageId}/microsoft.graph.sitePage`, {
        '@odata.type': '#microsoft.graph.sitePage',
        title: PAGE_TITLE,
        canvasLayout: canvas,
      });
    }
  } else {
    plan(`create page ${PAGE_NAME} (${useQuickLinks ? 'quick links' : 'text lists'})`);
    if (!DRY_RUN) pageId = (await g.post(`/sites/${siteId}/pages`, createBody)).id;
  }
  return pageId;
}

/** True when both Quick Links web parts came back with a flat items array of the expected size. */
async function quickLinksLanded(g, siteId, pageId) {
  const wps = (await g.get(`/sites/${siteId}/pages/${pageId}/microsoft.graph.sitePage/webparts`)).value;
  const ql = wps.filter((w) => w.webPartType === WEBPART_QUICK_LINKS);
  const sizes = ql.map((w) => (Array.isArray(w.data && w.data.properties && w.data.properties.items) ? w.data.properties.items.length : -1)).sort((a, b) => a - b);
  log(`  stored web parts: ${wps.length} total, ${ql.length} quick links, item counts [${sizes.join(', ')}]`);
  if (ql.length !== 2) return false;
  return sizes[0] === Math.min(SYSTEMS.length, ARCHIVE_LINKS.length) && sizes[1] === Math.max(SYSTEMS.length, ARCHIVE_LINKS.length);
}

async function ensurePage(g, siteId) {
  let useQuickLinks = !TEXT_ONLY;
  let pageId = await writePage(g, siteId, useQuickLinks);
  if (!DRY_RUN && useQuickLinks) {
    let ok = false;
    try {
      ok = await quickLinksLanded(g, siteId, pageId);
    } catch (e) {
      log('  quick links verification failed:', e.message);
    }
    if (!ok) {
      log('  Quick Links did not land as expected (known Graph bug) — falling back to text lists');
      useQuickLinks = false;
      pageId = await writePage(g, siteId, false);
    } else log('  quick links verified (items intact)');
  }
  if (!DRY_RUN && !pageId) throw new Error('page write failed');
  plan(`publish ${PAGE_NAME}`);
  if (!DRY_RUN && pageId) await g.post(`/sites/${siteId}/pages/${pageId}/microsoft.graph.sitePage/publish`);
  return pageId;
}

async function ensureWelcomePage(sp) {
  const root = await sp.get('/web/rootfolder?$select=WelcomePage');
  const want = `SitePages/${PAGE_NAME}`;
  if (root.WelcomePage === want) {
    log('  welcome page ok:', want);
    return;
  }
  plan(`set welcome page ${root.WelcomePage || '(none)'} → ${want}`);
  if (!DRY_RUN) await sp.merge('/web/rootfolder', { WelcomePage: want });
}

async function ensureNavigation(sp) {
  const nodes = (await sp.get('/web/Navigation/QuickLaunch?$select=Id,Title,Url')).value;
  for (const [title, url] of NAV_NODES) {
    if (nodes.some((n) => n.Title === title)) {
      log('  nav exists:', title);
      continue;
    }
    plan(`add nav node "${title}"`);
    if (!DRY_RUN) await sp.post('/web/Navigation/QuickLaunch', { Title: title, Url: url, IsExternal: true });
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  log(DRY_RUN ? '== DRY RUN — no writes ==' : '== PROVISION ==');
  const t = await tokens();
  const g = graphClient(t.graph);
  const sp = restClient(t.sp);
  const site = await g.get(`/sites/${SP_HOST}:${SITE_PATH}?$select=id,displayName,webUrl`);
  log('site:', site.displayName, site.webUrl);

  log('\n[1] logo (Site Assets + siteiconmanager)');
  await ensureLogo(g, sp, site.id);

  log('\n[2] theme (thememanager/ApplyTheme)');
  await ensureTheme(sp);

  log('\n[3] site title, header + navigation style (_api/web)');
  await ensureSiteTitle(sp);
  await ensureHeaderAndNav(sp);

  log('\n[4] portal page (Graph)');
  await ensurePage(g, site.id);

  log('\n[5] welcome page (REST)');
  await ensureWelcomePage(sp);

  log('\n[6] navigation nodes (REST)');
  await ensureNavigation(sp);

  log('\ndone.', DRY_RUN ? 'Re-run without --dry-run to apply.' : `Open: ${site.webUrl}/SitePages/${PAGE_NAME}`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
