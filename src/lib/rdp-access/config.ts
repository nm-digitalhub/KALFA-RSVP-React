import 'server-only';

import { isTicketAccount, isValidRdpTarget, OS_ACCOUNT_PATTERN } from './policy';

// Configuration for the remote-desktop gateway (rdpgw) integration, read from the process environment
// like KALFA_CONSOLE_SECRET: set in .env.local, FAIL CLOSED when anything is missing or malformed, and
// never return or log a secret value (the result carries variable NAMES only).
//
// Three secrets, one per direction, so a leak of one does not authorise the other two:
//   RDPGW_CHECK_SECRET    gateway   -> this app   (the per-tunnel grant check; the gateway sends it as a Bearer token)
//   RDPGW_CONNECT_SECRET  this app  -> gateway    (/connect: proves the caller is this app, not any local process)
//   RDPGW_ADMIN_SECRET    this app  -> gateway    (list / disconnect tunnels on the loopback admin listener)
// They map one-to-one to the gateway's own settings (GRANTCHECKTOKEN, HEADER__SECRET, ADMINTOKEN).

export const RDPGW_ENV = {
  loopbackUrl: 'RDPGW_LOOPBACK_URL',
  adminUrl: 'RDPGW_ADMIN_URL',
  target: 'RDPGW_TARGET',
  user: 'RDPGW_USER',
  checkSecret: 'RDPGW_CHECK_SECRET',
  connectSecret: 'RDPGW_CONNECT_SECRET',
  adminSecret: 'RDPGW_ADMIN_SECRET',
} as const;

const MIN_SECRET_LENGTH = 32;

// The OS account the gateway signs people in as. The gateway identity IS this account name (the
// token-login chain requires the token subject to be an existing OS user), so it is configuration, not
// a literal in code.

// Literal loopback addresses only. The gateway itself refuses "localhost" (IPv6 resolution would
// land on a port nobody listens on), and a hostname could be re-pointed by DNS or /etc/hosts.
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]']);

export type RdpGatewayConfig = {
  /** Origin of the gateway's /connect listener, e.g. http://127.0.0.1:3013 */
  gatewayOrigin: string;
  /** Origin of the gateway's admin listener, e.g. http://127.0.0.1:3014 */
  adminOrigin: string;
  /** host:port of the remote desktop as the gateway reaches it. Pinned to each grant at approval. */
  target: string;
  /** OS account name used as the gateway identity (what the gateway sends as `user`). */
  gatewayUser: string;
  checkSecret: string;
  connectSecret: string;
  adminSecret: string;
};

export type RdpGatewayConfigProblem = {
  variable: (typeof RDPGW_ENV)[keyof typeof RDPGW_ENV];
  reason: 'missing' | 'invalid';
};

export type RdpGatewayConfigResult =
  | { ok: true; config: RdpGatewayConfig }
  | { ok: false; problems: RdpGatewayConfigProblem[] };

type Env = Readonly<Record<string, string | undefined>>;

function loopbackOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const bare = url.pathname === '/' || url.pathname === '';
  if (
    url.protocol !== 'http:' ||
    !LOOPBACK_HOSTNAMES.has(url.hostname) ||
    url.port === '' ||
    url.username !== '' ||
    url.password !== '' ||
    !bare ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return null;
  }
  return url.origin;
}

export function getRdpGatewayConfig(env: Env = process.env): RdpGatewayConfigResult {
  const problems: RdpGatewayConfigProblem[] = [];
  const read = (variable: RdpGatewayConfigProblem['variable']): string | null => {
    const value = env[variable]?.trim();
    if (!value) {
      problems.push({ variable, reason: 'missing' });
      return null;
    }
    return value;
  };
  const invalid = (variable: RdpGatewayConfigProblem['variable']) => {
    // one problem per variable, however many rules it breaks
    if (!problems.some((p) => p.variable === variable)) problems.push({ variable, reason: 'invalid' });
    return null;
  };

  const gatewayRaw = read(RDPGW_ENV.loopbackUrl);
  const adminRaw = read(RDPGW_ENV.adminUrl);
  const targetRaw = read(RDPGW_ENV.target);
  const userRaw = read(RDPGW_ENV.user);
  const checkRaw = read(RDPGW_ENV.checkSecret);
  const connectRaw = read(RDPGW_ENV.connectSecret);
  const adminSecretRaw = read(RDPGW_ENV.adminSecret);

  const gatewayOrigin = gatewayRaw === null ? null : (loopbackOrigin(gatewayRaw) ?? invalid(RDPGW_ENV.loopbackUrl));
  const adminOrigin = adminRaw === null ? null : (loopbackOrigin(adminRaw) ?? invalid(RDPGW_ENV.adminUrl));
  const target =
    targetRaw === null ? null : isValidRdpTarget(targetRaw) ? targetRaw : invalid(RDPGW_ENV.target);
  const gatewayUser =
    userRaw === null ? null : OS_ACCOUNT_PATTERN.test(userRaw) ? userRaw : invalid(RDPGW_ENV.user);

  const secrets: [RdpGatewayConfigProblem['variable'], string | null][] = [
    [RDPGW_ENV.checkSecret, checkRaw],
    [RDPGW_ENV.connectSecret, connectRaw],
    [RDPGW_ENV.adminSecret, adminSecretRaw],
  ];
  for (const [variable, value] of secrets) {
    if (value !== null && value.length < MIN_SECRET_LENGTH) invalid(variable);
  }
  // one secret per direction: reusing a value across directions defeats the separation
  const seen = new Map<string, RdpGatewayConfigProblem['variable']>();
  for (const [variable, value] of secrets) {
    if (value === null) continue;
    if (seen.has(value)) invalid(variable);
    else seen.set(value, variable);
  }

  if (
    problems.length > 0 ||
    gatewayOrigin === null ||
    adminOrigin === null ||
    target === null ||
    gatewayUser === null ||
    checkRaw === null ||
    connectRaw === null ||
    adminSecretRaw === null
  ) {
    return { ok: false, problems };
  }

  return {
    ok: true,
    config: {
      gatewayOrigin,
      adminOrigin,
      target,
      gatewayUser,
      checkSecret: checkRaw,
      connectSecret: connectRaw,
      adminSecret: adminSecretRaw,
    },
  };
}

// ── ticket login to the shared desktop (xrdp) ────────────────────────────────────────────────────

// Two more secrets, again one per direction, both optional as a PAIR (the feature is off until both are set):
//   RDPGW_XRDP_TICKET_SECRET  this app only: keys the MAC inside each ticket (xrdp-ticket.ts)
//   RDPGW_XRDP_CHECK_SECRET   the PAM helper on the server -> this app: the Bearer secret of /xrdp-ticket
// They never overlap with each other or with the three gateway secrets above.
export const XRDP_TICKET_ENV = {
  ticketSecret: 'RDPGW_XRDP_TICKET_SECRET',
  checkSecret: 'RDPGW_XRDP_CHECK_SECRET',
} as const;

export type XrdpTicketConfig = {
  ticketSecret: string;
  checkSecret: string;
  /** The Linux account every ticket logs into. Decided by this server's configuration, never by the file or the browser. */
  account: string;
};

export type XrdpTicketConfigResult =
  | { ok: true; config: XrdpTicketConfig }
  /** Neither secret is set: ticket login is simply not enabled, and the file stays as it is today. */
  | { ok: false; reason: 'off' }
  /** Something is half-set or wrong. Variable NAMES only, never values. */
  | { ok: false; reason: 'invalid'; variables: string[] };

export function getXrdpTicketConfig(env: Env = process.env): XrdpTicketConfigResult {
  const ticketRaw = env[XRDP_TICKET_ENV.ticketSecret]?.trim() || null;
  const checkRaw = env[XRDP_TICKET_ENV.checkSecret]?.trim() || null;
  if (ticketRaw === null && checkRaw === null) return { ok: false, reason: 'off' };

  const variables: string[] = [];
  if (ticketRaw === null || ticketRaw.length < MIN_SECRET_LENGTH) variables.push(XRDP_TICKET_ENV.ticketSecret);
  if (checkRaw === null || checkRaw.length < MIN_SECRET_LENGTH) variables.push(XRDP_TICKET_ENV.checkSecret);

  // one secret per direction: reusing a value across directions defeats the separation
  const others = [RDPGW_ENV.checkSecret, RDPGW_ENV.connectSecret, RDPGW_ENV.adminSecret]
    .map((name) => env[name]?.trim())
    .filter((value): value is string => Boolean(value));
  const name = (variable: string) => {
    if (!variables.includes(variable)) variables.push(variable);
  };
  if (ticketRaw !== null && others.includes(ticketRaw)) name(XRDP_TICKET_ENV.ticketSecret);
  if (checkRaw !== null && others.includes(checkRaw)) name(XRDP_TICKET_ENV.checkSecret);
  // the two ticket secrets must differ from each other, and neither of them is the "right" one to blame
  if (ticketRaw !== null && ticketRaw === checkRaw) {
    name(XRDP_TICKET_ENV.ticketSecret);
    name(XRDP_TICKET_ENV.checkSecret);
  }

  const account = env[RDPGW_ENV.user]?.trim() || null;
  if (account === null || !isTicketAccount(account)) variables.push(RDPGW_ENV.user);

  if (variables.length > 0 || ticketRaw === null || checkRaw === null || account === null) {
    return { ok: false, reason: 'invalid', variables };
  }
  return { ok: true, config: { ticketSecret: ticketRaw, checkSecret: checkRaw, account } };
}
