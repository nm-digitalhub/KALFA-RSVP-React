/**
 * The popup bridge's wire contract, in a module a BROWSER BUNDLE MAY IMPORT.
 *
 * ⚠️ IT LIVES APART FROM `oauth-popup-bridge.ts` FOR EXACTLY ONE REASON: that
 * module is `server-only`, and the node control that listens for these messages
 * is a client component. Importing the constants from there would pull the
 * `server-only` marker into the browser bundle and fail the build — so the two
 * ends of one protocol would end up with two hand-copied sets of strings that
 * drift silently the first time either is renamed.
 *
 * Nothing here is a secret. These are a channel name and two query values.
 */
export const OAUTH_POPUP_CHANNEL = 'kalfa-oauth-callback';
export const OAUTH_POPUP_TAG = 'kalfa-oauth';
export const OAUTH_POPUP_PARAM = 'oauthMode';
export const OAUTH_POPUP_VALUE = 'popup';
