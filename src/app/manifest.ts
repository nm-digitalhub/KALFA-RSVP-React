import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'KALFA - ניהול אישורי הגעה',
    short_name: 'KALFA',
    description: 'פלטפורמה לניהול אישורי הגעה לאירועים פרטיים',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    dir: 'rtl',
    lang: 'he',
    background_color: '#FFFDF8',
    theme_color: '#FF5A3C',
    orientation: 'portrait',
    icons: [
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/maskable-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
