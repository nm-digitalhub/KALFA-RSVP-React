#!/usr/bin/env node
/*
 * SharePoint contracts archive — file plan as code.
 *
 * Provisions the KALFA RSVP site archive described in
 * docs/sharepoint-contracts-archive-plan-2026-09-06.md:
 *   - site columns + site content type "Contract"
 *   - three document libraries: Contracts, Contracts-Working, Customer-Agreements
 *   - the folder skeleton in each library
 *   - the Disposition-Log list
 *   - library settings (content types on, major versioning, 50 versions), the
 *     Contract content type attached + first in order, and the archive views
 *     (SharePoint REST — Graph has no API for these)
 *
 * Idempotent: every step checks before it creates, so re-running after a
 * partial failure is safe. Nothing is ever deleted or renamed by this script.
 *
 * Auth: app-only, the same certificate + app registration scripts/exo.cjs uses
 * (Graph application permissions include Sites.FullControl.All, verified
 * 2026-09-06). SharePoint REST gets its own token for the SharePoint audience.
 *
 *   node scripts/sharepoint-archive-provision.cjs --dry-run   # print the plan, no writes
 *   node scripts/sharepoint-archive-provision.cjs             # provision
 */

const { ClientCertificateCredential } = require('@azure/identity');

const TENANT = '11926da5-9d16-45e3-947b-27b2909ba6c5';
const CLIENT = '69535c9d-b933-4c4b-a39d-aee3e2ecf70a';
const CERT = '/var/www/vhosts/kalfa.me/beta/m365-auth/graph-cert.pem';

const SP_HOST = 'kalfarsvp.sharepoint.com';
const SITE_PATH = '/sites/KALFARSVP';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const REST = `https://${SP_HOST}${SITE_PATH}/_api`;

const DRY_RUN = process.argv.includes('--dry-run');
const YEAR = new Date().getFullYear().toString();

// ─── File plan ──────────────────────────────────────────────────────────────

// Site columns shared by the three libraries through the "Contract" content
// type. Internal names are ASCII (stable in URLs/CAML); display names are the
// Hebrew labels the owner sees.
const SITE_COLUMNS = [
  { name: 'Counterparty', displayName: 'צד שני', text: { maxLength: 255 } },
  {
    name: 'ContractType',
    displayName: 'סוג מסמך',
    choice: {
      allowTextEntry: false,
      displayAs: 'dropDownMenu',
      choices: [
        'MSA',
        'Terms',
        'DPA',
        'Order',
        'Amendment',
        'NDA',
        'License',
        'Insurance',
        'Lease',
        'Customer-Agreement',
        'Policy',
        'Other',
      ],
    },
  },
  { name: 'EffectiveDate', displayName: 'תאריך חתימה/תחילה', dateTime: { format: 'dateOnly', displayAs: 'default' } },
  { name: 'ExpiryDate', displayName: 'תאריך סיום', dateTime: { format: 'dateOnly', displayAs: 'default' } },
  {
    name: 'Status',
    displayName: 'סטטוס',
    choice: { allowTextEntry: false, displayAs: 'dropDownMenu', choices: ['Active', 'Expired', 'Terminated', 'Superseded'] },
    defaultValue: { value: 'Active' },
  },
  { name: 'RetentionUntil', displayName: 'שימור עד', dateTime: { format: 'dateOnly', displayAs: 'default' } },
  { name: 'ExternalRef', displayName: 'מזהה חיצוני', text: { maxLength: 255 } },
  { name: 'SHA256', displayName: 'SHA-256', text: { maxLength: 64 } },
  {
    name: 'DataClass',
    displayName: 'סיווג מידע',
    choice: { allowTextEntry: false, displayAs: 'dropDownMenu', choices: ['Internal', 'Confidential', 'Personal-Data'] },
    defaultValue: { value: 'Confidential' },
  },
  // File name of the executed document this one amends (Graph cannot create a
  // hyperlink column — 400 invalidRequest, verified 2026-09-06 — so plain text).
  { name: 'Amends', displayName: 'מתקן את', text: { maxLength: 255 } },
  // Legal hold: a pending proceeding or an authority's demand freezes disposition
  // regardless of RetentionUntil (compliance advice 2026-09-06, §4). No default:
  // empty means "not held" and the views treat it as such.
  { name: 'LegalHold', displayName: 'הקפאה משפטית', boolean: {} },
  { name: 'ArchiveNotes', displayName: 'הערות ארכיון', text: { allowMultipleLines: true, linesForEditing: 6, textType: 'plain' } },
];

// Graph's "Create contentType" takes the parent as `base` (name + id), not
// `parentId` — the latter fails with "Missing or incorrect ParentId".
const CONTENT_TYPE = {
  name: 'Contract',
  description: 'חוזה או מסמך משפטי בארכיון KALFA — עמודות השימור המשותפות',
  group: 'KALFA Archive',
  base: { name: 'Document', id: '0x0101' },
};

const VENDORS = [
  'Meta',
  'Voximplant',
  'ElevenLabs',
  'SUMIT',
  'Supabase',
  'Microsoft',
  'IONOS',
  'Resend',
  'Google',
  'ExtrA',
  'Accountant',
  'Insurance',
];

const LIBRARIES = [
  {
    displayName: 'Contracts',
    description: 'חוזים חתומים של העסק — ארכיון הרשומה. רק גרסאות סופיות חתומות. טיוטות ב-Contracts-Working.',
    folders: [
      ...VENDORS.map((v) => `01-Vendors/${v}`),
      '02-Corporate',
      '03-Legal-Templates/Customer-Agreement',
      '03-Legal-Templates/Terms-of-Service',
      '03-Legal-Templates/Privacy-Policy',
    ],
    views: true,
    readme: true,
  },
  {
    displayName: 'Contracts-Working',
    description: 'טיוטות, גרסאות במו"מ ומסמכי עבודה. לא רשומות ארכיון. הגרסה החתומה עוברת ל-Contracts.',
    folders: ['01-Vendors', '02-Corporate', '03-Legal-Templates'],
    views: false,
    readme: false,
  },
  {
    displayName: 'Customer-Agreements',
    description: 'עותקי ארכיון (PDF בלבד) של הסכמי לקוחות שנחתמו במערכת. מערכת הרשומה: Supabase signed_agreements. מידע אישי — בעלים בלבד.',
    folders: [YEAR],
    views: true,
    readme: false,
  },
];

const DISPOSITION_LOG = {
  displayName: 'Disposition-Log',
  description: 'יומן ביעור: כל רשומה שנמחקה מהארכיון בתום תקופת השימור, מה נמחק, מתי, למה ומי אישר.',
  columns: [
    {
      name: 'Library',
      displayName: 'ספרייה',
      choice: { allowTextEntry: false, displayAs: 'dropDownMenu', choices: ['Contracts', 'Customer-Agreements', 'Contracts-Working'] },
    },
    { name: 'DisposedAt', displayName: 'תאריך ביעור', dateTime: { format: 'dateOnly', displayAs: 'default' } },
    { name: 'RetentionUntil', displayName: 'שימור עד (כפי שנרשם)', dateTime: { format: 'dateOnly', displayAs: 'default' } },
    {
      name: 'Reason',
      displayName: 'עילה',
      choice: {
        allowTextEntry: false,
        displayAs: 'dropDownMenu',
        choices: ['Retention-expired', 'Superseded', 'Duplicate', 'Legal-request', 'Data-subject-request'],
      },
    },
    { name: 'DisposedBy', displayName: 'בוצע על ידי', text: { maxLength: 255 } },
    // Record id + agreement version (never a name or phone): the log itself
    // must stay PII-free and is kept at least 24 months.
    { name: 'RecordRef', displayName: 'מזהה רשומה / גרסה', text: { maxLength: 255 } },
    { name: 'SHA256', displayName: 'SHA-256 לפני מחיקה', text: { maxLength: 64 } },
    { name: 'Notes', displayName: 'הערות', text: { allowMultipleLines: true, linesForEditing: 6, textType: 'plain' } },
  ],
};

// Views created through SharePoint REST (Graph cannot create views).
// Due = retention date passed AND not under legal hold (a null LegalHold is
// "not held": Neq against 1 matches both 0 and empty).
const DUE_QUERY = `<Where><And><Leq><FieldRef Name='RetentionUntil'/><Value Type='DateTime'><Today/></Value></Leq><Neq><FieldRef Name='LegalHold'/><Value Type='Boolean'>1</Value></Neq></And></Where><OrderBy><FieldRef Name='RetentionUntil'/></OrderBy>`;
const VIEWS = {
  Contracts: [
    {
      title: 'Active',
      query: `<Where><Eq><FieldRef Name='Status'/><Value Type='Choice'>Active</Value></Eq></Where><OrderBy><FieldRef Name='Counterparty'/></OrderBy>`,
      fields: ['DocIcon', 'LinkFilename', 'Counterparty', 'ContractType', 'EffectiveDate', 'ExpiryDate', 'RetentionUntil', 'DataClass'],
    },
    {
      title: 'Expiring-90d',
      query: `<Where><And><Eq><FieldRef Name='Status'/><Value Type='Choice'>Active</Value></Eq><Leq><FieldRef Name='ExpiryDate'/><Value Type='DateTime'><Today OffsetDays='90'/></Value></Leq></And></Where><OrderBy><FieldRef Name='ExpiryDate'/></OrderBy>`,
      fields: ['DocIcon', 'LinkFilename', 'Counterparty', 'ContractType', 'ExpiryDate', 'Status'],
    },
    {
      title: 'Due-for-disposition',
      query: DUE_QUERY,
      fields: ['DocIcon', 'LinkFilename', 'Counterparty', 'ContractType', 'ExpiryDate', 'RetentionUntil', 'LegalHold', 'SHA256'],
    },
    {
      title: 'Legal-Hold',
      query: `<Where><Eq><FieldRef Name='LegalHold'/><Value Type='Boolean'>1</Value></Eq></Where>`,
      fields: ['DocIcon', 'LinkFilename', 'Counterparty', 'ContractType', 'RetentionUntil', 'ArchiveNotes'],
    },
  ],
  'Customer-Agreements': [
    {
      title: 'Due-for-disposition',
      query: DUE_QUERY,
      fields: ['DocIcon', 'LinkFilename', 'EffectiveDate', 'ExternalRef', 'RetentionUntil', 'LegalHold', 'SHA256'],
    },
    {
      title: 'Legal-Hold',
      query: `<Where><Eq><FieldRef Name='LegalHold'/><Value Type='Boolean'>1</Value></Eq></Where>`,
      fields: ['DocIcon', 'LinkFilename', 'EffectiveDate', 'ExternalRef', 'RetentionUntil', 'ArchiveNotes'],
    },
  ],
};

// Left navigation of the archive site: the libraries are otherwise reachable
// only through "Site contents" — the site's own nav showed just Documents.
const NAV_NODES = [
  ['Contracts — חוזים חתומים', `https://${SP_HOST}${SITE_PATH}/Contracts`],
  ['Contracts-Working — טיוטות', `https://${SP_HOST}${SITE_PATH}/ContractsWorking`],
  ['Customer-Agreements — הסכמי לקוחות', `https://${SP_HOST}${SITE_PATH}/CustomerAgreements`],
  ['Disposition-Log — יומן ביעור', `https://${SP_HOST}${SITE_PATH}/Lists/DispositionLog`],
  ['פורטל KALFA', `https://${SP_HOST}/sites/allcompany`],
];

// Columns added to the default "All Documents" view of each library.
const DEFAULT_VIEW_FIELDS = ['Counterparty', 'ContractType', 'EffectiveDate', 'ExpiryDate', 'Status', 'RetentionUntil', 'DataClass'];

const README = `# כללי הארכיון — Contracts

מסמך התכנון המלא: docs/sharepoint-contracts-archive-plan-2026-09-06.md במאגר הקוד.

1. רשומה אחת, מקום אחד: חוזה חתום קיים רק כאן. טיוטות ומו"מ ב-Contracts-Working בלבד.
2. אי-שינוי: PDF חתום לא נערך לעולם. תיקון = קובץ חדש, עם "מתקן את" שמצביע על הקובץ המקורי.
3. שם קובץ: YYYY-MM-DD_<Counterparty>_<DocType>_v<N>_<status>.pdf — תאריך החתימה (לא ההעלאה), ASCII בלבד, "_" בין שדות, "-" בתוך שדה.
4. בקליטה ממלאים: צד שני, סוג מסמך, תאריך חתימה, תאריך סיום, שימור עד, SHA-256, סיווג מידע.
5. שימור עד = 31 בדצמבר של שנת סיום החוזה + 7 שנים (הסכמי לקוחות: שנת המס של האירוע). ביעור רק דרך התצוגה "Due-for-disposition", אחרי בדיקת "הקפאה משפטית", ועם רישום ב-Disposition-Log.
7. הקפאה משפטית (LegalHold) עוצרת ביעור בלי קשר לתאריך השימור. מסירים אותה רק בכתב.
6. עומק תיקיות: קטגוריה / צד שני. בלי תיקיות שנה, בלי תיקיות "פעיל/סגור" — סטטוס הוא מטא-דאטה.
`;

// ─── Helpers ────────────────────────────────────────────────────────────────

const log = (...a) => console.log(...a);
const plan = (...a) => console.log(DRY_RUN ? '[dry-run]' : '[do]', ...a);

async function tokens() {
  const cred = new ClientCertificateCredential(TENANT, CLIENT, CERT);
  const graph = (await cred.getToken('https://graph.microsoft.com/.default')).token;
  const sp = (await cred.getToken(`https://${SP_HOST}/.default`)).token;
  return { graph, sp };
}

function graphClient(token) {
  const call = async (method, path, body) => {
    const r = await fetch(path.startsWith('http') ? path : GRAPH + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    const json = text ? JSON.parse(text) : null;
    if (!r.ok) {
      const err = new Error(`${method} ${path} -> ${r.status} ${json && json.error ? json.error.code + ': ' + json.error.message : text}`);
      err.status = r.status;
      err.code = json && json.error ? json.error.code : null;
      throw err;
    }
    return json;
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    patch: (p, b) => call('PATCH', p, b),
    put: async (p, bytes, contentType) => {
      const r = await fetch(GRAPH + p, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
        body: bytes,
      });
      if (!r.ok) throw new Error(`PUT ${p} -> ${r.status} ${await r.text()}`);
      return r.json();
    },
  };
}

function restClient(token) {
  const call = async (method, path, body, extraHeaders = {}) => {
    const r = await fetch(REST + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json;odata=nometadata',
        'Content-Type': 'application/json;odata=nometadata',
        ...extraHeaders,
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
      const err = new Error(`REST ${method} ${path} -> ${r.status} ${msg}`);
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

const q = (s) => s.replace(/'/g, "''");

// ─── Steps ──────────────────────────────────────────────────────────────────

async function ensureSiteColumns(g, siteId) {
  const existing = new Map((await g.get(`/sites/${siteId}/columns?$select=id,name&$top=500`)).value.map((c) => [c.name, c.id]));
  const ids = new Map();
  for (const def of SITE_COLUMNS) {
    if (existing.has(def.name)) {
      log('  column exists:', def.name);
      ids.set(def.name, existing.get(def.name));
      continue;
    }
    plan('create site column', def.name, `(${def.displayName})`);
    if (DRY_RUN) continue;
    const created = await g.post(`/sites/${siteId}/columns`, { ...def, enforceUniqueValues: false, hidden: false, indexed: false });
    ids.set(def.name, created.id);
  }
  return ids;
}

async function ensureContentType(g, siteId, columnIds) {
  const found = (await g.get(`/sites/${siteId}/contentTypes?$filter=name eq '${q(CONTENT_TYPE.name)}'&$select=id,name`)).value[0];
  let ctId = found ? found.id : null;
  if (found) log('  content type exists:', found.name, found.id);
  else {
    plan('create content type', CONTENT_TYPE.name);
    if (!DRY_RUN) ctId = (await g.post(`/sites/${siteId}/contentTypes`, CONTENT_TYPE)).id;
  }
  if (DRY_RUN && !ctId) {
    plan('attach', SITE_COLUMNS.length, 'columns to content type');
    return null;
  }
  const attached = new Set((await g.get(`/sites/${siteId}/contentTypes/${ctId}/columns?$select=name`)).value.map((c) => c.name));
  for (const def of SITE_COLUMNS) {
    if (attached.has(def.name)) continue;
    const colId = columnIds.get(def.name);
    if (!colId) {
      plan('attach column (after creation)', def.name);
      continue;
    }
    plan('attach column to content type', def.name);
    if (DRY_RUN) continue;
    await g.post(`/sites/${siteId}/contentTypes/${ctId}/columns`, {
      'sourceColumn@odata.bind': `${GRAPH}/sites/${siteId}/columns/${colId}`,
    });
  }
  return ctId;
}

async function listByName(g, siteId, displayName) {
  const all = (await g.get(`/sites/${siteId}/lists?$select=id,displayName,list&$top=200`)).value;
  return all.find((l) => l.displayName === displayName) || null;
}

async function ensureLibrary(g, siteId, lib) {
  const found = await listByName(g, siteId, lib.displayName);
  if (found) {
    log('  library exists:', lib.displayName);
    return found.id;
  }
  plan('create document library', lib.displayName);
  if (DRY_RUN) return null;
  const created = await g.post(`/sites/${siteId}/lists`, {
    displayName: lib.displayName,
    description: lib.description,
    list: { template: 'documentLibrary' },
  });
  return created.id;
}

// Graph can copy a site content type onto a list (addCopy). Whether the library
// then exposes it depends on "allow management of content types", which Graph
// cannot switch on — that part is REST/UI. Best effort, never fatal.
async function attachContentTypeViaGraph(g, siteId, listId, libName, ctId) {
  if (!listId || !ctId) {
    plan(`attach content type Contract to ${libName} (Graph addCopy)`);
    return;
  }
  const have = (await g.get(`/sites/${siteId}/lists/${listId}/contentTypes?$select=id,name`)).value;
  if (have.some((c) => c.name === CONTENT_TYPE.name)) {
    log(`  content type on list: ${libName}`);
    return;
  }
  plan(`attach content type Contract to ${libName} (Graph addCopy)`);
  if (DRY_RUN) return;
  try {
    await g.post(`/sites/${siteId}/lists/${listId}/contentTypes/addCopy`, {
      contentType: `${GRAPH}/sites/${siteId}/contentTypes/${ctId}`,
    });
  } catch (e) {
    log(`  addCopy failed for ${libName} (will need REST/UI): ${e.message}`);
  }
}

async function ensureFolders(g, siteId, listId, libName, folders) {
  if (!listId) {
    for (const f of folders) plan(`create folder ${libName}/${f}`);
    return;
  }
  const drive = await g.get(`/sites/${siteId}/lists/${listId}/drive?$select=id`);
  for (const path of folders) {
    const parts = path.split('/');
    let parent = '';
    for (const part of parts) {
      const full = parent ? `${parent}/${part}` : part;
      let exists = true;
      try {
        await g.get(`/drives/${drive.id}/root:/${encodeURI(full)}?$select=id`);
      } catch (e) {
        if (e.status === 404) exists = false;
        else throw e;
      }
      if (!exists) {
        plan(`create folder ${libName}/${full}`);
        if (!DRY_RUN) {
          const target = parent ? `/drives/${drive.id}/root:/${encodeURI(parent)}:/children` : `/drives/${drive.id}/root/children`;
          await g.post(target, { name: part, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
        }
      }
      parent = full;
    }
  }
  return drive.id;
}

async function ensureReadme(g, driveId, libName) {
  if (!driveId) {
    plan(`upload ${libName}/_ARCHIVE-RULES.md`);
    return;
  }
  try {
    await g.get(`/drives/${driveId}/root:/_ARCHIVE-RULES.md?$select=id`);
    log(`  ${libName}/_ARCHIVE-RULES.md exists`);
    return;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  plan(`upload ${libName}/_ARCHIVE-RULES.md`);
  if (DRY_RUN) return;
  await g.put(`/drives/${driveId}/root:/_ARCHIVE-RULES.md:/content`, Buffer.from(README, 'utf8'), 'text/markdown');
}

async function ensureDispositionLog(g, siteId) {
  const found = await listByName(g, siteId, DISPOSITION_LOG.displayName);
  if (found) {
    log('  list exists:', DISPOSITION_LOG.displayName);
    return;
  }
  plan('create list', DISPOSITION_LOG.displayName, `with ${DISPOSITION_LOG.columns.length} columns`);
  if (DRY_RUN) return;
  await g.post(`/sites/${siteId}/lists`, {
    displayName: DISPOSITION_LOG.displayName,
    description: DISPOSITION_LOG.description,
    columns: DISPOSITION_LOG.columns,
    list: { template: 'genericList' },
  });
}

// SharePoint REST: library settings, content type attachment/order, views.
async function configureLibrary(sp, lib, ctId) {
  const base = `/web/lists/getbytitle('${q(lib.displayName)}')`;
  let current;
  try {
    current = await sp.get(`${base}?$select=Id,ContentTypesEnabled,EnableVersioning,MajorVersionLimit,EnableMinorVersions`);
  } catch (e) {
    log('  REST unavailable for', lib.displayName, '-', e.message);
    return false;
  }
  const want = { ContentTypesEnabled: true, EnableVersioning: true, EnableMinorVersions: false, MajorVersionLimit: 50 };
  const diff = Object.entries(want).filter(([k, v]) => current[k] !== v);
  if (diff.length) {
    plan(`settings ${lib.displayName}:`, diff.map(([k, v]) => `${k}=${v}`).join(' '));
    if (!DRY_RUN) await sp.merge(base, Object.fromEntries(diff));
  } else log(`  settings ok: ${lib.displayName}`);

  if (!ctId) {
    plan(`attach content type Contract to ${lib.displayName} (after creation)`);
    return true;
  }
  const cts = (await sp.get(`${base}/ContentTypes?$select=Id,Name`)).value;
  const attachedCt = cts.find((c) => c.Name === CONTENT_TYPE.name);
  if (!attachedCt) {
    plan(`attach content type Contract to ${lib.displayName}`);
    if (!DRY_RUN) await sp.post(`${base}/ContentTypes/AddAvailableContentType`, { contentTypeId: ctId });
  } else log(`  content type attached: ${lib.displayName}`);

  // Put Contract first so it is the default on upload; keep Document available.
  const order = (await sp.get(`${base}/RootFolder?$select=UniqueContentTypeOrder`)).UniqueContentTypeOrder || [];
  const listCts = (await sp.get(`${base}/ContentTypes?$select=Id,Name`)).value;
  const contract = listCts.find((c) => c.Name === CONTENT_TYPE.name);
  const document = listCts.find((c) => c.Name === 'Document');
  const first = order[0] && order[0].StringValue;
  if (contract && (!first || first !== contract.Id.StringValue)) {
    plan(`content type order ${lib.displayName}: Contract first`);
    if (!DRY_RUN) {
      const ids = [contract, document].filter(Boolean).map((c) => ({ StringValue: c.Id.StringValue }));
      await sp.merge(`${base}/RootFolder`, { UniqueContentTypeOrder: ids });
    }
  } else if (contract) log(`  content type order ok: ${lib.displayName}`);
  return true;
}

async function ensureViews(sp, lib) {
  const base = `/web/lists/getbytitle('${q(lib.displayName)}')`;
  let views;
  try {
    views = (await sp.get(`${base}/Views?$select=Id,Title,DefaultView`)).value;
  } catch (e) {
    log('  REST views unavailable for', lib.displayName, '-', e.message);
    return;
  }
  const defaultView = views.find((v) => v.DefaultView);
  if (defaultView) {
    const fields = (await sp.get(`${base}/Views('${defaultView.Id}')/ViewFields`)).Items || [];
    for (const f of DEFAULT_VIEW_FIELDS) {
      if (fields.includes(f)) continue;
      plan(`default view ${lib.displayName}: add field ${f}`);
      if (!DRY_RUN) await sp.post(`${base}/Views('${defaultView.Id}')/ViewFields/addviewfield('${f}')`);
    }
  }
  for (const v of VIEWS[lib.displayName] || []) {
    if (views.some((x) => x.Title === v.title)) {
      log(`  view exists: ${lib.displayName}/${v.title}`);
      continue;
    }
    plan(`create view ${lib.displayName}/${v.title}`);
    if (DRY_RUN) continue;
    const created = await sp.post(`${base}/Views`, { Title: v.title, PersonalView: false, ViewQuery: v.query, RowLimit: 100, Paged: true });
    await sp.post(`${base}/Views('${created.Id}')/ViewFields/removeallviewfields`);
    for (const f of v.fields) await sp.post(`${base}/Views('${created.Id}')/ViewFields/addviewfield('${f}')`);
  }
}

async function ensureNavigation(sp) {
  let nodes;
  try {
    nodes = (await sp.get('/web/Navigation/QuickLaunch?$select=Id,Title,Url')).value;
  } catch (e) {
    log('  REST navigation unavailable -', e.message);
    return;
  }
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

  log('\n[1] site columns');
  const columnIds = await ensureSiteColumns(g, site.id);

  log('\n[2] content type');
  const ctId = await ensureContentType(g, site.id, columnIds);

  log('\n[3] libraries + folders');
  const driveIds = {};
  for (const lib of LIBRARIES) {
    const listId = await ensureLibrary(g, site.id, lib);
    await attachContentTypeViaGraph(g, site.id, listId, lib.displayName, ctId);
    driveIds[lib.displayName] = await ensureFolders(g, site.id, listId, lib.displayName, lib.folders);
    if (lib.readme) await ensureReadme(g, driveIds[lib.displayName], lib.displayName);
  }

  log('\n[4] Disposition-Log list');
  await ensureDispositionLog(g, site.id);

  log('\n[5] library settings, content type, views (SharePoint REST)');
  for (const lib of LIBRARIES) {
    const ok = await configureLibrary(sp, lib, ctId);
    if (ok && lib.views) await ensureViews(sp, lib);
  }

  log('\n[6] site navigation (SharePoint REST)');
  await ensureNavigation(sp);

  log('\ndone.', DRY_RUN ? 'Re-run without --dry-run to apply.' : '');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
