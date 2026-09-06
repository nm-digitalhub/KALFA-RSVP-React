/*
 * Shared SharePoint / Graph helpers for the provisioning scripts
 * (scripts/sharepoint-archive-provision.cjs, scripts/sharepoint-intranet-provision.cjs).
 *
 * App-only auth with the KALFA-RSVP app certificate (same as scripts/exo.cjs):
 * Graph Sites.FullControl.All + SharePoint Sites.FullControl.All. Every write
 * helper is idempotent and honours `dryRun`. Nothing here deletes archive
 * content; the only delete is a page this code generated itself (recreate).
 *
 * Verified 2026-09-06 against the live tenant + Microsoft docs:
 *   - thememanager/ApplyTheme applies a TENANT theme by name → register it first.
 *   - Graph PATCH on a sitePage drops standard web parts → recreate the page.
 *   - Graph create supports Quick Links (c70391ea-…) with the PnP item shape.
 *   - Site Assets is created lazily (EnsureSiteAssetsLibrary); Graph's list
 *     index lags a few seconds behind.
 */

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');

const { ClientCertificateCredential } = require('@azure/identity');
const sharp = require('sharp');

const TENANT = '11926da5-9d16-45e3-947b-27b2909ba6c5';
const CLIENT = '69535c9d-b933-4c4b-a39d-aee3e2ecf70a';
const CERT = '/var/www/vhosts/kalfa.me/beta/m365-auth/graph-cert.pem';
const GRAPH = 'https://graph.microsoft.com/v1.0';

const WEBPART_QUICK_LINKS = 'c70391ea-0b10-4ee9-b2b4-006d3fcad0cd';

// ─── Auth + clients ─────────────────────────────────────────────────────────

async function tokens(host) {
  const cred = new ClientCertificateCredential(TENANT, CLIENT, CERT);
  return {
    graph: (await cred.getToken('https://graph.microsoft.com/.default')).token,
    sp: (await cred.getToken(`https://${host}/.default`)).token,
  };
}

function graphClient(token) {
  const call = async (method, p, body, contentType = 'application/json') => {
    const r = await fetch(p.startsWith('http') ? p : GRAPH + p, {
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
    if (!r.ok) {
      const err = new Error(`${method} ${p} -> ${r.status} ${json && json.error ? json.error.code + ': ' + json.error.message : text.slice(0, 300)}`);
      err.status = r.status;
      throw err;
    }
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

function restClient(token, restBase) {
  const call = async (method, p, body, extra = {}) => {
    const r = await fetch(restBase + p, {
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
      const err = new Error(`REST ${method} ${p} -> ${r.status} ${msg}`);
      err.status = r.status;
      throw err;
    }
    return json;
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    merge: (p, b) => call('POST', p, b, { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' }),
  };
}

/** One call: tokens + both clients + the Graph site object for host:path. */
async function connect({ host, sitePath }) {
  const t = await tokens(host);
  const g = graphClient(t.graph);
  const sp = restClient(t.sp, `https://${host}${sitePath}/_api`);
  const site = await g.get(`/sites/${host}:${sitePath}?$select=id,displayName,webUrl`);
  return { g, sp, site };
}

// ─── Colour / theme ─────────────────────────────────────────────────────────

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

/** Darken along the hue until white text reaches WCAG AA (4.5:1). */
function accessiblePrimary(base) {
  let c = base;
  let t = 0;
  while (contrast(c, '#ffffff') < 4.5 && t < 0.6) {
    t += 0.02;
    c = mix(base, '#000000', t);
  }
  return c;
}

/** Fluent-style palette (the legacy themeJson shape from the theming REST docs). */
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

// ─── Brand steps (REST) ─────────────────────────────────────────────────────

/** Register (or update) the tenant theme and apply it to this site. */
async function ensureTheme(sp, { name, primary, log, plan, dryRun }) {
  const themeJson = JSON.stringify({ isInverted: false, palette: themePalette(primary) });
  let inCatalog = false;
  try {
    const opts = await sp.post('/thememanager/GetTenantThemingOptions');
    inCatalog = (opts.themePreviews || []).some((t) => t.name === name);
  } catch (e) {
    log('  theming options unreadable:', e.message.slice(0, 120));
  }
  plan(`${inCatalog ? 'update' : 'add'} tenant theme "${name}" (primary ${primary}, ${contrast(primary, '#ffffff').toFixed(2)}:1 vs white), then apply it`);
  if (dryRun) return;
  await sp.post(`/thememanager/${inCatalog ? 'UpdateTenantTheme' : 'AddTenantTheme'}`, { name, themeJson });
  await sp.post('/thememanager/ApplyTheme', { name, themeJson });
}

/** Render an SVG to PNG, upload to Site Assets, set as site logo + thumbnail. */
async function ensureLogo(g, sp, { siteId, sitePath, svgPath, fileName, size = 192, log, plan, dryRun }) {
  const findAssets = async () =>
    (await g.get(`/sites/${siteId}/lists?$select=id,displayName,webUrl,list&$top=200`)).value.find(
      (l) => l.list && l.list.template === 'documentLibrary' && /\/SiteAssets$/i.test(l.webUrl),
    );
  let assets = await findAssets();
  if (!assets) {
    plan('create Site Assets library (EnsureSiteAssetsLibrary)');
    if (dryRun) {
      plan(`upload SiteAssets/${fileName} and set site logo + thumbnail`);
      return;
    }
    const created = await sp.post('/web/lists/EnsureSiteAssetsLibrary');
    for (let i = 0; i < 5 && !assets; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      assets = (await findAssets()) || (created && created.Id ? { id: created.Id } : null);
    }
    if (!assets) throw new Error('Site Assets library still missing after EnsureSiteAssetsLibrary');
  }
  const drive = await g.get(`/sites/${siteId}/lists/${assets.id}/drive?$select=id`);
  let exists = true;
  try {
    await g.get(`/drives/${drive.id}/root:/${fileName}?$select=id`);
  } catch (e) {
    if (e.status === 404) exists = false;
    else throw e;
  }
  if (!exists) {
    const png = await sharp(fs.readFileSync(svgPath)).resize(size, size).png().toBuffer();
    plan(`upload SiteAssets/${fileName} (${png.length} bytes, ${size}×${size})`);
    if (!dryRun) await g.putBytes(`/drives/${drive.id}/root:/${fileName}:/content`, png, 'image/png');
  } else log(`  SiteAssets/${fileName} exists`);

  const relative = `${sitePath}/SiteAssets/${fileName}`;
  const web = await sp.get('/web?$select=SiteLogoUrl');
  if (web.SiteLogoUrl && web.SiteLogoUrl.includes(fileName)) {
    log('  site logo ok');
    return;
  }
  plan('set site logo + thumbnail →', relative);
  if (dryRun) return;
  // siteiconmanager: aspect 1 = logo, 0 = thumbnail; type 0 = web.
  await sp.post('/siteiconmanager/setsitelogo', { relativeLogoUrl: relative, type: 0, aspect: 1 });
  await sp.post('/siteiconmanager/setsitelogo', { relativeLogoUrl: relative, type: 0, aspect: 0 });
}

async function ensureSiteTitle(sp, { title, log, plan, dryRun }) {
  const web = await sp.get('/web?$select=Title');
  if (web.Title === title) {
    log('  site title ok:', title);
    return;
  }
  plan(`site title "${web.Title}" → "${title}"`);
  if (!dryRun) await sp.merge('/web', { Title: title });
}

/** HeaderLayout 0 Standard/1 Compact/2 Minimal/3 Extended; HeaderEmphasis 0 None/1 Neutral/2 Soft/3 Strong. */
async function ensureHeaderAndNav(sp, { want, log, plan, dryRun }) {
  const keys = Object.keys(want).join(',');
  let current;
  try {
    current = await sp.get(`/web?$select=${keys}`);
  } catch (e) {
    log('  header/nav settings unavailable via REST:', e.message);
    return;
  }
  const diff = Object.entries(want).filter(([k, v]) => current[k] !== v);
  if (!diff.length) {
    log('  header/nav ok');
    return;
  }
  plan('header/nav:', diff.map(([k, v]) => `${k}=${v}`).join(' '));
  if (!dryRun) await sp.merge('/web', Object.fromEntries(diff));
}

async function ensureWelcomePage(sp, { pageName, log, plan, dryRun }) {
  const root = await sp.get('/web/rootfolder?$select=WelcomePage');
  const want = `SitePages/${pageName}`;
  if (root.WelcomePage === want) {
    log('  welcome page ok:', want);
    return;
  }
  plan(`set welcome page ${root.WelcomePage || '(none)'} → ${want}`);
  if (!dryRun) await sp.merge('/web/rootfolder', { WelcomePage: want });
}

/** Add QuickLaunch nodes by title (skips existing titles). */
async function ensureNavigation(sp, { nodes, log, plan, dryRun }) {
  let existing;
  try {
    existing = (await sp.get('/web/Navigation/QuickLaunch?$select=Id,Title,Url')).value;
  } catch (e) {
    log('  REST navigation unavailable -', e.message);
    return;
  }
  for (const [title, url] of nodes) {
    if (existing.some((n) => n.Title === title)) {
      log('  nav exists:', title);
      continue;
    }
    plan(`add nav node "${title}"`);
    if (!dryRun) await sp.post('/web/Navigation/QuickLaunch', { Title: title, Url: url, IsExternal: true });
  }
}

// ─── Page building (Graph) ──────────────────────────────────────────────────

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const linkList = (items) =>
  `<ul>${items.map(([label, href]) => `<li><a href="${esc(href)}">${esc(label)}</a></li>`).join('')}</ul>`;

// No @odata.type on web parts: the live create example omits it, and a PATCH
// carrying it on a standard web part fails with an OData "entity set" error.
const textPart = (html) => ({ id: randomUUID(), innerHtml: html });

/**
 * Quick Links standard web part. Shape = what PnP / the Graph Q&A samples send
 * and what the tenant stored intact on create: items[] with sourceItem{url,
 * itemType:2}, thumbnailType 2 = Fluent icon, layoutId 'CompactCard' | 'List'.
 * links: [label, url, fluentIcon, description]
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
  const spLinks = items.map((it, i) => ({ key: `items[${i}].sourceItem.url`, value: it.sourceItem.url }));
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
      serverProcessedContent: { links: spLinks, searchablePlainTexts: texts },
    },
  };
}

const section = (id, layout, emphasis, columns) => ({ id: String(id), layout, emphasis, columns });
const column = (id, width, webparts) => ({ id: String(id), width, webparts });

async function findPage(g, siteId, name) {
  const pages = (await g.get(`/sites/${siteId}/pages/microsoft.graph.sitePage?$select=id,name,title,publishingState`)).value;
  return pages.find((p) => p.name === name) || null;
}

/**
 * Create or replace a page. `build(useQuickLinks)` returns the canvasLayout.
 * With quick links the page is recreated (Graph PATCH drops standard web
 * parts); afterwards the stored quick-links item counts are verified against
 * `expectedQuickLinkCounts` and, on mismatch, the page is rewritten with the
 * text fallback. Returns the page id.
 */
async function ensurePage(g, { siteId, name, title, pageLayout = 'home', build, expectedQuickLinkCounts, textOnly, log, plan, dryRun }) {
  const write = async (useQuickLinks) => {
    const existing = await findPage(g, siteId, name);
    const canvas = build(useQuickLinks);
    const createBody = {
      '@odata.type': '#microsoft.graph.sitePage',
      name,
      title,
      pageLayout,
      showComments: false,
      showRecommendedPages: false,
      canvasLayout: canvas,
    };
    let pageId = existing ? existing.id : null;
    if (existing && useQuickLinks) {
      plan(`recreate page ${name} (quick links need a fresh create)`);
      if (!dryRun) {
        await g.delete(`/sites/${siteId}/pages/${pageId}`);
        pageId = (await g.post(`/sites/${siteId}/pages`, createBody)).id;
      }
    } else if (existing) {
      plan(`update page ${name} (text lists)`);
      if (!dryRun) {
        await g.patch(`/sites/${siteId}/pages/${pageId}/microsoft.graph.sitePage`, {
          '@odata.type': '#microsoft.graph.sitePage',
          title,
          canvasLayout: canvas,
        });
      }
    } else {
      plan(`create page ${name} (${useQuickLinks ? 'quick links' : 'text lists'})`);
      if (!dryRun) pageId = (await g.post(`/sites/${siteId}/pages`, createBody)).id;
    }
    return pageId;
  };

  let useQuickLinks = !textOnly;
  let pageId = await write(useQuickLinks);
  if (!dryRun && useQuickLinks) {
    const wps = (await g.get(`/sites/${siteId}/pages/${pageId}/microsoft.graph.sitePage/webparts`)).value;
    const ql = wps.filter((w) => w.webPartType === WEBPART_QUICK_LINKS);
    const sizes = ql.map((w) => (Array.isArray(w.data && w.data.properties && w.data.properties.items) ? w.data.properties.items.length : -1)).sort((a, b) => a - b);
    const want = [...expectedQuickLinkCounts].sort((a, b) => a - b);
    log(`  stored web parts: ${wps.length} total, ${ql.length} quick links, item counts [${sizes.join(', ')}]`);
    if (sizes.join(',') !== want.join(',')) {
      log('  Quick Links did not land as expected — falling back to text lists');
      useQuickLinks = false;
      pageId = await write(false);
    } else log('  quick links verified (items intact)');
  }
  if (!dryRun && !pageId) throw new Error('page write failed');
  plan(`publish ${name}`);
  if (!dryRun && pageId) await g.post(`/sites/${siteId}/pages/${pageId}/microsoft.graph.sitePage/publish`);
  return pageId;
}

module.exports = {
  GRAPH,
  WEBPART_QUICK_LINKS,
  connect,
  tokens,
  graphClient,
  restClient,
  accessiblePrimary,
  contrast,
  themePalette,
  ensureTheme,
  ensureLogo,
  ensureSiteTitle,
  ensureHeaderAndNav,
  ensureWelcomePage,
  ensureNavigation,
  esc,
  linkList,
  textPart,
  quickLinksPart,
  section,
  column,
  findPage,
  ensurePage,
};
