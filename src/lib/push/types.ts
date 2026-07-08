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
}

export interface PushSendSummary {
  attempted: number;
  sent: number;
  failed: number;
  revoked: number;
}
