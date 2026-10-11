// The campaign terms document: the fixed-price package contract. Pure HTML builders (no I/O) so the exact bytes
// rendered to PDF (and hashed) are deterministic, and the SAME body is shown to the customer before approving.
//
// The contract is DB-managed (table agreement_documents, /admin/agreement): version + status (draft/approved) + its
// body, rendered with safe {{token}} substitution. There is no in-code text. This module stays PURE — the document is
// passed in as `doc`. The draft marker is appended here based on `doc.status`, so approving the contract removes it
// regardless of the body.
//
// Legal basis (Israeli Consumer Protection Law §14ג distance-selling
// disclosures, Privacy Protection Law §11 + Amendment 13, Communications Law
// §30א, Electronic Signature Law). ⚠️ The wording must be approved by a
// licensed Israeli consumer-protection lawyer before go-live.

import { escapeHtml as esc } from '@/lib/html';
import { listTokens, substituteTokens as substituteTokensCore } from '@/lib/text/substitute-tokens';

// The package contract version (docs/superpowers/plans/2026-10-04-package-payment-plan.md). The price is one amount
// agreed up front and charged once at purchase. The owner approves the document with EXACTLY this string (approving
// strips the "draft-" prefix). Records signed under the older pay-per-result versions keep their stored PDF; nothing
// renders those versions again.
export const PACKAGE_AGREEMENT_VERSION = '2026-10-v6';

const PACKAGE_AGREEMENT_VERSIONS: ReadonlySet<string> = new Set([
  PACKAGE_AGREEMENT_VERSION,
  `draft-${PACKAGE_AGREEMENT_VERSION}`,
]);

export const PACKAGE_BODY_MANAGED_IN_ADMIN =
  'package agreement has no in-code text: its body is managed in the admin panel (/admin/agreement)';

export function isPackageAgreementVersion(
  version: string | null | undefined,
): boolean {
  return version != null && PACKAGE_AGREEMENT_VERSIONS.has(version);
}

// Standard Israeli VAT rate (18% since 2025-01-01). The business operates as an
// עוסק פטור (VAT-exempt dealer, VAT Law §31(3)) and does NOT charge VAT —
// consumer prices are FINAL with no VAT component, and customer-facing wording
// must never claim "כולל מע"מ". This constant only feeds the `vatRate`
// placeholder available to the agreement body (tokenMap).
export const VAT_RATE_PERCENT = 18;

export type AgreementStatus = 'draft' | 'approved';

// The agreement document (from the DB) injected into the renderers.
export type AgreementDoc = {
  version: string;
  status: AgreementStatus;
  /** The contract HTML with {{tokens}}. There is no in-code text: an empty body cannot be rendered. */
  bodyHtml: string | null;
};

export type CompanyInfo = {
  name: string;
  id: string;
  address: string;
  contactPhone: string;
  contactEmail: string;
  privacyUrl: string;
  termsUrl: string;
  warrantyText: string;
};

export type AgreementContent = {
  company: CompanyInfo;
  eventName: string;
  channels: string[];
  windowText: string;
  // The package's one price (₪, final — the business is VAT-exempt) and how many contacts the campaign may approach.
  packagePrice: number;
  contactQuota: number;
};

// The customer's APPROVAL of the terms (they ticked the box): who, when, and from which address. The version comes
// from the document.
export type AgreementApproval = {
  approverName: string;
  approvedDateText: string;
  ip: string | null;
};

// Exported so other surfaces that display the channel list (e.g. the public
// FAQ page's {channels_list} token, src/lib/faq/tokens.ts) reuse this exact
// mapping instead of hand-rolling a second one that can drift from it.
export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'וואטסאפ',
  call: 'שיחה טלפונית (AI)',
};

function ils(n: number): string {
  return `₪${n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Either the configured value or a clearly-marked placeholder, so a missing
// §14ג disclosure is visible (not silently blank).
function orTodo(v: string): string {
  return v.trim() ? esc(v.trim()) : '<span class="todo">[יושלם]</span>';
}

// The draft marker. Appended by the renderer ONLY for a draft document, so the
// Approve action (status → approved) removes it without touching the body.
const DRAFT_MARKER =
  '\n\n  <div class="draft">טיוטה — נוסח משפטי לאישור עו"ד (דיני הגנת הצרכן) טרם הפעלה מסחרית.</div>';

// Shared CSS — injected into the PDF document AND the on-page preview so the
// customer sees exactly what is approved.
export const AGREEMENT_CSS = `
  .agreement-doc { font-family: "Noto Sans Hebrew", "DejaVu Sans", sans-serif; direction: rtl; color: #1a1a1a; line-height: 1.7; }
  .agreement-doc h1 { font-size: 22px; margin: 0 0 4px; }
  .agreement-doc .sub { color: #666; font-size: 13px; margin-bottom: 20px; }
  .agreement-doc h2 { font-size: 16px; margin: 20px 0 6px; border-bottom: 1px solid #e3e3e8; padding-bottom: 4px; }
  .agreement-doc p { margin: 6px 0; }
  .agreement-doc ul { padding-inline-start: 22px; margin: 6px 0; }
  .agreement-doc dl.terms { background: #f7f7f9; border: 1px solid #e3e3e8; border-radius: 8px; padding: 14px; display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 6px 0; }
  .agreement-doc dl.terms dt { font-weight: 700; }
  .agreement-doc dl.terms dd { margin: 0; }
  .agreement-doc .intent { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px; font-weight: 600; }
  .agreement-doc .todo { color: #b45309; font-weight: 700; }
  .agreement-doc .meta { color: #555; font-size: 12px; margin-top: 8px; }
  .agreement-doc .draft { color: #b45309; font-size: 11px; margin-top: 22px; }
`;

// The fixed, safe placeholder set available to the (admin-edited) body.
// Values are pre-escaped/formatted; substitution is a literal token replace
// (no eval). Unknown tokens are left as-is.
function tokenMap(c: AgreementContent, version: string): Record<string, string> {
  const channelList = c.channels.map((ch) => CHANNEL_LABELS[ch] ?? ch).join(', ');
  const privacyLink = `<a href="${esc(c.company.privacyUrl.trim() || '/privacy')}">מדיניות הפרטיות</a>`;
  const termsLink = `<a href="${esc(c.company.termsUrl.trim() || '/terms')}">תנאי השירות</a>`;
  return {
    version: esc(version),
    eventName: esc(c.eventName),
    packagePrice: ils(c.packagePrice),
    contactQuota: c.contactQuota.toLocaleString('he-IL'),
    channels: esc(channelList),
    windowText: esc(c.windowText),
    vatRate: String(VAT_RATE_PERCENT),
    'company.name': orTodo(c.company.name),
    'company.id': orTodo(c.company.id),
    'company.address': orTodo(c.company.address),
    'company.contactPhone': orTodo(c.company.contactPhone),
    'company.contactEmail': orTodo(c.company.contactEmail),
    'company.warrantyText': orTodo(c.company.warrantyText),
    privacyLink,
    termsLink,
  };
}

// The built-in token names, derived from tokenMap itself so the list the editor shows and the validation below can never
// drift from what the renderer actually substitutes.
const PROBE_CONTENT: AgreementContent = {
  company: { name: '', id: '', address: '', contactPhone: '', contactEmail: '', privacyUrl: '', termsUrl: '', warrantyText: '' },
  eventName: '',
  channels: [],
  windowText: '',
  packagePrice: 0,
  contactQuota: 0,
};
export const AGREEMENT_TOKEN_KEYS: readonly string[] = Object.keys(tokenMap(PROBE_CONTENT, ''));

// Tokens a body uses that neither the built-in set nor the admin-config set resolves: a typo would reach the customer
// as literal {{braces}}, so approval refuses a body that has any.
export function findUnknownTokens(html: string, configKeys: readonly string[] = []): string[] {
  const known = new Set([...AGREEMENT_TOKEN_KEYS, ...configKeys]);
  return listTokens(html).filter((t) => !known.has(t));
}

// The tokens the editor offers: the built-in set plus the admin-config ones.
export function agreementTokens(configKeys: readonly string[] = []): string[] {
  return [...AGREEMENT_TOKEN_KEYS, ...configKeys];
}

// A package contract that does not state the price and the quota is not a package contract.
export const PACKAGE_REQUIRED_TOKENS = ['packagePrice', 'contactQuota'] as const;
export function missingPackageTokens(html: string): string[] {
  const used = new Set(listTokens(html));
  return PACKAGE_REQUIRED_TOKENS.filter((t) => !used.has(t));
}

// `extraTokens` lets render callers inject ADDITIONAL placeholders (e.g. the
// admin-config tokens serviceActivationWindow / offerValidityDays / liabilityCap /
// retentionDays / recordRetentionMonths) so the body may reference them. They
// are treated as plain text and run through esc() here — therefore the caller (and the data layer it reads from) MUST pass
// RAW, un-escaped strings; escaping is owned by this module to avoid double-escape.
//
// Precedence: built-in tokens WIN on key collision (extraTokens are spread first,
// the built-in map last), so config can never shadow a vetted built-in value. The
// config tokens above don't collide with any built-in name, so this is purely a
// defensive guarantee. Unknown tokens (in neither map) are left literal.
function substituteTokens(
  html: string,
  c: AgreementContent,
  version: string,
  extraTokens: Record<string, string> = {},
): string {
  const escapedExtra: Record<string, string> = {};
  for (const [key, value] of Object.entries(extraTokens)) {
    escapedExtra[key] = esc(value);
  }
  const tokens = { ...escapedExtra, ...tokenMap(c, version) };
  // The regex/replace mechanics themselves live in the shared core
  // (src/lib/text/substitute-tokens.ts) — this function's own job is only
  // building `tokens` (the AgreementContent-specific map, HTML-escaped) and
  // handing it off.
  return substituteTokensCore(html, tokens);
}

// The agreement body (all clauses) — shown to the customer before approving AND
// embedded in the PDF. No approval block here. `doc` gives the body, its version,
// and whether the draft marker is appended (status='draft').
//
// See substituteTokens for escaping + precedence of `extraTokens`. Pass RAW
// (un-escaped) admin-config values — this module escapes them.
export function renderAgreementBody(
  c: AgreementContent,
  doc: AgreementDoc,
  extraTokens: Record<string, string> = {},
): string {
  // The contract has no in-code text: an empty body is never rendered as one.
  if (doc.bodyHtml == null || doc.bodyHtml.trim() === '') {
    throw new Error(PACKAGE_BODY_MANAGED_IN_ADMIN);
  }
  const inner = substituteTokens(doc.bodyHtml, c, doc.version, extraTokens);
  return doc.status === 'draft' ? inner + DRAFT_MARKER : inner;
}

// Full self-contained HTML document for the PDF: CSS + body + approval block.
// `extraTokens` are forwarded to the body; pass RAW values.
export function renderAgreementDocument(
  c: AgreementContent,
  approval: AgreementApproval,
  doc: AgreementDoc,
  extraTokens: Record<string, string> = {},
): string {
  const approvalBlock = `
  <div class="sig">
    <h2>אישור תנאי החבילה</h2>
    <div class="meta">אושר על ידי: ${esc(approval.approverName)} · תאריך: ${esc(approval.approvedDateText)}${approval.ip ? ` · IP: ${esc(approval.ip)}` : ''} · גרסה: ${esc(doc.version)}</div>
    <div class="meta">האישור ניתן באתר, בסימון תיבת האישור לאחר שהלקוח קרא את התנאים.</div>
  </div>`;

  return `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><style>* { box-sizing: border-box; } body { margin: 40px; }${AGREEMENT_CSS}</style></head>
<body><div class="agreement-doc">${renderAgreementBody(c, doc, extraTokens)}${approvalBlock}</div></body>
</html>`;
}
