/**
 * Relocation wizard — bilingual label catalog.
 *
 * Every state-describing string carried in `.relocation-state.json` is a
 * `Label {en, he}`: the CLI renders `en` (terminal RTL is unreliable — design
 * doc §3), the /admin/relocation page renders `he` in the app's existing RTL
 * UI. Both languages live side by side here so a change is reviewable in one
 * diff. CLI-only chrome (flag help, prompt text) is en-only and lives with the
 * CLI, not here.
 */
import type { GateId, Label, StageId, WaitingKind } from "./state";

export const STAGE_LABELS: Record<StageId, Label> = {
  A: { en: "Preflight", he: "בדיקות מקדימות" },
  B: { en: "Async lead items", he: "תהליכים חיצוניים מקדימים" },
  C: { en: "Infrastructure", he: "תשתית" },
  D: { en: "App switch", he: "החלפת הכתובת באפליקציה" },
  E: { en: "Old-origin continuity", he: "רציפות הדומיין הישן" },
  F: { en: "External registrations", he: "עדכון שירותים חיצוניים" },
  G: { en: "Database updates", he: "עדכוני בסיס נתונים" },
  H: { en: "Verification", he: "אימות" },
  I: { en: "Open items", he: "פריטים פתוחים" },
};

export const GATE_LABELS: Record<GateId, { label: Label; consequence: Label }> = {
  "conflict-existing-site": {
    label: {
      en: "Target domain already serves a site",
      he: "דומיין היעד כבר משרת אתר קיים",
    },
    consequence: {
      en: "Proceeding will shadow the existing site — visitors get KALFA instead. The wizard never deletes the existing site's files.",
      he: "המשך יצל על האתר הקיים — מבקרים יקבלו את KALFA במקומו. האשף לעולם אינו מוחק את קובצי האתר הקיים.",
    },
  },
  "voximplant-scenario-redeploy": {
    label: {
      en: "Redeploy Voximplant scenarios",
      he: "פריסה מחדש של תסריטי Voximplant",
    },
    consequence: {
      en: "Updates live telephony scenarios. A mistake affects real calls.",
      he: "מעדכן תסריטי טלפוניה חיים. טעות משפיעה על שיחות אמיתיות.",
    },
  },
  "meta-template-submit": {
    label: {
      en: "Submit new WhatsApp template versions to Meta",
      he: "הגשת גרסאות תבנית חדשות ל-Meta",
    },
    consequence: {
      en: "Submits _v2 templates with the new domain for Meta approval (days). Existing templates are never deleted.",
      he: "מגיש תבניות _v2 עם הדומיין החדש לאישור Meta (ימים). תבניות קיימות לעולם לא נמחקות.",
    },
  },
  "meta-approval-override": {
    label: {
      en: "Proceed without Meta template approval",
      he: "המשך ללא אישור תבניות Meta",
    },
    consequence: {
      en: "Old template buttons will ride the 301 redirect until the new templates are approved.",
      he: "כפתורי התבניות הישנות יעברו דרך הפניית 301 עד לאישור התבניות החדשות.",
    },
  },
  "dns-write-local-zone": {
    label: {
      en: "Write DNS record in the local Plesk zone",
      he: "כתיבת רשומת DNS באזור המקומי ב-Plesk",
    },
    consequence: {
      en: "Changes public DNS for the target domain hosted on this server.",
      he: "משנה DNS ציבורי לדומיין היעד המתארח בשרת זה.",
    },
  },
  "go-live": {
    label: { en: "Approve the plan and start", he: "אישור התוכנית והתחלה" },
    consequence: {
      en: "Stage D briefly restarts the app (seconds of downtime).",
      he: "שלב D מפעיל מחדש את האפליקציה (שניות של השבתה).",
    },
  },
};

export const WAITING_LABELS: Record<WaitingKind, Label> = {
  "dns-propagation": {
    en: "Waiting for DNS propagation",
    he: "ממתין להתפשטות DNS",
  },
  "meta-template-approval": {
    en: "Waiting for Meta template approval",
    he: "ממתין לאישור תבניות Meta",
  },
  "cert-issuance-retry": {
    en: "Waiting to retry TLS certificate issuance",
    he: "ממתין לניסיון חוזר של הנפקת תעודת TLS",
  },
};
