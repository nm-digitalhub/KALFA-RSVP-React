# Linux Persistence — where to look (read-only)

Malware survives reboots and kills by planting itself in one or more of these. Enumerate **all** of them — attackers plant several so removing one leaves a foothold. Every command here only reads; removal happens in Phase 3 after approval.

## Table of contents
- Scheduled tasks (cron / at)
- systemd units
- SysV init & rc*.d
- Shell & login profiles
- SSH (authorized_keys, sshd config)
- Dynamic linker preload
- Kernel modules

---

## Scheduled tasks (cron / at)
```bash
ls -la /etc/cron.d/ /etc/cron.hourly/ /etc/cron.daily/ /etc/cron.weekly/ /etc/cron.monthly/
cat /etc/crontab
for u in $(cut -d: -f1 /etc/passwd); do crontab -l -u "$u" 2>/dev/null | sed "s/^/[$u] /"; done
grep -R '@reboot' /var/spool/cron /etc/cron* 2>/dev/null
atq 2>/dev/null
```
Red flags: base64/`eval`/`curl … | sh` in a cron line, a `@reboot` that re-launches a random-name binary, jobs owned by the web user.

## systemd units
```bash
systemctl list-unit-files --state=enabled
systemctl list-units --type=service --state=running
# a fake unit often points ExecStart at something in /tmp, /dev/shm, /var/tmp, or a random path
grep -RniE 'ExecStart=.*(/tmp|/dev/shm|/var/tmp|/\.[a-z])' /etc/systemd /lib/systemd /run/systemd 2>/dev/null
systemctl cat <suspect.service> --no-pager 2>/dev/null
```
Red flags: a unit whose name mimics a real one (`getty@`, `systemd-…`) but whose `ExecStart` is a stray binary; units in `/run/systemd` (tmpfs) that reappear on boot.

## SysV init & rc*.d
```bash
ls -la /etc/init.d/
ls -la /etc/rc[0-6].d/ 2>/dev/null    # symlinks S*/K* into init.d
```
Classic BillGates/Elknot pattern: an `/etc/init.d/DbSecuritySpt` (or `selinux`) script plus `S*` symlinks in `rc1.d`–`rc5.d`. Prove the target is malicious (read the script) before flagging.

## Shell & login profiles
```bash
for f in /etc/profile /etc/bash.bashrc /root/.bashrc /root/.profile \
         /home/*/.bashrc /home/*/.profile /var/www/vhosts/*/.bashrc; do
  [ -f "$f" ] && grep -HniE 'curl|wget|base64|eval|/tmp|/dev/shm' "$f"
done
```

## SSH
```bash
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys /var/www/vhosts/*/.ssh/authorized_keys; do
  [ -f "$f" ] && echo "== $f ==" && cat "$f"
done
grep -HniE 'PermitRootLogin|AuthorizedKeysFile|ForceCommand' /etc/ssh/sshd_config
```
Red flags: an authorized_key you don't recognize (attacker backdoor), a `ForceCommand`, or `AuthorizedKeysFile` pointing somewhere writable. On a root-compromised host assume **all** keys are leaked → they go on the user's rotation list regardless.

## Dynamic linker preload
```bash
cat /etc/ld.so.preload 2>/dev/null        # should normally NOT exist
ls -la /etc/ld.so.preload 2>/dev/null
```
A populated `ld.so.preload` is a strong userland-rootkit signal (it hooks every process). Read what it points to before acting.

## Kernel modules
```bash
lsmod | sort
# modules loaded from a non-standard path are suspicious
for m in $(lsmod | awk 'NR>1{print $1}'); do modinfo -n "$m" 2>/dev/null; done | grep -vE '^/lib/modules' 
```

---

## Removal ordering (Phase 3, post-approval only)
1. Kill the running process first (else it may re-plant persistence you just removed).
2. Remove init script + its `rc*.d` symlinks together.
3. Disable/mask the fake systemd unit, then remove its file; re-run `systemctl daemon-reload`.
4. Remove malicious cron lines / authorized_keys.
5. Empty or delete a malicious `ld.so.preload`.
6. Re-verify each with the read-only command above — it should now come back clean.
