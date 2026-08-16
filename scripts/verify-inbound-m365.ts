/**
 * Verify that inbound external mail now reaches the Microsoft 365 mailbox.
 *
 * Sends through whichever transport the app is configured to use, to
 * netanel.kalfa@kalfa.me. Because kalfa.me's MX points at Microsoft, the
 * message leaves that transport, crosses the public internet and must be
 * accepted by Exchange Online — which is exactly the inbound path this proves.
 * Then it looks for the message in the mailbox over Graph.
 *
 * The transport is REPORTED rather than assumed. An earlier version hardcoded
 * "IONOS SMTP" in its output; once EMAIL_PROVIDER moved to an API sender that
 * narration was simply false, and a check that misreports its own setup cannot
 * be trusted about anything else.
 *
 * Read-only apart from the one test message it sends to the owner's own mailbox.
 *
 * Build + run:
 *   npx esbuild scripts/verify-inbound-m365.ts --bundle --platform=node --format=cjs \
 *     --target=node20 --outfile=dist/verify-inbound.cjs --tsconfig=tsconfig.json \
 *     --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js \
 *     --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js \
 *     --external:pg-native --external:deasync
 *   node --env-file=.env.local dist/verify-inbound.cjs
 */
import { ClientCertificateCredential } from '@azure/identity';

import { getEmailSender, selectedEmailProvider } from '@/lib/email/sender';

const TENANT = '11926da5-9d16-45e3-947b-27b2909ba6c5';
const CLIENT = '69535c9d-b933-4c4b-a39d-aee3e2ecf70a';
const CERT = '/var/www/vhosts/kalfa.me/beta/m365-auth/graph-cert.pem';
const MAILBOX = 'netanel.kalfa@kalfa.me';

async function main() {
  const stamp = `INBOUND-PROOF-${Date.now()}`;

  const provider = selectedEmailProvider();
  console.log(`Sending via ${provider} → ${MAILBOX}`);
  console.log('(leaves the sending provider, crosses the internet, must be accepted by Exchange Online)');
  const sender = await getEmailSender();
  await sender.send({
    to: MAILBOX,
    subject: stamp,
    html: '<p>בדיקת כיוון נכנס אחרי החלפת ה-MX ל-Microsoft 365.</p>',
    text: 'בדיקת כיוון נכנס אחרי החלפת ה-MX ל-Microsoft 365.',
  });
  console.log(`✅ accepted by ${provider}`);
  console.log('');

  const cred = new ClientCertificateCredential(TENANT, CLIENT, CERT);
  const token = (await cred.getToken('https://graph.microsoft.com/.default'))!.token;
  const H = { Authorization: `Bearer ${token}` };

  process.stdout.write('waiting for it to land in Microsoft 365');
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    process.stdout.write('.');
    const q = await fetch(
      `https://graph.microsoft.com/v1.0/users/${MAILBOX}/messages?$top=10&$select=subject,receivedDateTime,internetMessageHeaders`,
      { headers: H },
    ).then((r) => r.json());
    const hit = (q.value ?? []).find((m: { subject?: string }) => m.subject === stamp);
    if (hit) {
      console.log('');
      console.log('✅✅ INBOUND ROUTING CONFIRMED — delivered at ' + hit.receivedDateTime);
      const headers: { name: string; value: string }[] = hit.internetMessageHeaders ?? [];
      headers
        .filter((h) => /Authentication-Results|Received-SPF|X-Forefront-Antispam|X-MS-Exchange-Organization-SCL/i.test(h.name))
        .forEach((h) => console.log('   ' + h.name + ': ' + h.value.slice(0, 300)));
      return;
    }
  }
  console.log('');
  console.log('⚠️  not in the mailbox after 2 minutes — check Junk, or it is still in transit');
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
