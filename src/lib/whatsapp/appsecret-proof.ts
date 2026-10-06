import { createHmac } from 'node:crypto';

// `appsecret_proof` — signs a server-to-server Graph call so a stolen access
// token alone cannot be replayed from elsewhere.
//
// ⚠️ TWO META PAGES DISAGREE, AND THE CHOICE HERE IS MEASURED, NOT ASSUMED.
//   graph-api/securing-requests:  hash_hmac('sha256', $access_token, $app_secret)
//   facebook-login/security:      hash_hmac('sha256', $access_token.'|'.time(), $app_secret)
//                                 + appsecret_time; "expired after 5 minutes"
// MEASURED 2026-09-25 against Graph v25.0 (read-only GET on the live phone node):
//   no proof → 200 · hmac(token) → 200 · hmac(token|time)+appsecret_time → 200
//   wrong proof → 400 code 100 · hmac(token) WITH appsecret_time → 400 code 100.
// So Meta does check it, both forms are accepted, and once appsecret_time is
// sent the time MUST be inside the hash. Meta's example sends the pair as form
// fields; as QUERY parameters they are read on POST too (MEASURED: a wrong proof
// in the query of POST /{waba}/subscribed_apps → 400 code 100, nothing changed). The time-stamped form is used here
// (the Login security checklist's), computed fresh for every request.
//
// Pure apart from node:crypto — no server-only marker, so the worker bundle can
// import it as safely as the Next runtime. The secret and the token are
// arguments; nothing here logs.

export function appSecretProof(
  accessToken: string,
  appSecret: string,
  nowSeconds: number = Date.now() / 1000,
): { appsecret_proof: string; appsecret_time: string } {
  // Meta: "Be sure to convert to an integer value before calculating".
  const time = String(Math.floor(nowSeconds));
  return {
    appsecret_proof: createHmac('sha256', appSecret).update(`${accessToken}|${time}`).digest('hex'),
    appsecret_time: time,
  };
}

/** The URL with a fresh proof set (replacing any already on it, e.g. a followed paging.next). */
export function withAppSecretProof(
  url: string,
  accessToken: string,
  appSecret: string,
  nowSeconds?: number,
): string {
  const u = new URL(url);
  const proof = appSecretProof(accessToken, appSecret, nowSeconds);
  u.searchParams.set('appsecret_proof', proof.appsecret_proof);
  u.searchParams.set('appsecret_time', proof.appsecret_time);
  return u.toString();
}
