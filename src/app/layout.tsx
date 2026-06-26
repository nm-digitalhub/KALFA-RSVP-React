import type { Metadata } from 'next';
import { Heebo } from 'next/font/google';
import './globals.css';

// Heebo is the primary font (Hebrew + Latin) and drives shadcn's --font-sans.
const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'KALFA — ניהול אישורי הגעה',
  description: 'פלטפורמה לניהול אישורי הגעה לאירועים פרטיים',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full font-sans`}>
      <body className="min-h-full bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
