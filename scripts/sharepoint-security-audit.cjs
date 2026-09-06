#!/usr/bin/env node
/*
 * READ-ONLY security posture report for the SharePoint archive
 * (docs/sharepoint-contracts-archive-plan-2026-09-06.md §9, improvement #9).
 * Writes nothing. Run it after any sharing/permission change, and once a year
 * with the January review.
 *
 *   node scripts/sharepoint-security-audit.cjs
 *
 * Reports:
 *   1. tenant external-sharing posture (the ceiling every site sits under)
 *   2. per-site sharing capability for the two archive sites
 *   3. which applications hold a Sites.Selected grant on those sites
 *   4. the Graph app roles held by every Claude/KALFA app in the tenant
 *   5. guest accounts in the directory
 */

const { ClientCertificateCredential } = require('@azure/identity');

const TENANT = '11926da5-9d16-45e3-947b-27b2909ba6c5';
const CLIENT = '69535c9d-b933-4c4b-a39d-aee3e2ecf70a';
const CERT = '/var/www/vhosts/kalfa.me/beta/m365-auth/graph-cert.pem';
const HOST = 'kalfarsvp.sharepoint.com';
const ADMIN_HOST = 'kalfarsvp-admin.sharepoint.com';
const GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';
const SITE_PATHS = ['/sites/KALFARSVP', '/sites/allcompany'];

// Microsoft.Online.SharePoint.TenantManagement enums (declaration order).
const SHARING = {
  0: 'Disabled — רק אנשים בארגון',
  1: 'ExternalUserSharingOnly — הזמנה במייל מותרת, קישורים אנונימיים חסומים',
  2: 'ExternalUserAndGuestSharing — גם קישורי "כל מי שיש לו הקישור"',
  3: 'ExistingExternalUserSharingOnly — רק אורחים שכבר בספרייה',
};
const LINK_TYPE = { 0: 'None (לפי ברירת המחדל של הארגון)', 1: 'Direct (אנשים ספציפיים)', 2: 'Internal (בארגון)', 3: 'AnonymousAccess (כל מי שיש לו הקישור)' };

// Graph app roles that are broad enough to matter if a certificate leaks.
const SENSITIVE = /^(Directory\.ReadWrite|RoleManagement\.|Application\.ReadWrite|AppRoleAssignment\.|Sites\.FullControl|User\.ReadWrite|Group\.ReadWrite|Mail\.(Send|ReadWrite)|Files\.ReadWrite)/;

const log = (...a) => console.log(...a);

(async () => {
  const cred = new ClientCertificateCredential(TENANT, CLIENT, CERT);
  const gt = (await cred.getToken('https://graph.microsoft.com/.default')).token;
  let at = null;
  try {
    at = (await cred.getToken(`https://${ADMIN_HOST}/.default`)).token;
  } catch (e) {
    log('SPO admin token unavailable:', e.message.slice(0, 120));
  }

  const graph = async (p) => {
    const r = await fetch('https://graph.microsoft.com/v1.0' + p, { headers: { Authorization: `Bearer ${gt}`, ConsistencyLevel: 'eventual' } });
    const t = await r.text();
    let j = null;
    try {
      j = t ? JSON.parse(t) : null;
    } catch {
      j = null;
    }
    if (!r.ok) throw new Error(`${r.status} ${j && j.error ? j.error.code : t.slice(0, 120)}`);
    return j;
  };
  const admin = async (p, body) => {
    const r = await fetch(`https://${ADMIN_HOST}${p}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${at}`, Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json;odata=nometadata' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    let j = null;
    try {
      j = t ? JSON.parse(t) : null;
    } catch {
      j = null;
    }
    if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 160)}`);
    return j;
  };

  log('== 1. tenant external sharing (the ceiling) ==');
  if (at) {
    try {
      const t = await admin('/_api/SPOInternalUseOnly.Tenant?$select=SharingCapability,DefaultSharingLinkType,RequireAnonymousLinksExpireInDays,ExternalUserExpirationRequired,ExternalUserExpireInDays');
      log(`  SharingCapability      : ${t.SharingCapability} — ${SHARING[t.SharingCapability] ?? '?'}`);
      log(`  DefaultSharingLinkType : ${t.DefaultSharingLinkType} — ${LINK_TYPE[t.DefaultSharingLinkType] ?? '?'}`);
      log(`  anonymous link expiry  : ${t.RequireAnonymousLinksExpireInDays === -1 ? 'never (-1)' : t.RequireAnonymousLinksExpireInDays + ' days'}`);
      log(`  guest access expiry    : ${t.ExternalUserExpirationRequired ? t.ExternalUserExpireInDays + ' days' : 'never'}`);
    } catch (e) {
      log('  unavailable:', e.message.slice(0, 160));
    }
  }

  log('\n== 2-3. archive sites ==');
  for (const p of SITE_PATHS) {
    const url = `https://${HOST}${p}`;
    log(`  ${p}`);
    if (at) {
      try {
        const s = await admin('/_api/SPO.Tenant/GetSitePropertiesByUrl', { url, includeDetail: true });
        log(`    sharing   : ${s.SharingCapability} — ${SHARING[s.SharingCapability] ?? '?'}`);
        log(`    link type : ${s.DefaultSharingLinkType} — ${LINK_TYPE[s.DefaultSharingLinkType] ?? '?'}`);
        log(`    status    : ${s.Status} | lock: ${s.LockState} | storage used: ${s.StorageUsage}MB`);
      } catch (e) {
        log('    site properties unavailable:', e.message.slice(0, 140));
      }
    }
    try {
      const site = await graph(`/sites/${HOST}:${p}?$select=id`);
      const perms = (await graph(`/sites/${site.id}/permissions`)).value || [];
      const rows = perms.map((perm) => {
        const who = (perm.grantedToIdentitiesV2 || perm.grantedToIdentities || [])
          .map((i) => (i.application ? i.application.displayName || i.application.id : JSON.stringify(i).slice(0, 60)))
          .join(', ');
        return `${(perm.roles || []).join('/')} → ${who}`;
      });
      log(`    app grants (Sites.Selected): ${rows.join(' | ') || 'none'}`);
    } catch (e) {
      log('    permissions unavailable:', e.message.slice(0, 140));
    }
  }

  log('\n== 4. applications with Graph app roles ==');
  try {
    const graphSp = (await graph(`/servicePrincipals?$filter=appId eq '${GRAPH_APP_ID}'&$select=id,appRoles`)).value[0];
    const names = new Map(graphSp.appRoles.map((r) => [r.id, r.value]));
    const sps = (await graph('/servicePrincipals?$search="displayName:KALFA" OR "displayName:Claude" OR "displayName:Archive"&$select=id,displayName,appId')).value;
    for (const sp of sps) {
      const assigned = (await graph(`/servicePrincipals/${sp.id}/appRoleAssignments?$select=appRoleId,resourceId`)).value;
      const roles = assigned.filter((a) => a.resourceId === graphSp.id).map((a) => names.get(a.appRoleId) || a.appRoleId);
      if (!roles.length) continue;
      const risky = roles.filter((r) => SENSITIVE.test(r));
      log(`  ${sp.displayName} (${sp.appId.slice(0, 8)}…): ${roles.length} Graph role(s)`);
      log(`    ${roles.sort().join(' ')}`);
      if (risky.length) log(`    ⚠ broad: ${risky.sort().join(' ')}`);
    }
  } catch (e) {
    log('  unavailable:', e.message.slice(0, 160));
  }

  log('\n== 5. guest accounts ==');
  try {
    const g = await graph("/users?$filter=userType eq 'Guest'&$select=displayName,userPrincipalName&$top=100");
    log('  ', g.value.length ? g.value.map((u) => u.userPrincipalName).join(', ') : 'none');
  } catch (e) {
    log('  unavailable:', e.message.slice(0, 120));
  }
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
