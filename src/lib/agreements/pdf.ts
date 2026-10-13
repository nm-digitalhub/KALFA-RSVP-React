import 'server-only';

import { createHash } from 'node:crypto';
import { renderToBuffer } from '@react-pdf/renderer';

import { getAppOrigin } from '@/lib/url';

import { AgreementPdfDocument } from './pdf-document';
import { parseAgreementPdfHtml } from './pdf-html';
import {
  renderAgreementBody,
  type AgreementApproval,
  type AgreementContent,
  type AgreementDoc,
} from './template';

export type AgreementPdfInput = {
  content: AgreementContent;
  approval: AgreementApproval;
  doc: AgreementDoc;
  extraTokens?: Record<string, string>;
};

export async function renderAgreementPdf(
  input: AgreementPdfInput,
): Promise<Uint8Array> {
  const html = renderAgreementBody(
    input.content,
    input.doc,
    input.extraTokens ?? {},
  );

  const blocks = parseAgreementPdfHtml(html);
  const appOrigin = await getAppOrigin();

  const buffer = await renderToBuffer(
    AgreementPdfDocument({
      blocks,
      approval: input.approval,
      version: input.doc.version,
      appOrigin,
    }),
  );

  return new Uint8Array(buffer);
}

// SHA-256 of the final PDF bytes — stored separately from the file as tamper
// evidence (proves the approved document was not altered).
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}