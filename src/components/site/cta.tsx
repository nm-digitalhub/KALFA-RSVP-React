import { cva, type VariantProps } from 'class-variance-authority';

// Class builder for the marketing-site CTA links (hero, closing banner, header,
// mobile drawer, event-type / whatsapp / guest-list-template pages).
//
// The same four looks were hand-rolled as ~14 near-identical class strings
// across six files (design audit, page-design-briefs "Landing-page CTA
// buttons ×8"). It is a class builder rather than a component ON PURPOSE:
// every call site is a Next.js <Link> or a plain <a> (a download link, an
// in-page anchor), so wrapping them in a component would only add a layer
// between the link and its href. It is also NOT `buttonVariants` from
// ui/button: those sizes top out at h-11 / md:h-9 (an app control), while a
// marketing CTA is a 48–52px target that must not shrink on desktop.
//
// Colours are the ones already on the pages (brand review: colours out of
// scope) — only the STRUCTURE is shared: 44px+ touch target and visible
// keyboard focus (v4 `outline-*`, forced-colors safe — same rule as
// site-footer.tsx). `hover:opacity-90` is the existing hover; the primary
// variant adds a static primary-tinted shadow. The hover lift / press classes
// follow the public-pages motion layer (src/app/motion.css: `ease-k-out`,
// motion-safe only, translate + scale = compositor-only).
export const siteCta = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-md font-semibold',
    'transition duration-300 ease-k-out motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground shadow-sm shadow-primary/25 hover:opacity-90 hover:shadow-md hover:shadow-primary/30',
        outline: 'border border-border hover:bg-[#f9fafb]',
        // The two looks that live INSIDE the dark navy / primary closing banners.
        dark: 'bg-[#0b0f1a] text-white hover:opacity-90 focus-visible:outline-white/70',
        onPrimary:
          'border border-white/40 bg-white/15 text-primary-foreground hover:bg-white/25 focus-visible:outline-white/70',
      },
      size: {
        sm: 'min-h-10 px-4 py-2 text-sm',
        md: 'min-h-11 px-4 py-2.5 text-sm',
        lg: 'min-h-12 px-6 py-3',
        xl: 'min-h-13 px-7 py-3.5',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'lg',
    },
  },
);

export type SiteCtaProps = VariantProps<typeof siteCta>;
