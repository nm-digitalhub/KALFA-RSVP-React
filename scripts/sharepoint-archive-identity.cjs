#!/usr/bin/env node
/*
 * Least-privilege identity for the SharePoint archive automation
 * (docs/sharepoint-contracts-archive-plan-2026-09-06.md §9, owner-approved
 * 2026-09-06 as improvement #8).
 *
 * WHY: the nightly export and the weekly maintenance sweep run unattended
 * against a library holding signed agreements and customer PII. Today they
 * authenticate as KALFA-RSVP, which holds Sites.FullControl.All plus
 * Directory.ReadWrite.All, RoleManagement.ReadWrite.Directory and
 * Application.ReadWrite.All — i.e. a compromise of that certificate is a
 * tenant-wide event. This provisions a SEPARATE app whose only Graph
 * permission is `Sites.Selected`, which grants nothing by itself: access is
 * then granted per site, and only to the two archive sites, with the `write`
 * role. Anything outside those two sites is invisible to it.
 *
 * The provisioning scripts (sharepoint-archive-provision.cjs /
 * sharepoint-intranet-provision.cjs) deliberately KEEP using KALFA-RSVP: they
 * create site columns, apply tenant themes and pin Teams tabs, which are
 * tenant-scoped operations that Sites.Selected cannot cover. They run by hand,
 * not on a schedule, so they are not the exposure that matters.
 *
 * Idempotent. Run with --dry-run first. Requires the KALFA-RSVP app
 * (Application.ReadWrite.All + AppRoleAssignment.ReadWrite.All + Sites.FullControl.All).
 *
 *   node scripts/sharepoint-archive-identity.cjs --dry-run
 *   node scripts/sharepoint-archive-identity.cjs
 *   node scripts/sharepoint-archive-identity.cjs --show     # report only
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { ClientCertificateCredential } = require('@azure/identity');

const TENANT = '11926da5-9d16-45e3-947b-27b2909ba6c5';
const ADMIN_CLIENT = '69535c9d-b933-4c4b-a39d-aee3e2ecf70a'; // KALFA-RSVP (does the provisioning)
const ADMIN_CERT = '/var/www/vhosts/kalfa.me/beta/m365-auth/graph-cert.pem';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';

const APP_NAME = 'KALFA Archive Automation';
const CERT_PATH = path.join(__dirname, '..', 'm365-auth', 'archive-cert.pem');
const CERT_DAYS = 1095; // 3 years
const SCOPE = 'Sites.Selected';
const SITE_ROLE = 'write'; // read | write | manage | fullcontrol
const HOST = 'kalfarsvp.sharepoint.com';
const SITE_PATHS = ['/sites/KALFARSVP', '/sites/allcompany'];

const DRY_RUN = process.argv.includes('--dry-run');
const SHOW_ONLY = process.argv.includes('--show');
const log = (...a) => console.log(...a);
const plan = (...a) => console.log(DRY_RUN ? '[dry-run]' : '[do]', ...a);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Entra replicates a newly created application/servicePrincipal lazily: a
 * write against the object id seconds after creation can return 404
 * Request_ResourceNotFound (hit on the first real run, 2026-09-06). Retry the
 * call rather than leaving a half-provisioned app behind.
 */
async function withReplicationRetry(fn, what, tries = 8) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const transient = e.status === 404 || /Request_ResourceNotFound/.test(e.message);
      if (!transient || i >= tries) throw e;
      log(`  ${what}: not replicated yet (attempt ${i}/${tries}), waiting…`);
      await sleep(5000);
    }
  }
}

function graphClient(token) {
  const call = async (method, p, body) => {
    const r = await fetch(GRAPH + p, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
      const err = new Error(`${method} ${p} -> ${r.status} ${json && json.error ? json.error.code + ': ' + json.error.message : text.slice(0, 300)}`);
      err.status = r.status;
      throw err;
    }
    return json;
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b) };
}

/** Self-signed cert + key in ONE pem, the same shape ClientCertificateCredential reads for the existing app. */
function ensureCertificate() {
  if (fs.existsSync(CERT_PATH)) {
    const notAfter = execFileSync('openssl', ['x509', '-in', CERT_PATH, '-noout', '-enddate']).toString().trim();
    log(`  certificate exists: ${CERT_PATH} (${notAfter})`);
    return;
  }
  plan(`generate certificate ${CERT_PATH} (RSA 2048, ${CERT_DAYS} days, CN=${APP_NAME})`);
  if (DRY_RUN) return;
  const key = `${CERT_PATH}.key.tmp`;
  const crt = `${CERT_PATH}.crt.tmp`;
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', crt,
    '-days', String(CERT_DAYS),
    '-subj', `/CN=${APP_NAME}`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  fs.writeFileSync(CERT_PATH, fs.readFileSync(key, 'utf8') + fs.readFileSync(crt, 'utf8'), { mode: 0o600 });
  fs.chmodSync(CERT_PATH, 0o600);
  fs.unlinkSync(key);
  fs.unlinkSync(crt);
  log('  certificate written (mode 600; *.pem is gitignored — the private key never leaves this server)');
}

/** The certificate's DER bytes, base64 — what Graph stores as a keyCredential. */
function certDerBase64() {
  return execFileSync('openssl', ['x509', '-in', CERT_PATH, '-outform', 'DER'])
    .toString('base64');
}

function certThumbprint() {
  return execFileSync('openssl', ['x509', '-in', CERT_PATH, '-noout', '-fingerprint', '-sha1'])
    .toString()
    .split('=')[1]
    .trim()
    .replace(/:/g, '');
}

async function ensureApplication(g) {
  const found = (await g.get(`/applications?$filter=displayName eq '${APP_NAME.replace(/'/g, "''")}'&$select=id,appId,displayName,keyCredentials,requiredResourceAccess`)).value[0];
  if (found) {
    log(`  app registration exists: ${found.displayName} (appId ${found.appId})`);
    return found;
  }
  plan(`create app registration "${APP_NAME}" (single tenant)`);
  if (DRY_RUN) return null;
  const created = await g.post('/applications', {
    displayName: APP_NAME,
    signInAudience: 'AzureADMyOrg',
    notes: 'Least-privilege identity for the SharePoint contracts archive jobs (Sites.Selected + per-site write). Provisioned by scripts/sharepoint-archive-identity.cjs.',
  });
  // Wait until the new object is actually readable before writing to it.
  return withReplicationRetry(
    () => g.get(`/applications/${created.id}?$select=id,appId,displayName,keyCredentials,requiredResourceAccess`),
    'new app registration',
  );
}

async function ensureCertificateOnApp(g, app) {
  if (!app) {
    plan('upload certificate to the app registration');
    return;
  }
  const thumb = certThumbprint();
  const has = (app.keyCredentials || []).some((k) => (k.customKeyIdentifier || '').toUpperCase() === thumb);
  if (has) {
    log('  certificate already registered on the app');
    return;
  }
  plan(`upload certificate (SHA-1 ${thumb.slice(0, 12)}…) to the app registration`);
  if (DRY_RUN) return;
  await withReplicationRetry(
    () =>
      g.patch(`/applications/${app.id}`, {
        keyCredentials: [
          ...(app.keyCredentials || []),
          { type: 'AsymmetricX509Cert', usage: 'Verify', key: certDerBase64(), displayName: `${APP_NAME} cert` },
        ],
      }),
    'certificate upload',
  );
}

async function ensurePermission(g, app) {
  const graphSp = (await g.get(`/servicePrincipals?$filter=appId eq '${GRAPH_APP_ID}'&$select=id,appRoles`)).value[0];
  const role = graphSp.appRoles.find((r) => r.value === SCOPE && r.allowedMemberTypes.includes('Application'));
  if (!role) throw new Error(`app role ${SCOPE} not found on Microsoft Graph`);
  log(`  Graph app role ${SCOPE} = ${role.id}`);

  if (app) {
    const rra = app.requiredResourceAccess || [];
    const entry = rra.find((x) => x.resourceAppId === GRAPH_APP_ID);
    const listed = entry && entry.resourceAccess.some((a) => a.id === role.id && a.type === 'Role');
    if (listed) log('  permission already listed on the app registration');
    else {
      plan(`list ${SCOPE} on the app registration`);
      if (!DRY_RUN) {
        if (entry) entry.resourceAccess.push({ id: role.id, type: 'Role' });
        else rra.push({ resourceAppId: GRAPH_APP_ID, resourceAccess: [{ id: role.id, type: 'Role' }] });
        await withReplicationRetry(() => g.patch(`/applications/${app.id}`, { requiredResourceAccess: rra }), 'permission list');
      }
    }
  }

  if (!app || DRY_RUN) {
    plan('create service principal and grant admin consent');
    return { graphSpId: graphSp.id, roleId: role.id, sp: null };
  }
  let sp = (await g.get(`/servicePrincipals?$filter=appId eq '${app.appId}'&$select=id,appId,displayName`)).value[0];
  if (!sp) {
    plan('create service principal');
    sp = await withReplicationRetry(() => g.post('/servicePrincipals', { appId: app.appId }), 'service principal');
  } else log('  service principal exists');

  const assigned = (await withReplicationRetry(
    () => g.get(`/servicePrincipals/${sp.id}/appRoleAssignments?$select=appRoleId,resourceId`),
    'service principal roles',
  )).value;
  if (assigned.some((a) => a.resourceId === graphSp.id && a.appRoleId === role.id)) {
    log(`  admin consent for ${SCOPE}: already granted`);
  } else {
    plan(`grant admin consent for ${SCOPE}`);
    await withReplicationRetry(
      () => g.post(`/servicePrincipals/${sp.id}/appRoleAssignments`, { principalId: sp.id, resourceId: graphSp.id, appRoleId: role.id }),
      'admin consent',
    );
  }
  // Anything beyond Sites.Selected would defeat the purpose — say so loudly.
  const extra = assigned.filter((a) => a.resourceId === graphSp.id && a.appRoleId !== role.id);
  if (extra.length) log(`  ⚠ this app also holds ${extra.length} other Graph app role(s) — review`);
  return { graphSpId: graphSp.id, roleId: role.id, sp };
}

async function ensureSiteGrants(g, app) {
  for (const p of SITE_PATHS) {
    const site = await g.get(`/sites/${HOST}:${p}?$select=id,displayName`);
    const perms = (await g.get(`/sites/${site.id}/permissions`)).value;
    const mine = perms.find((perm) =>
      (perm.grantedToIdentitiesV2 || perm.grantedToIdentities || []).some(
        (i) => i.application && app && i.application.id === app.appId,
      ),
    );
    if (mine) {
      const roles = (mine.roles || []).join('/');
      if (roles === SITE_ROLE) {
        log(`  ${site.displayName}: grant exists (${roles})`);
        continue;
      }
      plan(`update grant on ${site.displayName}: ${roles} → ${SITE_ROLE}`);
      if (!DRY_RUN) await g.patch(`/sites/${site.id}/permissions/${mine.id}`, { roles: [SITE_ROLE] });
      continue;
    }
    plan(`grant "${SITE_ROLE}" on ${site.displayName} (${p}) to ${APP_NAME}`);
    if (DRY_RUN || !app) continue;
    await g.post(`/sites/${site.id}/permissions`, {
      roles: [SITE_ROLE],
      grantedToIdentities: [{ application: { id: app.appId, displayName: APP_NAME } }],
    });
  }
}

async function report(g) {
  log('\n== current state ==');
  const app = (await g.get(`/applications?$filter=displayName eq '${APP_NAME.replace(/'/g, "''")}'&$select=id,appId,displayName,keyCredentials`)).value[0];
  if (!app) {
    log('  app registration: not provisioned');
    return;
  }
  log(`  app: ${app.displayName} | appId ${app.appId} | certs ${(app.keyCredentials || []).length}`);
  for (const k of app.keyCredentials || []) log(`    cert ${(k.customKeyIdentifier || '').slice(0, 12)}… expires ${k.endDateTime}`);
  const sp = (await g.get(`/servicePrincipals?$filter=appId eq '${app.appId}'&$select=id`)).value[0];
  if (sp) {
    const graphSp = (await g.get(`/servicePrincipals?$filter=appId eq '${GRAPH_APP_ID}'&$select=id,appRoles`)).value[0];
    const names = new Map(graphSp.appRoles.map((r) => [r.id, r.value]));
    const assigned = (await g.get(`/servicePrincipals/${sp.id}/appRoleAssignments?$select=appRoleId,resourceId,resourceDisplayName`)).value;
    log('  granted app roles:', assigned.map((a) => `${a.resourceDisplayName}/${names.get(a.appRoleId) || a.appRoleId}`).join(', ') || 'none');
  }
  for (const p of SITE_PATHS) {
    const site = await g.get(`/sites/${HOST}:${p}?$select=id,displayName`);
    const perms = (await g.get(`/sites/${site.id}/permissions`)).value;
    const rows = perms.map((perm) => {
      const who = (perm.grantedToIdentitiesV2 || perm.grantedToIdentities || [])
        .map((i) => (i.application ? i.application.displayName || i.application.id : JSON.stringify(i)))
        .join(', ');
      return `${(perm.roles || []).join('/')} → ${who}`;
    });
    log(`  ${site.displayName}: ${rows.join(' | ') || 'no app grants'}`);
  }
}

(async () => {
  log(SHOW_ONLY ? '== REPORT ==' : DRY_RUN ? '== DRY RUN — no writes ==' : '== PROVISION ==');
  const cred = new ClientCertificateCredential(TENANT, ADMIN_CLIENT, ADMIN_CERT);
  const g = graphClient((await cred.getToken('https://graph.microsoft.com/.default')).token);

  if (SHOW_ONLY) {
    await report(g);
    return;
  }

  log('\n[1] certificate');
  ensureCertificate();

  log('\n[2] app registration');
  const app = await ensureApplication(g);

  log('\n[3] certificate on the app');
  await ensureCertificateOnApp(g, app);

  log(`\n[4] Graph permission (${SCOPE} only) + admin consent`);
  await ensurePermission(g, app);

  log(`\n[5] per-site grants (${SITE_ROLE})`);
  await ensureSiteGrants(g, app);

  if (!DRY_RUN && app) {
    log('\n== add to .env.local (then redeploy the worker) ==');
    log(`MS_ARCHIVE_TENANT_ID=${TENANT}`);
    log(`MS_ARCHIVE_CLIENT_ID=${app.appId}`);
    log(`MS_ARCHIVE_CERT_PATH=${CERT_PATH}`);
    log('\nUntil those are set, the archive jobs keep using the existing identity (fail-safe fallback).');
  }
  log('\ndone.', DRY_RUN ? 'Re-run without --dry-run to apply.' : '');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
