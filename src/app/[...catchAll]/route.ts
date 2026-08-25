import type { NextRequest } from 'next/server';

import { addVary, isEligibleRequestMethod, negotiateMarkdown } from '@/lib/http/markdown-negotiation';
import { trustedAppOrigin } from '@/lib/http/trusted-origin';

// Catches every path nothing else in the app matched. Next.js always prefers
// a static or dynamic segment over a catch-all (verified against
// next/dist/shared/lib/router/utils/sorted-routes.js's UrlNode._smoosh, which
// sorts static children first, then `[slug]`, then `[...catchAll]` last) — so
// this can never shadow a real page, api route, or the 6-page Markdown
// allowlist in markdown-negotiation.ts.
//
// This does NOT delegate to notFound() from next/navigation. Two things were
// verified live before landing on that:
// 1. Next forbids a page.tsx and a route.ts at the same segment ("You cannot
//    have two parallel pages that resolve to the same path") — confirmed by
//    actually building both side by side — so `src/app/not-found.tsx`'s React
//    tree can never be reached from this file; there is no sibling page.tsx
//    to fall back to.
// 2. not-found.md documents notFound() inside a Route Handler as serving "a
//    404 to the caller" — no mention of rendering the not-found UI. Measured
//    live on 2026-08-24: it returns a genuinely empty body, no Content-Type.
//    A real visitor on a stale/mistyped link would see a blank page — a
//    regression from today's behavior, caught by curl before shipping.
//
// So both branches below render their own content directly. The HTML branch
// intentionally repeats not-found.tsx's exact Hebrew copy (not its Tailwind
// markup — that class list assumes the site's compiled stylesheet, which a
// Route Handler has no path to). Keep the two in sync if that copy changes.
function markdownNotFoundBody(): string {
  const origin = trustedAppOrigin();
  return [
    '# 404 — Page not found',
    '',
    'This page does not exist on kalfa.me.',
    '',
    '## Available pages',
    '',
    `- [Home](${origin}/)`,
    `- [FAQ](${origin}/faq)`,
    `- [Contact](${origin}/contact)`,
    `- [Terms](${origin}/terms)`,
    `- [Privacy](${origin}/privacy)`,
    `- [Cookies](${origin}/cookies)`,
    '',
  ].join('\n');
}

// Same on-brand copy and layout as not-found.tsx (owner spec 2026-08-25), and
// the SAME design token VALUES (not class names — a Route Handler has no path
// to the site's compiled/hashed Tailwind stylesheet, so colors are copied
// from src/app/globals.css `:root` directly). Two deliberate departures from
// not-found.tsx, both per the same spec:
// 1. System font stack, no next/font and no Google Fonts <link> — a Route
//    Handler returning a raw string has no path to next/font's self-hosting
//    pipeline at all (that only runs inside the JSX compilation), and a font
//    fetched at runtime is exactly the kind of extra round-trip a 404 should
//    not add. Earlier version of this file DID add a live fonts.googleapis.com
//    <link>; caught in review, removed.
// 2. The MailQuestionMark icon is redrawn as static inline SVG (path data
//    copied from node_modules/lucide-react's compiled icon, not guessed) —
//    lucide-react itself is a React component library, unusable from a
//    plain-string Route Handler.
// The "back" action needs a browser API a static string can't call from a
// declarative attribute alone, hence the one inline <script>; not-found.tsx's
// equivalent is a real Client Component (BackLink). Keep both in sync if this
// copy or layout changes.
function htmlNotFoundBody(): string {
  return [
    '<!doctype html>',
    '<html lang="he" dir="rtl">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    '<title>הדף לא נמצא | KALFA</title>',
    '<style>',
    ':root{--background:oklch(1 0 0);--foreground:oklch(.145 0 0);--card:oklch(1 0 0);--border:oklch(.922 0 0);',
    '--muted-foreground:oklch(.556 0 0);--primary:oklch(.511 .262 276.97);--primary-foreground:oklch(.985 0 0)}',
    '*{box-sizing:border-box}',
    "body{margin:0;min-height:100dvh;display:flex;flex-direction:column;align-items:center;",
    "padding:2.5rem 1.5rem 4rem;text-align:center;",
    "font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--background);color:var(--foreground)}",
    '.wordmark{display:inline-flex;align-items:center;gap:.5rem;font-size:1.5rem;font-weight:800;',
    'letter-spacing:-0.025em;color:var(--foreground);text-decoration:none}',
    '.wordmark img{border-radius:.5rem}',
    // Giant pale "404", deliberately overlapped by .card below — NOT via
    // position:absolute (an earlier version did that with a `top` offset
    // disconnected from the card's actual height, which hid all but a sliver
    // at the very top; caught live 2026-08-25, screenshot showed
    // unrecognizable fragments instead of "404"). Plain flow CSS instead: a
    // negative bottom margin pulls .card up over the watermark's lower
    // third. `body` is flex column, so margins here do NOT collapse the way
    // block siblings would — the gap is simply this margin-bottom PLUS
    // .card's margin-top, and no z-index is needed either: a later flex
    // item already paints over an earlier one wherever they overlap.
    // Fades the watermark's own opacity to zero right where .card covers it
    // (owner request 2026-08-25) instead of card transparency, which would
    // let "404" show through behind the card's real text/buttons and risk
    // contrast (WCAG 1.4.3) — this only touches the decorative element.
    '.watermark{margin-top:.5rem;margin-bottom:-2.5rem;font-size:7rem;font-weight:900;line-height:1;',
    "color:color-mix(in oklch, var(--primary) 15%, transparent);pointer-events:none;user-select:none;",
    "-webkit-mask-image:linear-gradient(to bottom, black 55%, transparent 100%);",
    "mask-image:linear-gradient(to bottom, black 55%, transparent 100%)}",
    '@media (min-width:640px){.watermark{font-size:9rem;margin-bottom:-3rem}}',
    '.card{margin-top:.5rem;width:100%;max-width:28rem;display:flex;flex-direction:column;',
    'align-items:center;gap:1rem;border-radius:1rem;border:1px solid var(--border);background:var(--card);',
    'padding:2.5rem 1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.06)}',
    '.icon-badge{display:flex;width:3rem;height:3rem;align-items:center;justify-content:center;border-radius:9999px;',
    "background:color-mix(in oklch, var(--primary) 10%, transparent)}",
    'h1{font-size:1.25rem;line-height:1.75rem;font-weight:700;margin:0}',
    'p{font-size:1rem;line-height:1.5rem;margin:0;color:var(--muted-foreground)}',
    '.btn{display:inline-block;width:100%;border-radius:.5rem;padding:.625rem 1rem;font-size:.875rem;',
    'line-height:1.25rem;font-weight:500;text-decoration:none;background:var(--primary);color:var(--primary-foreground)}',
    '@media (min-width:640px){.btn{width:auto;padding-inline:1.5rem}}',
    '.btn:hover{opacity:.9}',
    '.back{border:0;background:none;padding:0;font:inherit;font-size:.875rem;font-weight:500;color:var(--foreground);cursor:pointer}',
    '.back:hover{text-decoration:underline}',
    '.help{font-size:.875rem;color:var(--muted-foreground);text-decoration:none}',
    '.help:hover{text-decoration:underline}',
    '.footer-nav{margin-top:2rem;display:flex;align-items:center;gap:1rem;font-size:.875rem;color:var(--muted-foreground)}',
    '.footer-nav a{color:inherit;text-decoration:none}',
    '.footer-nav a:hover{text-decoration:underline}',
    '</style>',
    '</head>',
    '<body>',
    '<a href="/" class="wordmark"><img src="/icons/icon.svg" alt="" width="32" height="32">KALFA</a>',
    '<span class="watermark" aria-hidden="true">404</span>',
    '<div class="card">',
    // lucide-react "mail-question-mark" path data, copied verbatim from
    // node_modules/lucide-react/dist/esm/icons/mail-question-mark.mjs.
    '<div class="icon-badge"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ',
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ',
    'style="color:var(--primary)" aria-hidden="true">',
    '<path d="M22 10.5V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h12.5"/>',
    '<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    '<path d="M18 15.28c.2-.4.5-.8.9-1a2.1 2.1 0 0 1 2.6.4c.3.4.5.8.5 1.3 0 1.3-2 2-2 2"/>',
    '<path d="M20 22v.01"/>',
    '</svg></div>',
    '<h1>אופס, הדף הזה לא ברשימת המוזמנים</h1>',
    '<p>ייתכן שהקישור שגוי, שהדף הוסר או שההזמנה כבר אינה זמינה.</p>',
    '<a href="/" class="btn">חזרה לדף הבית</a>',
    '<button type="button" class="back" onclick="history.back()">חזרה לעמוד הקודם</button>',
    '<a href="/contact" class="help">צריכים עזרה? צרו איתנו קשר</a>',
    '</div>',
    '<nav class="footer-nav">',
    '<a href="/faq">שאלות נפוצות</a>',
    '<span aria-hidden="true">·</span>',
    '<a href="/contact">יצירת קשר</a>',
    '<span aria-hidden="true">·</span>',
    '<a href="/privacy">פרטיות</a>',
    '</nav>',
    '</body>',
    '</html>',
  ].join('\n');
}

function handle(request: NextRequest): Response {
  if (isEligibleRequestMethod(request) && negotiateMarkdown(request.headers.get('accept')) === 'markdown') {
    const headers = new Headers({ 'content-type': 'text/markdown; charset=utf-8' });
    addVary(headers, 'Accept');
    return new Response(markdownNotFoundBody(), { status: 404, headers });
  }
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
  addVary(headers, 'Accept');
  return new Response(htmlNotFoundBody(), { status: 404, headers });
}

export {
  handle as GET,
  handle as HEAD,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as OPTIONS,
};
