import { describe, expect, it } from 'vitest';

import { detectCalendarPlatform, googleCalendarAndroidIntent } from './platform';

const UA = {
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iosWkWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 14; SM-S928B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36',
  samsungInternet:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

describe('detectCalendarPlatform', () => {
  it('classifies iOS: Safari and SFSafariViewController are not webviews, WKWebView is', () => {
    expect(detectCalendarPlatform(UA.iosSafari)).toEqual({ os: 'ios', webview: false });
    expect(detectCalendarPlatform(UA.iosWkWebView)).toEqual({ os: 'ios', webview: true });
    // Chrome for iOS carries the Safari token → treated like Safari (the ICS row navigates).
    expect(detectCalendarPlatform(UA.iosChrome)).toEqual({ os: 'ios', webview: false });
  });

  it('classifies Android: Chrome / Samsung Internet vs a `wv` WebView', () => {
    expect(detectCalendarPlatform(UA.androidChrome)).toEqual({ os: 'android', webview: false });
    expect(detectCalendarPlatform(UA.samsungInternet)).toEqual({ os: 'android', webview: false });
    expect(detectCalendarPlatform(UA.androidWebView)).toEqual({ os: 'android', webview: true });
  });

  it('desktop and unknown → other', () => {
    expect(detectCalendarPlatform(UA.macSafari)).toEqual({ os: 'other', webview: false });
    expect(detectCalendarPlatform(UA.windowsChrome)).toEqual({ os: 'other', webview: false });
    expect(detectCalendarPlatform('')).toEqual({ os: 'other', webview: false });
  });
});

describe('googleCalendarAndroidIntent', () => {
  it("wraps the library's web URL in Chrome's intent syntax with an OS-mediated fallback", () => {
    const web = 'https://calendar.google.com/calendar/render?action=TEMPLATE&dates=20260712T203000%2F20260712T233000&text=x';
    const intent = googleCalendarAndroidIntent(web);
    expect(intent).toBe(
      'intent://calendar.google.com/calendar/render?action=TEMPLATE&dates=20260712T203000%2F20260712T233000&text=x' +
        '#Intent;scheme=https;package=com.google.android.calendar;S.browser_fallback_url=' +
        encodeURIComponent(web) +
        ';end',
    );
  });

  it('refuses a non-https input', () => {
    expect(() => googleCalendarAndroidIntent('javascript:alert(1)')).toThrow();
  });
});
