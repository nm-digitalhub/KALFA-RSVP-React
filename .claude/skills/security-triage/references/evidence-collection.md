# Evidence Collection — preserve before you destroy

This runs at the start of Phase 2, **before** any kill/remove. It is the mechanism behind doctrine #4 (chain-of-custody). Collect in **volatile-first** order: the most ephemeral state (running process memory, open sockets) disappears the instant you act, so capture it before disk artifacts.

## 1. Create a timestamped evidence directory
```bash
TS=$(date +%Y%m%d-%H%M%S)
EVID="/root/ir-evidence-$TS"
mkdir -p "$EVID" && chmod 700 "$EVID"
echo "$EVID"
```
Keep it on the same host but outside the app tree. Record the path — it goes in the report's evidence appendix.

## 2. Volatile state first (per confirmed pid)
```bash
PID=<pid>
{
  echo "== cmdline =="; tr '\0' ' ' < /proc/$PID/cmdline; echo
  echo "== exe ==";     ls -l /proc/$PID/exe
  echo "== cwd ==";     ls -l /proc/$PID/cwd
  echo "== status ==";  cat /proc/$PID/status
  echo "== maps ==";    cat /proc/$PID/maps
  echo "== open fds =="; ls -l /proc/$PID/fd
} > "$EVID/proc-$PID.txt" 2>&1

# copy the actual running binary (follow the /proc/exe link — survives on-disk deletion)
cp -a "$(readlink -f /proc/$PID/exe)" "$EVID/binary-$PID.bin" 2>/dev/null

# system-wide volatile snapshot
ss -tulpnH            > "$EVID/sockets.txt" 2>&1
ps auxww              > "$EVID/processes.txt" 2>&1
```

## 3. On-disk artifacts
```bash
# the suspect file itself + its metadata
cp -a /path/to/suspect      "$EVID/"
stat /path/to/suspect       > "$EVID/suspect.stat.txt"
file /path/to/suspect       > "$EVID/suspect.file.txt"
strings -n 6 /path/to/suspect > "$EVID/suspect.strings.txt"

# persistence artifacts you found (init scripts, units, cron lines, authorized_keys)
cp -a /etc/init.d/<script>  "$EVID/" 2>/dev/null
# ... copy each confirmed persistence file
```

## 4. Hash everything (integrity + attribution)
```bash
( cd "$EVID" && find . -type f -exec sha256sum {} \; ) > "$EVID/SHA256SUMS.txt"
cat "$EVID/SHA256SUMS.txt"
```
The SHA-256 values let you (a) prove the evidence wasn't altered afterward and (b) look up the sample family later without re-touching the live host.

## 5. Log context (how/when it got in)
```bash
# web/app logs around the file's mtime — candidate initial vector
SINCE=$(date -d "$(stat -c %y /path/to/suspect)" '+%Y-%m-%d %H:%M' 2>/dev/null)
echo "suspect mtime window: $SINCE"
# nginx / app access+error logs, auth log
cp -a /var/www/vhosts/kalfa.me/logs/*access*  "$EVID/" 2>/dev/null
cp -a /var/log/auth.log*                       "$EVID/" 2>/dev/null
```
Do **not** conclude the vector from a single log line — note it as a candidate for the hardening section. The file's owner is a strong hint: if the malware is owned by the web user, the vector is almost certainly app-level (upload/RCE), not SSH.

## 6. Record the manifest
Write a one-paragraph `README.txt` in `$EVID`: what the incident is, when collected, which pids/files, and that hashes are in `SHA256SUMS.txt`. This is what makes the archive self-explanatory months later.

---
Only after this directory exists and is hashed do you present the containment proposal and wait for approval.
