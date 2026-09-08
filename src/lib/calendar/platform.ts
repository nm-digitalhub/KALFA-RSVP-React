// Which calendar hand-off a browser can do. Same user-agent tests as
// add-to-calendar-button 3.0.1 (dist/module/index.js `isIOS` / `isAndroid` /
// `isWebView`, read 2026-09-08), kept in one pure function so the client menu
// and its tests share them. This is presentation logic — it only decides which
// rows to show and how a link is opened; every URL is server-generated.
//
// `webview`: an iOS UA with AppleWebKit but no "Safari" token (WKWebView —
// Chrome/Firefox for iOS, Instagram/Facebook in-app browsers, WhatsApp's in-app
// browser when it is WKWebView-based) or an Android UA carrying "; wv".
// SFSafariViewController reports Safari's own UA and is NOT a webview here.

export type CalendarOs = 'ios' | 'android' | 'other';

export interface CalendarPlatform {
  os: CalendarOs;
  webview: boolean;
}

export function detectCalendarPlatform(userAgent: string): CalendarPlatform {
  const ua = userAgent || '';
  const ios = /iPad|iPhone|iPod/i.test(ua) && !/MSStream/i.test(ua);
  const android = /android/i.test(ua) && !/MSStream/i.test(ua);
  const webview = /; ?wv|(?:iPhone|iPod|iPad).*AppleWebKit(?!.*Safari)/i.test(ua);
  return { os: ios ? 'ios' : android ? 'android' : 'other', webview };
}

/**
 * Android intent URL that opens the Google Calendar APP with the pre-filled
 * event and falls back to the web editor when the app is missing — Chrome's
 * documented `intent:` syntax (developer.chrome.com/docs/android/intents:
 * `package=`, `scheme=`, `S.browser_fallback_url=` stripped before delivery;
 * launch requires a user gesture). Identical to what the library builds for
 * Android (MEASURED, generate_google). Not for WebViews: Chrome Custom Tabs
 * handle intents, `wv` WebViews generally do not — callers pass the plain URL.
 */
export function googleCalendarAndroidIntent(webUrl: string): string {
  if (!/^https:\/\//.test(webUrl)) throw new Error('googleCalendarAndroidIntent expects an https URL');
  return (
    'intent://' +
    webUrl.slice('https://'.length) +
    '#Intent;scheme=https;package=com.google.android.calendar;S.browser_fallback_url=' +
    encodeURIComponent(webUrl) +
    ';end'
  );
}
