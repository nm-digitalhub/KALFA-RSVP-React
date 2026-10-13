import { describe, expect, it } from 'vitest';

import { PACKAGE_SEED_BODY } from '@/test/agreement-seed';

import { findAgreementPdfCompatibilityIssues, parseAgreementPdfHtml } from './pdf-html';

describe('agreement PDF HTML compiler', () => {
  it('accepts the real package-contract seed', () => {
    expect(findAgreementPdfCompatibilityIssues(PACKAGE_SEED_BODY)).toEqual([]);

    expect(parseAgreementPdfHtml(PACKAGE_SEED_BODY).length).toBeGreaterThan(0);
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

    expect(findAgreementPdfCompatibilityIssues(html)).toEqual([]);
  });

  it('rejects HTML that would otherwise disappear from the PDF', () => {
    expect(
      findAgreementPdfCompatibilityIssues('<table><tr><td>אסור להיעלם</td></tr></table>'),
    ).toEqual(['האלמנט <table> אינו נתמך בתוך טקסט PDF']);
  });

  it('rejects an unknown contract div class', () => {
    expect(findAgreementPdfCompatibilityIssues('<div class="unknown">טקסט</div>')[0]).toContain(
      'class שאינו נתמך',
    );
  });

  it('rejects unsafe link protocols', () => {
    expect(
      findAgreementPdfCompatibilityIssues('<p><a href="javascript:alert(1)">קישור</a></p>')[0],
    ).toContain('פרוטוקול שאינו נתמך');
  });
});
describe('document HTML and typed styles', () => {
  it.each([
    'u',
    'mark',
    'code',
    'sub',
    'sup',
    'small',
    'span',
    'abbr',
    'cite',
    'time',
    'bdi',
    'bdo',
    'strong',
    'b',
    'em',
    'i',
    's',
    'strike',
    'del',
  ])('accepts inline <%s>', (tag) => {
    expect(findAgreementPdfCompatibilityIssues(`<p><${tag} dir="rtl">טקסט</${tag}></p>`)).toEqual(
      [],
    );
  });
  it.each([
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'div',
    'section',
    'article',
    'aside',
    'address',
    'blockquote',
    'li',
    'dl',
    'dt',
    'dd',
    'pre',
  ])('accepts block <%s>', (tag) => {
    expect(findAgreementPdfCompatibilityIssues(`<${tag} dir="ltr">Text</${tag}>`)).toEqual([]);
  });
  it('keeps nested semantic content, directions and styles', () => {
    const [block] = parseAgreementPdfHtml(
      '<div dir="rtl"><p><span dir="ltr" style="color:blue"><u><mark><strong> A </strong>B</mark></u></span></p></div>',
    );
    expect(block).toMatchObject({
      type: 'container',
      style: { direction: 'rtl' },
      blocks: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'span',
              style: { direction: 'ltr', color: '#0000ff' },
              children: [
                {
                  type: 'u',
                  children: [
                    {
                      type: 'mark',
                      children: [
                        { type: 'strong', children: [{ type: 'text', value: ' A ' }] },
                        { type: 'text', value: 'B' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });
  it('preserves pre whitespace through nested code and strong elements', () => {
    expect(
      parseAgreementPdfHtml('<pre><code>  a\n\tb  <strong> c\n d </strong>\n</code></pre>'),
    ).toEqual([
      {
        type: 'pre',
        children: [
          {
            type: 'code',
            children: [
              { type: 'text', value: '  a\n\tb  ' },
              { type: 'strong', children: [{ type: 'text', value: ' c\n d ' }] },
              { type: 'text', value: '\n' },
            ],
          },
        ],
      },
    ]);
  });
  it('does not remove nonbreaking spaces or spaces inside inline elements', () => {
    expect(parseAgreementPdfHtml('<p>&nbsp;<strong> word </strong>tail&nbsp;</p>')).toMatchObject([
      {
        children: [
          { value: '\u00a0' },
          { children: [{ value: ' word ' }] },
          { value: 'tail\u00a0' },
        ],
      },
    ]);
  });
  it('converts all supported text CSS to typed values (px = 0.75pt)', () => {
    const [block] = parseAgreementPdfHtml(
      `<p dir="rtl" style="color:rgb(10, 20, 30); background-color:rgba(1,2,3,0.5); opacity:0.8; font-size:16px; font-weight:bold; font-style:italic; letter-spacing:2px; line-height:24px; text-align:center; text-decoration:underline line-through; text-decoration-color:red; text-decoration-style:dotted; text-indent:8px; text-transform:uppercase; vertical-align:super; direction:ltr">x</p>`,
    );
    expect(block.style).toEqual({
      color: '#0a141e',
      backgroundColor: '#01020380',
      opacity: 0.8,
      fontSize: 12,
      fontWeight: 700,
      fontStyle: 'italic',
      letterSpacing: 1.5,
      lineHeight: '18pt',
      textAlign: 'center',
      textDecoration: 'underline line-through',
      textDecorationColor: '#ff0000',
      textDecorationStyle: 'dotted',
      textIndent: 6,
      textTransform: 'uppercase',
      verticalAlign: 'super',
      direction: 'ltr',
    });
  });
  it('expands box shorthands and respects declaration order', () => {
    const [block] = parseAgreementPdfHtml(
      '<div style="margin:4px 8px 12px 16px; margin-left:20px; padding:2pt 4pt; padding-top:8px; padding-right:12px; padding-bottom:16px; padding-left:20px; border:2px solid #123; border-width:4px 8px; border-color:red blue; border-style:dashed dotted; border-radius:4px 8px 12px 16px">x</div>',
    );
    expect(block.style).toEqual({
      marginTop: 3,
      marginRight: 6,
      marginBottom: 9,
      marginLeft: 15,
      paddingTop: 6,
      paddingRight: 9,
      paddingBottom: 12,
      paddingLeft: 15,
      borderTopWidth: 3,
      borderRightWidth: 6,
      borderBottomWidth: 3,
      borderLeftWidth: 6,
      borderTopColor: '#ff0000',
      borderRightColor: '#0000ff',
      borderBottomColor: '#ff0000',
      borderLeftColor: '#0000ff',
      borderTopStyle: 'dashed',
      borderRightStyle: 'dotted',
      borderBottomStyle: 'dashed',
      borderLeftStyle: 'dotted',
      borderTopLeftRadius: 3,
      borderTopRightRadius: 6,
      borderBottomRightRadius: 9,
      borderBottomLeftRadius: 12,
    });
    expect(
      parseAgreementPdfHtml('<p style="margin-left:20px;margin:0;line-height:1.5">x</p>')[0].style,
    ).toEqual({ marginLeft: 0, marginTop: 0, marginRight: 0, marginBottom: 0, lineHeight: 1.5 });
  });
  it('keeps styles on list items and terms cells, including nested blocks', () => {
    expect(
      parseAgreementPdfHtml(
        '<ul style="color:red"><li style="font-weight:700"><p>x</p></li></ul>',
      )[0],
    ).toMatchObject({ style: { color: '#ff0000' }, items: [{ style: { fontWeight: 700 } }] });
    expect(
      parseAgreementPdfHtml(
        '<dl class="terms"><dt dir="ltr">Fee</dt><dd style="color:blue"><p>10</p><ul><li>tax</li></ul></dd></dl>',
      )[0],
    ).toMatchObject({
      type: 'terms',
      rows: [
        {
          termStyle: { direction: 'ltr' },
          definitionStyle: { color: '#0000ff' },
          definition: [{ type: 'paragraph' }, { type: 'list' }],
        },
      ],
    });
  });
  it.each([
    'https://kalfa.me',
    'http://kalfa.me',
    'mailto:a@example.com',
    'tel:+972501234567',
    '/terms',
    './terms',
    '../terms',
    'terms',
    '?page=terms',
    '#terms',
  ])('keeps safe link %s', (href) => {
    expect(findAgreementPdfCompatibilityIssues(`<a href="${href}">link</a>`)).toEqual([]);
  });
  it.each([
    'script',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'select',
    'textarea',
    'img',
    'table',
  ])('rejects <%s>', (tag) => {
    expect(findAgreementPdfCompatibilityIssues(`<${tag}>x</${tag}>`).join()).toContain(tag);
  });
  it.each([
    'position:absolute',
    'display:none',
    'color:var(--ink)',
    'font-size:huge',
    'font-size:2em',
    'padding:-1px',
    'opacity:NaN',
    'opacity:2',
    'border:1px double red',
    'line-height:calc(1 + 1)',
    'text-decoration:blink',
    'color:red !important',
    'color:rgb(999,0,0)',
    'color:constructor',
    'margin:1px 2px 3px 4px 5px',
    'color',
  ])('reports unsupported CSS: %s', (css) => {
    const issues = findAgreementPdfCompatibilityIssues(`<p style="${css}">x</p>`);
    expect(issues.join()).toContain(css);
    expect(() => parseAgreementPdfHtml(`<p style="${css}">x</p>`)).toThrow();
  });
  it.each([
    '<html onclick="x()"><p>x</p></html>',
    '<body style="display:none"><p>x</p></body>',
    '<p onclick="alert(1)">x</p>',
    '<span onmouseover="x()">x</span>',
    '<a href="java&#x09;script:alert(1)">x</a>',
    '<a href="data:text/html,x">x</a>',
    '<del cite="javascript:alert(1)">x</del>',
    '<p dir="auto">x</p>',
    '<span style="padding:2px">x</span>',
  ])('fails closed for unsafe or unrepresentable attributes: %s', (html) => {
    expect(findAgreementPdfCompatibilityIssues(html).length).toBeGreaterThan(0);
  });
});
