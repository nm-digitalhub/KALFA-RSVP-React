/**
 * Calendar migration helper: IONOS Hosted Exchange (EWS) → Microsoft 365 (Graph).
 *
 * WHY THIS EXISTS: the mailbox content copy brought mail across but NOT the
 * calendar (measured 15.08.2026 — the M365 default calendar is empty). Graph's
 * mailbox import/export APIs cannot help: they operate on Exchange Online
 * mailboxes only and export an opaque EO-format stream, so there is no path
 * from IONOS through them. Both connections do work independently, so we read
 * with the existing EWS provider and write with Graph.
 *
 * Default mode is SCAN — read-only, writes nothing, just reports what is there.
 * Pass --apply to actually create the appointments in Microsoft 365.
 *
 * Build + run:
 *   npx esbuild scripts/calendar-migrate-ionos-to-graph.ts --bundle --platform=node \
 *     --format=cjs --target=node20 --outfile=dist/calendar-migrate.cjs \
 *     --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js \
 *     --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js \
 *     --alias:next/cache=./worker/empty.js --external:pg-native --external:deasync \
 *     --external:ews-javascript-api --external:@ewsjs/xhr
 *   node --env-file=.env.local dist/calendar-migrate.cjs [--apply]
 */
import { ClientCertificateCredential } from '@azure/identity';

import { decryptCredential } from '@/lib/exchange-ews/crypto';
import { ewsProvider } from '@/lib/exchange-ews/ews-impl';
import type { ExchangeConnectionConfig } from '@/lib/exchange-ews/types';
import { createAdminClient } from '@/lib/supabase/admin';

const TENANT = '11926da5-9d16-45e3-947b-27b2909ba6c5';
const CLIENT = '69535c9d-b933-4c4b-a39d-aee3e2ecf70a';
const CERT = '/var/www/vhosts/kalfa.me/beta/m365-auth/graph-cert.pem';
const MAILBOX = 'netanel.kalfa@kalfa.me';

// listAppointments caps at 300 items per range, so scan a year at a time —
// one wide window would truncate silently.
const FIRST_YEAR = 2020;
const LAST_YEAR = 2030;

const APPLY = process.argv.includes('--apply');

async function loadIonosConfig(): Promise<ExchangeConnectionConfig> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('exchange_connections')
    .select(
      'id, user_id, mailbox_email, auth_method, credential_ciphertext, credential_iv, credential_auth_tag, encryption_key_version',
    )
    .eq('status', 'verified')
    .limit(2);
  if (error) throw new Error('failed to load exchange_connections');
  if (!data || data.length !== 1) throw new Error(`expected exactly 1 verified connection, got ${data?.length ?? 0}`);
  const row = data[0];
  // One-time IONOS→Graph migration script: it reads FROM EWS, so it genuinely
  // needs the mailbox password. The columns became nullable in §B phase 1, so
  // an absent credential is now expressible — and for this script that means
  // the source it is supposed to read is unreachable, which must stop it rather
  // than let it report an empty migration as success.
  if (!row.credential_ciphertext || !row.credential_iv || !row.credential_auth_tag) {
    throw new Error('the verified connection stores no credential — cannot reach IONOS EWS');
  }
  return {
    mailboxEmail: row.mailbox_email,
    password: decryptCredential(
      {
        ciphertext: row.credential_ciphertext,
        iv: row.credential_iv,
        authTag: row.credential_auth_tag,
        keyVersion: row.encryption_key_version,
      },
      row.id,
      row.user_id,
    ),
    authMethod: row.auth_method === 'basic' ? 'basic' : 'ntlm',
  };
}

async function graphToken(): Promise<string> {
  const cred = new ClientCertificateCredential(TENANT, CLIENT, CERT);
  const t = await cred.getToken('https://graph.microsoft.com/.default');
  if (!t) throw new Error('failed to acquire a Graph token');
  return t.token;
}

async function main() {
  console.log(APPLY ? 'MODE: APPLY — will create appointments in Microsoft 365' : 'MODE: SCAN — read-only, nothing will be written');
  console.log('');

  const cfg = await loadIonosConfig();
  console.log('IONOS mailbox:', cfg.mailboxEmail);

  const perYear: { year: number; count: number }[] = [];
  const all: { id: string; subject: string; start: Date; end: Date; allDay: boolean; seriesLinked: boolean }[] = [];

  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
    const res = await ewsProvider.listAppointments(cfg, {
      start: new Date(Date.UTC(y, 0, 1)),
      end: new Date(Date.UTC(y + 1, 0, 1)),
    });
    if (!res.ok) {
      console.log(`  ${y}: ERROR ${res.error}`);
      continue;
    }
    perYear.push({ year: y, count: res.data.length });
    all.push(...res.data);
    if (res.data.length >= 300) console.log(`  ⚠️  ${y}: hit the 300-item cap — the real count is higher`);
  }

  console.log('');
  console.log('APPOINTMENTS PER YEAR (IONOS):');
  perYear.filter((r) => r.count > 0).forEach((r) => console.log(`   ${r.year}: ${r.count}`));
  console.log(`   TOTAL: ${all.length}`);

  const series = all.filter((a) => a.seriesLinked).length;
  console.log(`   of which series-linked (recurring occurrences): ${series}`);
  console.log('');

  if (!APPLY) {
    console.log('SAMPLE (up to 10, newest first):');
    [...all]
      .sort((a, b) => b.start.getTime() - a.start.getTime())
      .slice(0, 10)
      .forEach((a) =>
        console.log(`   ${a.start.toISOString().slice(0, 16)}  ${a.allDay ? '[all-day] ' : ''}${a.subject}`),
      );
    console.log('');
    console.log('Re-run with --apply to copy these into Microsoft 365.');
    return;
  }

  // ---- APPLY ----
  const token = await graphToken();
  let created = 0;
  let failed = 0;
  for (const a of all) {
    // Graph wants wall-clock + named zone, not an instant. All-day items must
    // be midnight-to-midnight in that same zone.
    const body = {
      subject: a.subject || '(ללא נושא)',
      isAllDay: a.allDay,
      start: { dateTime: a.start.toISOString().slice(0, 19), timeZone: 'UTC' },
      end: { dateTime: a.end.toISOString().slice(0, 19), timeZone: 'UTC' },
    };
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${MAILBOX}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      created++;
    } else {
      failed++;
      const e = await r.json().catch(() => ({}));
      console.log(`   ❌ ${a.subject}: ${r.status} ${e?.error?.code ?? ''}`);
    }
  }
  console.log(`created ${created}, failed ${failed}`);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
