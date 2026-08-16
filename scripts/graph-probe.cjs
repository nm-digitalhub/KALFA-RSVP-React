#!/usr/bin/env node
/**
 * graph-probe — measure which Microsoft 365 capabilities this tenant ACTUALLY
 * grants us, rather than which ones the documentation says exist.
 *
 * Every probe is read-only: GETs, plus the two POSTs that only ever compute an
 * answer (/getSchedule, /findMeetingTimes). Nothing here creates, changes, or
 * deletes anything, and nothing here sends mail.
 *
 * A capability is reported OPEN only if the live call returned data. 403 means
 * the app registration lacks the permission; 404 on a valid path usually means
 * the feature is not provisioned or not licensed.
 *
 *   node scripts/graph-probe.cjs
 */
const { ClientCertificateCredential } = require('@azure/identity');

const TENANT = '11926da5-9d16-45e3-947b-27b2909ba6c5';
const CLIENT = '69535c9d-b933-4c4b-a39d-aee3e2ecf70a';
const CERT = '/var/www/vhosts/kalfa.me/beta/m365-auth/graph-cert.pem';
const MBX = 'netanel.kalfa@kalfa.me';

const cred = new ClientCertificateCredential(TENANT, CLIENT, { certificatePath: CERT });
let token;

async function call(method, path, body, version = 'v1.0') {
  if (!token) token = (await cred.getToken('https://graph.microsoft.com/.default')).token;
  const res = await fetch(`https://graph.microsoft.com/${version}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'outlook.timezone="Asia/Jerusalem"',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

const M = (s) => (s.length > 78 ? s.slice(0, 75) + '…' : s);

/** [label, method, path, body, version, summarise] */
const PROBES = [
  ['רישוי הטננט', 'GET', '/subscribedSkus', null, 'v1.0',
    (j) => (j.value ?? []).map((s) => `${s.skuPartNumber} (${s.consumedUnits}/${s.prepaidUnits?.enabled})`).join(', ')],

  ['שירותים פעילים ברישיון', 'GET', '/subscribedSkus', null, 'v1.0',
    (j) => {
      const plans = (j.value ?? []).flatMap((s) => s.servicePlans ?? [])
        .filter((p) => p.provisioningStatus === 'Success')
        .map((p) => p.servicePlanName);
      return `${plans.length} מופעלים: ${[...new Set(plans)].sort().join(', ')}`;
    }],

  ['פנוי/תפוס (getSchedule)', 'POST', `/users/${MBX}/calendar/getSchedule`, {
    schedules: [MBX],
    startTime: { dateTime: '2026-08-17T08:00:00', timeZone: 'Asia/Jerusalem' },
    endTime: { dateTime: '2026-08-18T20:00:00', timeZone: 'Asia/Jerusalem' },
    availabilityViewInterval: 30,
  }, 'v1.0', (j) => `${(j.value ?? []).length} לוחות; availabilityView באורך ${j.value?.[0]?.availabilityView?.length ?? 0}`],

  ['הצעת מועדים (findMeetingTimes)', 'POST', `/users/${MBX}/findMeetingTimes`, {
    timeConstraint: {
      activityDomain: 'work',
      timeSlots: [{
        start: { dateTime: '2026-08-17T08:00:00', timeZone: 'Asia/Jerusalem' },
        end: { dateTime: '2026-08-21T18:00:00', timeZone: 'Asia/Jerusalem' },
      }],
    },
    meetingDuration: 'PT30M',
    maxCandidates: 3,
  }, 'v1.0', (j) => `${(j.meetingTimeSuggestions ?? []).length} הצעות; ראשונה ${j.meetingTimeSuggestions?.[0]?.meetingTimeSlot?.start?.dateTime ?? '—'} (ביטחון ${j.meetingTimeSuggestions?.[0]?.confidence ?? '—'})`],

  ['שעות עבודה + אזור זמן', 'GET', `/users/${MBX}/mailboxSettings`, null, 'v1.0',
    (j) => `אזור=${j.timeZone}; ימי עבודה=${j.workingHours?.daysOfWeek?.join('/') ?? '—'} ${j.workingHours?.startTime ?? ''}-${j.workingHours?.endTime ?? ''}; שפה=${j.language?.locale ?? '—'}`],

  ['מענה אוטומטי (out-of-office)', 'GET', `/users/${MBX}/mailboxSettings/automaticRepliesSetting`, null, 'v1.0',
    (j) => `סטטוס=${j.status}; שליחה חיצונית=${j.externalAudience}`],

  ['רשימת קטגוריות אמיתית', 'GET', `/users/${MBX}/outlook/masterCategories`, null, 'v1.0',
    (j) => (j.value ?? []).map((c) => `${c.displayName}:${c.color}`).join(', ')],

  ['תיבת דואר — קריאה', 'GET', `/users/${MBX}/mailFolders/inbox?$select=displayName,totalItemCount,unreadItemCount`, null, 'v1.0',
    (j) => `${j.displayName}: ${j.totalItemCount} הודעות, ${j.unreadItemCount} לא נקראו`],

  ['תיקיות דואר', 'GET', `/users/${MBX}/mailFolders?$top=20&$select=displayName,totalItemCount`, null, 'v1.0',
    (j) => (j.value ?? []).map((f) => `${f.displayName}(${f.totalItemCount})`).join(', ')],

  ['סנכרון דלתא ליומן', 'GET', `/users/${MBX}/calendarView/delta?startDateTime=2026-08-01T00:00:00Z&endDateTime=2026-09-30T00:00:00Z&$top=1`, null, 'v1.0',
    (j) => `deltaLink=${j['@odata.deltaLink'] ? 'כן' : 'לא'}, nextLink=${j['@odata.nextLink'] ? 'כן' : 'לא'}`],

  ['סנכרון דלתא לדואר', 'GET', `/users/${MBX}/mailFolders/inbox/messages/delta?$top=1&$select=id`, null, 'v1.0',
    (j) => `deltaLink=${j['@odata.deltaLink'] ? 'כן' : 'לא'}, nextLink=${j['@odata.nextLink'] ? 'כן' : 'לא'}`],

  ['מנויי webhook קיימים', 'GET', '/subscriptions', null, 'v1.0',
    (j) => `${(j.value ?? []).length} מנויים פעילים`],

  ['אנשי קשר בתיבה', 'GET', `/users/${MBX}/contacts?$top=3&$select=displayName`, null, 'v1.0',
    (j) => `${(j.value ?? []).length} רשומות בדגימה`],

  ['משימות To Do', 'GET', `/users/${MBX}/todo/lists`, null, 'v1.0',
    (j) => (j.value ?? []).map((l) => l.displayName).join(', ')],

  ['אחסון OneDrive', 'GET', `/users/${MBX}/drive?$select=driveType,quota`, null, 'v1.0',
    (j) => `${j.driveType}; ${Math.round((j.quota?.used ?? 0) / 1e6)}MB בשימוש מתוך ${Math.round((j.quota?.total ?? 0) / 1e9)}GB`],

  ['אתרי SharePoint', 'GET', '/sites?search=*&$top=3&$select=displayName,webUrl', null, 'v1.0',
    (j) => (j.value ?? []).map((s) => s.displayName).join(', ')],

  ['משתמשים בטננט', 'GET', '/users?$top=10&$select=userPrincipalName,accountEnabled', null, 'v1.0',
    (j) => (j.value ?? []).map((u) => u.userPrincipalName).join(', ')],

  ['קבוצות', 'GET', '/groups?$top=10&$select=displayName,mailEnabled,groupTypes', null, 'v1.0',
    (j) => (j.value ?? []).map((g) => `${g.displayName}${g.mailEnabled ? '(דואר)' : ''}`).join(', ') || 'אין'],

  ['חדרים / משאבים', 'GET', '/places/microsoft.graph.room', null, 'v1.0',
    (j) => `${(j.value ?? []).length} חדרים מוגדרים`],

  ['Teams — צ׳אטים', 'GET', `/users/${MBX}/chats?$top=1`, null, 'v1.0',
    (j) => `${(j.value ?? []).length} בדגימה`],

  ['Bookings (תיאום תורים)', 'GET', '/solutions/bookingBusinesses', null, 'v1.0',
    (j) => `${(j.value ?? []).length} עסקים מוגדרים`],

  ['דוחות שימוש', 'GET', "/reports/getEmailActivityUserDetail(period='D7')", null, 'v1.0',
    () => 'CSV הוחזר'],

  ['יומן ביקורת (Entra)', 'GET', '/auditLogs/directoryAudits?$top=1', null, 'v1.0',
    (j) => `${(j.value ?? []).length} רשומות בדגימה`],

  ['התחברויות (sign-ins)', 'GET', '/auditLogs/signIns?$top=1', null, 'v1.0',
    (j) => `${(j.value ?? []).length} רשומות בדגימה`],

  ['הרשאות שהוענקו לאפליקציה', 'GET', `/servicePrincipals(appId='${CLIENT}')/appRoleAssignments?$top=999&$select=resourceDisplayName,appRoleId`, null, 'v1.0',
    (j) => `${(j.value ?? []).length} הרשאות אפליקציה מוענקות`],
];

(async () => {
  console.log(`טננט ${TENANT}\nתיבה  ${MBX}\n`);
  const open = [];
  const shut = [];
  for (const [label, method, path, body, version, summarise] of PROBES) {
    let r;
    try {
      r = await call(method, path, body, version);
    } catch (e) {
      shut.push([label, `EXC ${e.message}`]);
      console.log(`❌ ${label.padEnd(30)} חריגה: ${e.message}`);
      continue;
    }
    if (r.status >= 200 && r.status < 300) {
      let detail;
      try { detail = summarise(r.json ?? {}); } catch { detail = `HTTP ${r.status}`; }
      open.push([label, detail]);
      console.log(`✅ ${label.padEnd(30)} ${M(String(detail))}`);
    } else {
      const code = r.json?.error?.code ?? '';
      const msg = r.json?.error?.message ?? r.text;
      shut.push([label, `${r.status} ${code}`]);
      console.log(`⛔ ${label.padEnd(30)} ${r.status} ${code} — ${M(String(msg).replace(/\s+/g, ' '))}`);
    }
  }
  console.log(`\nפתוח: ${open.length} · חסום: ${shut.length}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
