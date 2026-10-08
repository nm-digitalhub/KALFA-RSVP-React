# rdpgw: RD Gateway for staff remote-desktop access

A pinned build of [bolkedebruin/rdpgw](https://github.com/bolkedebruin/rdpgw) plus two small KALFA patches. It lets
staff reach the shared xrdp desktop without Tailscale, only while the owner has approved a grant.

Design, threat model, deployment order and rollback: `docs/remote-desktop-access-approval-plan-2026-10-06.md`.
Status of each stage is in section 0 of that document. **Nothing in this directory is applied to the server by
itself.** `build.sh` only builds and verifies. `prepare-host.sh` (stage S3) is run by the owner with sudo and never
starts the service.

| File | Purpose | Installed to |
| --- | --- | --- |
| `PINNED_COMMIT` | upstream commit the build is made from | not installed |
| `patches/0001-…` | per-tunnel grant check against KALFA, loopback admin API (list/disconnect), fail-closed start-up checks | applied by `build.sh` |
| `patches/0002-…` | shared secret required on `/connect` | applied by `build.sh` |
| `patches/0003-…` | security updates of vulnerable dependencies, generated with `go get` | applied by `build.sh` |
| `BINARY_SHA256` | sha256 of the reviewed binary; `prepare-host.sh` refuses to install anything else | not installed |
| `prepare-host.sh` | stage S3: user, directories, config, secrets, unit; does not start anything | run once by the owner with sudo |
| `go.sum` | upstream git-ignores it, so the reviewed copy is kept here | copied by `build.sh` |
| `SHA256SUMS` | patches and `go.sum` exactly as reviewed; `build.sh` refuses to run if they changed | not installed |
| `build.sh` | reproducible build into `build/` (git-ignored) | not installed |
| `rdpgw.yaml` | gateway configuration, no secrets | `/etc/rdpgw/rdpgw.yaml` |
| `default.rdp` | client defaults | `/etc/rdpgw/default.rdp` |
| `rdpgw.service` | systemd unit (loopback only, hardened, egress allow-list) | `/etc/systemd/system/rdpgw.service` |
| `rdpgw-proxy.conf` | nginx front for `gw.kalfa.me` | `/etc/nginx/conf.d/rdpgw-proxy.conf` |
| `xrdp-ticket/` | passwordless desktop login for staff (PAM helper, installer, tests); **see its own README**, not applied by itself | `/usr/local/sbin/kalfa-xrdp-ticket` + PAM + `xrdp.ini`, by `xrdp-ticket/install.sh --apply` |
| `kalfa-rdp-guard*.rules` | optional raw-table guard: port 3389 only from `tailscale0` and loopback | applied with `iptables-restore --noflush` |

## Build

```bash
cd ops/rdpgw && ./build.sh
```

Needs `git`, `gcc` (for `go test -race`), `govulncheck` (`go install golang.org/x/vuln/cmd/govulncheck@latest`) and
network access to github.com, proxy.golang.org and sum.golang.org. Go itself is `go1.26.6`, fetched by Go's own
toolchain mechanism (`GOTOOLCHAIN`) and verified against the checksum database.

It clones the pinned commit, applies the three patches and then runs these gates in order, stopping at the first
failure: patch and `go.sum` checksums, `go vet`, `govulncheck` on the source, `go test -race`, the build,
`govulncheck` on the built binary, and finally the comparison with `BINARY_SHA256`. The vulnerability scan is a
required gate: the script refuses to run without `govulncheck`. The binary is built without `-s -w` so the binary
scan sees symbols; the scanned file is the one that gets installed.

`BINARY_SHA256` is the hash of the reviewed binary. It is updated only after every other gate has passed. A different
Go version, patch or `go.sum` gives a different hash, which is expected: re-verify, then record the new one.

## Secrets

Never in this directory. `/etc/rdpgw/secrets.env` (`root:rdpgw`, mode 0640) holds the gateway keys and the three
shared secrets; the application side reads the matching `RDPGW_CHECK_SECRET`, `RDPGW_CONNECT_SECRET` and
`RDPGW_ADMIN_SECRET` from its own environment (see `src/lib/rdp-access/config.ts`). Generation commands are in the
plan, part B, section 1.

## Emergency stop

`sudo systemctl stop rdpgw` cuts every tunnel within a second and nginx answers 502. It does not touch the shared
desktop session or the Tailscale path. To keep it off: `sudo systemctl disable --now rdpgw && sudo systemctl mask rdpgw`.
