import { describe, expect, it } from 'vitest';

import { PACKAGE_SEED_BODY } from '@/test/agreement-seed';

import {
  findAgreementPdfCompatibilityIssues,
  parseAgreementPdfHtml,
} from './pdf-html';

describe('agreement PDF HTML compiler', () => {
  it('accepts the real package-contract seed', () => {
    expect(
      findAgreementPdfCompatibilityIssues(PACKAGE_SEED_BODY),
    ).toEqual([]);

    expect(
      parseAgreementPdfHtml(PACKAGE_SEED_BODY).length,
    ).toBeGreaterThan(0);
  });

  it('accepts the HTML structures the contract editor emits', () => {
    const html = `
      <h1>כותרת</h1>
      <h2>סעיף</h2>
      <h3>כותרת משנה</h3>

      <p>
        טקסט
        <strong>מודגש</strong>
        <em>נטוי</em>
        <s>מחוק</s>
        <a href="/terms">קישור</a>
        <br>
        שורה חדשה
      </p>

      <blockquote>
        <p>ציטוט</p>
      </blockquote>

      <ul>
        <li>פריט ראשון</li>
        <li>
          <p>פריט שני</p>
          <ol>
            <li>תת פריט</li>
          </ol>
        </li>
      </ul>

      <hr>

      <dl class="terms">
        <dt>מחיר</dt>
        <dd>₪200.00</dd>
      </dl>

      <div class="sub">כותרת משנה</div>
      <div class="intent">הדגשה</div>
      <span class="todo">[יושלם]</span>
    `;

    expect(
      findAgreementPdfCompatibilityIssues(html),
    ).toEqual([]);
  });

  it('rejects HTML that would otherwise disappear from the PDF', () => {
    expect(
      findAgreementPdfCompatibilityIssues(
        '<table><tr><td>אסור להיעלם</td></tr></table>',
      ),
    ).toEqual([
      'האלמנט <table> אינו נתמך בתוך טקסט PDF',
    ]);
  });

  it('rejects an unknown contract div class', () => {
    expect(
      findAgreementPdfCompatibilityIssues(
        '<div class="unknown">טקסט</div>',
      )[0],
    ).toContain('אינו div נתמך');
  });

  it('rejects unsafe link protocols', () => {
    expect(
      findAgreementPdfCompatibilityIssues(
        '<p><a href="javascript:alert(1)">קישור</a></p>',
      )[0],
    ).toContain('פרוטוקול שאינו נתמך');
  });
});