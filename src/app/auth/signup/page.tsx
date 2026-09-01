import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { BarChart3, CircleCheck, Send } from 'lucide-react';

import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'הרשמה' };

// Panel copy/feature list are a working draft carried over from the approved
// design canvas — not yet signed off as final product copy.
const FEATURES = [
  { icon: Send, label: 'שליחת הזמנות בוואטסאפ ובשיחת טלפון' },
  { icon: CircleCheck, label: 'מעקב אישורי הגעה בזמן אמת' },
  { icon: BarChart3, label: 'דוחות וניהול אורחים במקום אחד' },
];

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,560px)]">
      {/* Branded panel — hidden below `lg` in favor of the compact mobile
          brand mark above the form (mobile-brand below). Panel background is
          a light, barely-tinted wash toward the primary hue (277°), approved
          via the design canvas over both a dark panel and no panel. */}
      <div className="relative hidden flex-col overflow-hidden bg-[oklch(0.965_0.014_277)] px-12 py-14 lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(oklch(0.511 0.262 276.97 / 7%) 1.5px, transparent 1.5px)',
            backgroundSize: '22px 22px',
            maskImage: 'radial-gradient(circle at 30% 30%, black, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(circle at 30% 30%, black, transparent 70%)',
          }}
        />

        {/* Logo, headline and feature list are grouped as one flex block
            (not spread with justify-between) so they read as a single
            cluster instead of three unrelated floating elements. */}
        <div className="relative flex flex-1 flex-col justify-center gap-10">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/icons/icon.svg" alt="" width={40} height={40} className="rounded-lg" />
            <span className="text-xl font-extrabold tracking-tight">KALFA</span>
          </Link>

          <div className="max-w-sm">
            <h2 className="mb-4 text-3xl font-extrabold leading-tight text-balance">
              אישורי הגעה, בלי ההתרוצצות.
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              קלפה עוזרת לכם לנהל אורחים, לשלוח הזמנות ולעקוב אחרי אישורי הגעה — בוואטסאפ
              ובשיחות טלפון, הכל במקום אחד.
            </p>

            <ul className="mt-7 flex flex-col gap-3.5">
              {FEATURES.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3 text-sm font-medium">
                  <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-background shadow-[0_1px_2px_oklch(0.511_0.262_276.97/10%)]">
                    <Icon className="size-4 text-primary" aria-hidden="true" />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="relative text-xs text-muted-foreground">© קלפה — ניהול אירועים חכם</p>
      </div>

      <main className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 flex items-center justify-center gap-2.5 lg:hidden">
            <Image src="/icons/icon.svg" alt="" width={34} height={34} className="rounded-lg" />
            <span className="text-lg font-extrabold tracking-tight">KALFA</span>
          </Link>

          {/* Headline bounded together with the form inside one card, so
              they read as a single unit rather than independent siblings. */}
          <div className="rounded-xl border border-border bg-card px-6 py-6 shadow-[0_1px_2px_oklch(0_0_0/4%),0_18px_40px_-24px_oklch(0.511_0.262_276.97/22%)]">
            <div className="mb-6 space-y-1 text-center">
              <h1 className="text-2xl font-bold">הרשמה</h1>
              <p className="text-sm text-muted-foreground">צרו חשבון כדי להתחיל לנהל אירועים</p>
            </div>

            <SignupForm salesRef={typeof ref === 'string' ? ref : undefined} />
          </div>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            כבר יש לכם חשבון?{' '}
            <Link href="/auth/login" className="font-medium text-primary hover:underline">
              התחברות
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
