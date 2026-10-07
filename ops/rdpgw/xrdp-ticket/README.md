# Desktop ticket login (xrdp)

Lets a staff member who opened the downloaded `.rdp` file land in the shared desktop as the configured account
(`RDPGW_USER`) **without typing any password**: the file itself carries a 5-minute ticket for the desktop login, next to
the 5-minute token it already carries for the gateway. Owner access over Tailscale and the existing password login are
untouched.

**Nothing in this directory is applied by itself.** `install.sh` is a dry run unless given `--apply`, and never restarts
anything.

## How it works

```
staff opens the file ─► RD Gateway (patched rdpgw): token check + grant check (tunnel-check route)   [unchanged]
                    └► xrdp gets  username = "<account>\x1f<ticket>", password empty
                          enable_token_login=true splits it: user = <account>, "password" = <ticket>
                          xrdp-sesman ─► PAM (xrdp-sesman)
                             auth sufficient pam_exec.so ... kalfa-xrdp-ticket      ◄── this directory
                                helper: ticket-shaped? ──no──► exit 1, nothing sent, PAM goes on to the ordinary password check
                                        yes ─► POST 127.0.0.1:3002/api/internal/rdp-gateway/xrdp-ticket   (loopback, own Bearer secret)
                                               app: grant active NOW? ticket minted for THIS grant, THIS requester, THIS account?
                                                    requester still has rdp.request? not used before? not expired?
                                               {"allow":true} ─► exit 0 ─► logged in      anything else ─► exit 1 ─► password check
```

The ticket (`src/lib/rdp-access/xrdp-ticket.ts`) is a keyed MAC over *grant id, requester id, account, expiry, nonce*:
nothing is stored and nothing in it is readable. The app mints it when the file is issued
(`issueMyRdpFile`) and **adds it only after the file passed validation**; the account comes from the server's
configuration (`RDPGW_USER`), never from the browser or the file.

## What this guarantees, and where it is enforced

| Requirement | How | Where |
| --- | --- | --- |
| Bound to requester, grant and account | all three are inside the MAC; the check recomputes it from the grant that is active *now* | `xrdp-ticket.ts`, `xrdp-login.ts` |
| Editing `username` in the file cannot reach another account | the check refuses any user other than the configured account before the database is touched; PAM only ever sees the account the file names | `xrdp-login.ts`, route (zod) |
| Revoke / end / expiry stop a file that is already downloaded | no active grant, or another grant, makes every earlier ticket fail the MAC; the ticket also expires after 5 minutes | `xrdp-login.ts` |
| Requester lost the staff permission | `has_platform_permission_for_user('rdp.request')` is checked on every login | `xrdp-login.ts` |
| One use | in-memory, per app process (see limits) | `createOnceGuard` |
| Existing disconnect mechanism | unchanged: ending a grant still closes the gateway tunnels | `service.ts`, CLI |
| No fixed Linux password in the file | the file carries only the account name and the ticket | `rdp-file.ts` |
| Authentication never disabled | `sufficient` + exit≠0 falls through to the normal password check; any failure of the ticket path is a refusal | PAM line, helper |
| No secrets in logs | the route logs a reason code and a grant id; the helper prints nothing; the ticket is never in argv, env or a log line | tests in all three |
| A real password never leaves the machine | the helper exits before any network call unless the "password" is exactly `k1.` + 38 URL-safe characters | `test.sh` |

## Files

| File | Purpose |
| --- | --- |
| `kalfa-xrdp-ticket` | the PAM helper → `/usr/local/sbin/kalfa-xrdp-ticket` (root, 0755) |
| `install.sh` | dry run by default; `--apply`, `--rollback`, `--purge` |
| `test.sh` | helper against a fake `curl` (142 checks, mutation-checked) |
| `test-install.sh` | installer against copies of the real PAM file and `xrdp.ini` (47 checks) |
| `test-pam.py` | helper through the real `libpam` and `pam_exec.so` with a temporary PAM directory; `/etc` is not read or written |

App side (committed code): `src/lib/rdp-access/{xrdp-ticket,xrdp-login,internal-route}.ts`,
`src/app/api/internal/rdp-gateway/xrdp-ticket/route.ts`, `getXrdpTicketConfig` in `config.ts`, `addXrdpLogon` in
`rdp-file.ts`, the wiring in `issueMyRdpFile`.

## Switching it on (owner, in this order)

Run each as `! <command>` in the session, or in a root shell.

1. See what would change (changes nothing):
   `sudo bash ops/rdpgw/xrdp-ticket/install.sh`
2. Apply it (installs the helper, generates the two secrets, edits PAM and `xrdp.ini`; restarts nothing):
   `sudo bash ops/rdpgw/xrdp-ticket/install.sh --apply`
3. Deploy / restart the app the usual way, so it reads `RDPGW_XRDP_TICKET_SECRET` and `RDPGW_XRDP_CHECK_SECRET`.
   Until then the app issues files without a ticket and the route answers 503.
4. Restart **xrdp only** (not sesman): `sudo systemctl restart xrdp`. This drops live RDP connections to the desktop;
   do it when nobody needs it for a minute. PAM needs no restart.
5. Verify: `npm run rdp:access -- status` shows `כניסה לשולחן עם כרטיס: מוגדרת`; then a real request → approve →
   download → open (below).

## Turning it off

| Speed | Action | Effect |
| --- | --- | --- |
| Fastest, no root | remove the two `RDPGW_XRDP_*` lines from `.env.local`, restart the app | the route answers 503: every ticket is refused; files are issued without a ticket again; the password login is unchanged |
| Full | `sudo bash ops/rdpgw/xrdp-ticket/install.sh --rollback --apply` | removes the PAM line and comments out `enable_token_login` (byte-for-byte as before; tested) |
| Everything | add `--purge` | also deletes the helper, the header file and the app secrets |

## What is verified and what is not

**Verified here** (the vitest suites and the three scripts above): ticket mint/verify (tamper at every position,
expiry, wrong grant/user/account/secret), the decision, the route (auth, proxy 404, size, shape, flood, timeouts,
fail-closed, no echo, no logging of secrets), file composition, the helper (142 cases, mutation-checked), the installer
and rollback on copies of the real files, and the helper through the **real** `libpam` and `pam_exec.so`
(stdin framing, `PAM_USER`, `sufficient` semantics, fall-through on refusal).

**Not verifiable without applying / without your client:**

- That your RDP client keeps the `0x1F` byte in `username:s:`, sends it without asking for a password, and that the
  whole connection cookie stays under the ~255-byte limit (the user part is at most 74 bytes: a 32-character account, the separator and the 41-character ticket). *This is the
  biggest unknown.* If the client strips it, the login screen appears exactly as today and nothing is lost.
- That restarting only `xrdp` leaves the shared session on `:10` alive (sesman owns it; expected, not measured).
- That the real `xrdp-sesman` stack (`pam_env` before, `common-auth` with `pam_imunify`/`pam_unix`/`pam_plesk` after)
  behaves like the test stack. The inserted line sits *before* `common-auth`; on success the stack ends there, so
  `pam_imunify check_only` is skipped for ticket logins only.
- `pamtester` is not installed; the real-PAM test uses `pam_start_confdir` instead.

## Known limits (deliberate, none silent)

- **Single use is per app process.** A restart of the app forgets used tickets; the ticket still dies after 5 minutes
  and with its grant. Durable one-use and an audit row per desktop login need a migration (the audit function accepts
  only `file_failed` and `tunnel_closed`); not done here. Until then a desktop login is traceable through the gateway's
  tunnel row and xrdp-sesman's own log.
- **No automatic reconnect.** A ticket works once. If the connection drops, download a new file (the existing
  per-grant file cap and minimum gap apply).
- **Every desktop login's password passes through the helper's memory** (so the helper can look at its shape). It is
  never written, logged, put on a command line or sent anywhere unless it is ticket-shaped.
- The ticket proves the requester held the grant at download time and still does; it cannot be bound to the client's
  address (xrdp sees the gateway, not the client). The gateway token in the same file *is* bound to the address.
