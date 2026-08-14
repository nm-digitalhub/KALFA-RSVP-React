export interface BrowserPushSubscription {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
}

export interface PushMessagePayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  renotify?: boolean;
  /**
   * Show without sound or vibration. Used when a push only CORRECTS an alert the
   * agent already received — a call that has ended should not buzz a second time
   * for news that the first buzz already brought them to.
   */
  silent?: boolean;
}

export interface PushSendSummary {
  attempted: number;
  sent: number;
  failed: number;
  revoked: number;
}
