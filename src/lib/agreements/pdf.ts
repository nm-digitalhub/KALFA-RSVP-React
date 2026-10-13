import 'server-only';

import { createHash } from 'node:crypto';

import puppeteer from 'puppeteer';

// Render the package-terms approval HTML (the terms plus the approval block) to a
// PDF using a headless browser. The
// browser does correct Hebrew BiDi shaping of mixed text + amounts/IDs/dates
// natively (pdf-lib/pdfkit do not), which is essential for a legal document.
// Viable here because beta runs as a long-lived pm2 Node server (Chromium is
// installed once). The HTML is server-generated and trusted (no script exec).
export async function renderAgreementPdf(html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    // The HTML is self-contained: no signature image (the terms are approved,
    // not signed), no links and no external resources, so 'load' is sufficient.
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    });
  } finally {
    await browser.close();
  }
}

// SHA-256 of the final PDF bytes — stored separately from the file as tamper
// evidence (proves the approved document was not altered).
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
