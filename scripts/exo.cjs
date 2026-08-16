#!/usr/bin/env node
/**
 * exo — run any Exchange Online admin cmdlet from this server, app-only.
 *
 * The Exchange Online PowerShell v3 module talks to a REST endpoint
 * (`/adminapi/beta/{tenant}/InvokeCommand`). We hold `Exchange.ManageAsApp`
 * plus the Exchange Administrator directory role on the KALFA-RSVP app, and we
 * authenticate with the same certificate used for Graph — so we can call that
 * endpoint directly and skip installing PowerShell entirely.
 *
 * Usage:
 *   node scripts/exo.cjs <CmdletName> ['<json params>']
 *
 * Examples:
 *   node scripts/exo.cjs Get-DkimSigningConfig
 *   node scripts/exo.cjs New-DkimSigningConfig '{"DomainName":"kalfa.me","Enabled":false}'
 *   node scripts/exo.cjs Set-DkimSigningConfig '{"Identity":"kalfa.me","Enabled":true}'
 *   node scripts/exo.cjs Get-AcceptedDomain
 *   node scripts/exo.cjs Get-Mailbox
 *
 * Add --raw to print the unabridged JSON response.
 *
 * Anything that changes state is still a real change to a live tenant — read
 * first, then write.
 */
const { ClientCertificateCredential } = require('@azure/identity');

const TENANT = '11926da5-9d16-45e3-947b-27b2909ba6c5';
const CLIENT = '69535c9d-b933-4c4b-a39d-aee3e2ecf70a';
const CERT = '/var/www/vhosts/kalfa.me/beta/m365-auth/graph-cert.pem';

const args = process.argv.slice(2).filter((a) => a !== '--raw');
const RAW = process.argv.includes('--raw');
const cmdlet = args[0];
const params = args[1] ? JSON.parse(args[1]) : {};

if (!cmdlet) {
  console.error('usage: node scripts/exo.cjs <CmdletName> [\'<json params>\'] [--raw]');
  process.exit(2);
}

// Values worth surfacing per cmdlet family; everything else needs --raw.
const INTERESTING = [
  'Identity', 'Name', 'DomainName', 'Domain', 'Enabled', 'Status', 'IsValid',
  'Selector1CNAME', 'Selector2CNAME', 'KeySize', 'DisplayName',
  'PrimarySmtpAddress', 'EmailAddresses', 'RecipientType', 'DomainType',
  'WhenCreated', 'LastChecked', 'RotateOnDate',
];

(async () => {
  const cred = new ClientCertificateCredential(TENANT, CLIENT, CERT);
  const token = (await cred.getToken('https://outlook.office365.com/.default')).token;

  const res = await fetch(
    `https://outlook.office365.com/adminapi/beta/${TENANT}/InvokeCommand`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ CmdletInput: { CmdletName: cmdlet, Parameters: params } }),
    },
  );

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }

  console.log(`${cmdlet} → HTTP ${res.status}`);

  if (!res.ok) {
    const err = body && (body.error || body);
    console.log(JSON.stringify(err, null, 2).slice(0, 1500));
    process.exit(1);
  }
  if (RAW || !body) {
    console.log(RAW ? JSON.stringify(body, null, 2) : text.slice(0, 2000));
    return;
  }

  const rows = Array.isArray(body.value) ? body.value : [body];
  if (!rows.length) {
    console.log('(no results)');
    return;
  }
  rows.forEach((row, i) => {
    if (rows.length > 1) console.log(`\n--- [${i}] ---`);
    const shown = INTERESTING.filter((k) => row[k] !== undefined && row[k] !== null);
    (shown.length ? shown : Object.keys(row).slice(0, 12)).forEach((k) => {
      const v = row[k];
      console.log(`  ${k.padEnd(20)} ${typeof v === 'object' ? JSON.stringify(v).slice(0, 160) : String(v).slice(0, 160)}`);
    });
  });
  const warn = body['@adminapi.warnings'];
  if (warn && warn.length) warn.forEach((w) => console.log('  ⚠️  ' + String(w).slice(0, 200)));
})().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
