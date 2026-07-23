# Triage Playbook — phases 0→3

Step-by-step workflow. Every command in phases 0–2 is **read-only**. Do not run anything that changes state until the human approves (SKILL.md doctrine #3).

## Table of contents
- Phase 0 — Frame the host
- Phase 1 — Detect & prove
- Phase 1a — Trust nothing: verifying system binaries
- Phase 2 — Preserve & propose (gate)
- Phase 3 — Contain & eradicate (post-approval)
- Residual sweep

---

## Phase 0 — Frame the host (read-only)

Goal: know what normal is before hunting anomalies.

```bash
# identity & uptime
hostnamectl; uptime; who -a
# app + services that SHOULD be running
pm2 list 2>/dev/null || sudo -u <appuser> pm2 list
systemctl status nginx --no-pager
ls -la /var/www/vhosts/kalfa.me/beta
# disk (common trigger)
df -h; du -h -d1 /var/www/vhosts/kalfa.me/beta 2>/dev/null | sort -h | tail
```

Write down the *expected* listeners (nginx :80/:443, Next.js on 127.0.0.1:<port>, named, Plesk, docker-proxy, imunify360). Anything outside this set is a Phase 1 lead — not yet a conclusion.

## Phase 1 — Detect & prove (read-only)

Hunt leads, then prove each one. **A lead is not a finding until it has direct evidence** (doctrine #1).

```bash
# CPU/mem hogs (miners, bots)
ps auxww --sort=-%cpu | head -20
# every listening socket + owning process
ss -tulpnH | sort
# recently modified files under the app (last 3 days) — tune the window
find /var/www/vhosts/kalfa.me/beta -type f -mtime -3 -not -path '*/node_modules/*' -printf '%TY-%Tm-%Td %TH:%TM  %p\n' 2>/dev/null | sort | tail -50
# suspicious binaries: random-name files, world-writable, setuid
find / -xdev -maxdepth 6 -type f -perm -002 2>/dev/null | head
```

For each lead, prove it before naming it:

```bash
file /path/to/suspect            # ELF? 32-bit static? script?
head -c 400 /path/to/suspect | strings | head -40   # command strings, C2 domains, "gates", "ddos", "xmr"
ls -la /path/to/suspect; stat /path/to/suspect
# for a live pid:
ls -la /proc/<pid>/exe          # real path of the running binary (survives a renamed process)
cat /proc/<pid>/cmdline | tr '\0' ' '; echo
cat /proc/<pid>/status | grep -Ei 'ppid|uid|state'
```

Only after this evidence is gathered do you write "confirmed: <path> is <family> (evidence: …)".

## Phase 1a — Trust nothing: verify system binaries

Rootkits replace `ps`, `netstat`, `ss`, `lsof` so their process/socket is hidden. Cross-check:

```bash
# have core tools been tampered with? (empty output = clean for that package)
dpkg -V procps net-tools coreutils lsof
# does /proc show a pid that ps hides? compare counts
ls -d /proc/[0-9]* | wc -l
# read listeners straight from the kernel view
ss -tulpn        # then corroborate a suspicious pid via /proc/<pid>/exe
```

If `dpkg -V` shows a modified binary, treat that binary's output as untrustworthy for the rest of the investigation and rely on `/proc` + `dpkg`.

## Phase 2 — Preserve & propose (APPROVAL GATE)

Do **not** kill or delete yet.

1. Collect evidence → follow `evidence-collection.md` (volatile-first, hashes, timestamped dir).
2. Present a short proposal to the human:
   - **Proven:** one line per finding + the evidence that backs it.
   - **Propose to do:** exact commands (kill pid X, remove persistence Y, restore binary Z).
   - **Blast radius:** what could break; whether any live service shares a name/port.
3. **STOP and wait for an explicit "yes".** No approval → no Phase 3.

## Phase 3 — Contain & eradicate (only after approval)

Narrowest action first; re-verify after each.

```bash
# 1) kill the confirmed bot, confirm no respawn
kill -9 <pid>; sleep 2; ps -p <pid>        # should be empty
ls -d /proc/[0-9]* | wc -l                  # watchdog may respawn — recheck
# 2) remove confirmed persistence (see linux-persistence.md for the full map)
#    e.g. rm the confirmed init script + its rc*.d symlinks, disable the fake unit
# 3) restore trojaned binaries from apt (only those dpkg -V flagged)
apt-get install --reinstall -y procps net-tools coreutils lsof
dpkg -V procps net-tools coreutils lsof     # should now be clean
```

## Residual sweep (still read-only, run after eradication)

Confirm nothing survived:

```bash
# twins of the malware by exact byte size (replace N)
find / -xdev -type f -size Nc 2>/dev/null
# stray 32-bit static ELF in system dirs (a common malware signature)
for f in $(find /usr /bin /sbin /lib -type f 2>/dev/null); do file "$f" 2>/dev/null | grep -q 'statically linked' && echo "$f"; done | head
# leftover persistence
ls -la /etc/cron.d /etc/cron.*/ 2>/dev/null; grep -R '@reboot' /var/spool/cron 2>/dev/null
systemctl list-unit-files --state=enabled | grep -vE 'ssh|nginx|cron|systemd|dbus|network'
cat /etc/ld.so.preload 2>/dev/null   # should not exist / be empty
# foreign listeners re-check
ss -tulpnH | sort
```

A clean sweep = 0 twins, 0 stray static binaries, 0 leftover persistence, only expected listeners. Record the sweep result in the report.
