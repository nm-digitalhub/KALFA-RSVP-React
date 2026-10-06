import type { Metadata } from 'next';
import Image from 'next/image';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { getCallbackIntakeByToken } from '@/lib/data/callback-intake';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';

import { IntakeForm } from './intake-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'פרטים לשיחה חוזרת',
  robots: { index: false, follow: false },
};

const TOKEN_RE = /^[0-9a-f]{32}$/;
const INTAKE_VIEW_RATE = {
  limit: 30,
  windowMs: 60_000,
};

export default async function CallbackIntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!TOKEN_RE.test(token)) {
    notFound();
  }

  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));

  const limit = rateLimit(
    `cb-intake-view:${tokenFingerprint(token)}:${ip}`,
    INTAKE_VIEW_RATE,
  );

  if (!limit.allowed) {
    notFound();
  }

  const view = await getCallbackIntakeByToken(token);

  if (!view) {
    notFound();
  }

  return (
    <main
      dir="rtl"
      className="relative min-h-dvh overflow-hidden bg-[#fffdfb] text-[#171717]"
    >
      <CallbackBackground />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[500px] flex-col px-[18px] pb-8 pt-8 sm:pt-10">
        <header className="flex flex-col items-center text-center">
      <Image
  src="/images/kalfa-mark-round.webp"
  width={68}
  height={68}
  priority
  alt="KALFA"
  className="size-[68px] object-contain drop-shadow-[0_10px_20px_rgba(255,90,60,0.18)]"
/>

          <div className="mt-5">
            <CallbackPhoneIcon />
          </div>

          <h1 className="mt-5 text-balance text-[28px] font-extrabold leading-[1.22] tracking-[-0.04em] text-[#111827] sm:text-[31px]">
            התקשרת אלינו ולא הצלחנו לענות
          </h1>

          <p className="mt-3 text-[16px] font-medium leading-7 text-[#7c8189]">
            נחזור אליך. כדי שנגיע מוכנים, שתי שאלות קצרות.
          </p>

          <p className="mt-2 text-[16px] font-medium leading-7 text-[#7c8189]">
            נחזור אליך למספר שמסתיים ב-
            <span
              dir="ltr"
              className="mr-1 font-bold tabular-nums text-[#111827]"
            >
              {view.phone_hint}
            </span>
            .
          </p>
        </header>

        <section className="mt-5">
          <div className="rounded-[28px] border border-black/[0.045] bg-white/95 px-5 pb-6 pt-6 shadow-[0_24px_70px_rgba(34,28,24,0.07)] backdrop-blur-xl sm:px-6">
            <IntakeForm
              token={token}
              locked={view.locked}
            />
          </div>
        </section>

        <footer className="mt-8 flex items-center justify-center gap-4 pb-2 text-[13px] font-medium text-[#858585]">
          <span className="h-px w-12 bg-[#dddddd]" />

          <span>
            מנוהל באמצעות{' '}
            <strong
              dir="ltr"
              className="font-extrabold tracking-[-0.03em] text-[#525252]"
            >
              KALFA
            </strong>
          </span>

          <span className="h-px w-12 bg-[#dddddd]" />
        </footer>
      </div>
    </main>
  );
}

function CallbackBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="absolute -left-[195px] -top-[185px] size-[430px] rounded-full bg-[#ff6b53]/10 blur-[2px]" />

      <div className="absolute -left-[80px] -top-[30px] size-[320px] rounded-full bg-[#ff8b77]/10 blur-[55px]" />

      <div className="absolute -right-[250px] top-[125px] size-[470px] rounded-full bg-[#ff6b53]/13" />

      <div className="absolute -right-[130px] top-[260px] size-[330px] rounded-full bg-[#ffb7aa]/15 blur-[55px]" />

      <div className="absolute left-1/2 top-[300px] h-[430px] w-[520px] -translate-x-1/2 rounded-full bg-[#fff1ed]/60 blur-[80px]" />
    </div>
  );
}

function CallbackPhoneIcon() {
  return (
    <div className="flex size-[104px] items-center justify-center rounded-full border border-[#ffdad2] bg-[#fff1ed]/85 shadow-[0_12px_35px_rgba(255,90,60,0.07)]">
      <svg
        aria-hidden="true"
        viewBox="0 0 120 120"
        className="size-[70px]"
      >
        <defs>
          <linearGradient
            id="phone-fill"
            x1="20"
            y1="15"
            x2="95"
            y2="105"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#ff927e" />
            <stop offset="0.5" stopColor="#ff6c55" />
            <stop offset="1" stopColor="#f0442f" />
          </linearGradient>

          <linearGradient
            id="phone-shine"
            x1="24"
            y1="25"
            x2="70"
            y2="75"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#ffffff" stopOpacity=".52" />
            <stop offset=".65" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>

          <filter
            id="phone-shadow"
            x="-30%"
            y="-30%"
            width="160%"
            height="170%"
          >
            <feDropShadow
              dx="0"
              dy="7"
              stdDeviation="5"
              floodColor="#d83824"
              floodOpacity=".22"
            />
          </filter>
        </defs>

        <path
          filter="url(#phone-shadow)"
          fill="url(#phone-fill)"
          d="M34.8 21.2c4.2-1.8 9.1.1 11 4.3l9.1 20.7c1.6 3.7.4 8-2.9 10.3l-7.8 5.4c6.4 11.5 15.9 21 27.4 27.4l5.4-7.8c2.3-3.3 6.6-4.5 10.3-2.9l20.7 9.1c4.2 1.9 6.1 6.8 4.3 11l-4 9.3c-1.6 3.7-5.3 6.1-9.4 6.1C51.7 114.1 5.9 68.3 5.9 21.1c0-4.1 2.4-7.8 6.1-9.4l9.3-4c4.2-1.8 9.1.1 11 4.3l2.5 9.2Z"
          transform="translate(0 0) scale(.93)"
        />

        <path
          fill="url(#phone-shine)"
          opacity=".7"
          d="M22 19c4.7-2 9.8.2 11.8 4.7l7 16c1.4 3.2.3 7-2.5 9l-4.2 2.9C28 40 24.3 29.3 22 19Z"
        />

        <path
          d="M75 20c8 2.7 14.3 9 17 17"
          fill="none"
          stroke="#ff5a3c"
          strokeWidth="6"
          strokeLinecap="round"
        />

        <path
          d="M78 8c13.7 3.6 24.4 14.3 28 28"
          fill="none"
          stroke="#ff5a3c"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}