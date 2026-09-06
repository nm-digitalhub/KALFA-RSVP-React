import { getAppUrl } from '@/lib/url';

// Shared page shell for the guest token surfaces (/r /g /ty /rate /join).
//
// It replaces four byte-similar local `Shell` copies — three were identical and
// one differed only in width — so the brand line below has ONE definition
// rather than five, and a change to guest chrome cannot land on some pages and
// miss others.
//
// LAYOUT, and why it is not just `justify-center` with an extra child: the old
// shells centred everything vertically in a `min-h-svh` column. Appending the
// brand line there would have centred it too, so it would read as another piece
// of content rather than as a signature. Here the children keep their centring
// inside a `flex-1` region and the line sits after it, pinned to the bottom of
// the viewport.

// The line is deliberately VISIBLE. Hidden text or a hidden link would be
// "content placed on a page solely to manipulate search engines and not to be
// easily viewable by human visitors" — named in Google's spam policies, with
// sites that do it ranking "lower in results or not appear in results at all".
// It would also achieve nothing: every one of these routes is either
// Disallow'ed in robots.txt or serves `noindex`, so Google never reads them.
//
// The point is not search ranking at all. Keyword data for this market shows
// people search by VENDOR NAME — a competitor's brand draws roughly as many
// searches as the whole category term — so the asset worth building here is a
// guest remembering who ran the event, not a link.
//
// `rel="nofollow"` is belt-and-braces: these pages are not crawled, so nothing
// is passed anywhere, but it states the intent and keeps a site-wide pattern of
// self-referential links from ever resembling a link scheme.
async function BrandLine() {
  // Same trusted-origin helper every shareable link uses — never the request
  // Host. UTM so the analytics dashboard can tell this traffic apart from
  // direct visits rather than guessing.
  const href = await getAppUrl(
    '/?utm_source=guest_page&utm_medium=referral&utm_campaign=guest_branding',
  );
  return (
    <p className="pt-8 text-center text-xs text-muted-foreground">
      מנוהל באמצעות{' '}
      <a
        href={href}
        rel="nofollow"
        className="font-semibold text-foreground/70 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        KALFA
      </a>
    </p>
  );
}

export async function GuestShell({
  children,
  width = 'lg',
}: {
  children: React.ReactNode;
  /** /r and /join were narrower than the rest; kept rather than silently rewidened. */
  width?: 'md' | 'lg';
}) {
  return (
    <main
      className={`mx-auto flex min-h-svh flex-col px-4 py-10 ${
        width === 'md' ? 'max-w-md' : 'max-w-lg'
      }`}
    >
      <div className="flex flex-1 flex-col justify-center gap-6">{children}</div>
      <BrandLine />
    </main>
  );
}
