---
name: security-triage
description: Evidence-based incident response and forensic triage for a Linux production server (IONOS VPS + Plesk, Next.js/pm2/nginx). Use whenever a security incident is suspected or in progress — malware, rootkit, suspicious process, unrecognized listener, unexpected cron/systemd persistence, crypto-miner, DDoS bot, defaced webroot, leaked credentials — and also when the trigger looks mundane, like a full disk, a runaway process, or "the server feels slow/weird". Enforces a strict read-only-first, prove-before-you-touch workflow with human-approval gates before any destructive action. Use this even if the user does not say the word "security".
---

# Security Triage

Incident response on a **live production host**. Every command here runs against production immediately. The whole point of this skill is to keep you from making an incident worse: you investigate and prove first, and you never destroy state without human approval and preserved evidence.

## The five doctrines (non-negotiable)

These are ordered. If a later doctrine ever conflicts with an earlier one, the earlier one wins.

1. **Evidence-based, never name-based.** A filename, a path, or a "looks malicious" hunch is a *lead*, never a *conclusion*. Every claim of the form "X is malware / X is compromised / X is the attacker" must be backed by direct evidence: file content (`strings`, `head`, `cat`), `file` type, `dpkg -V` integrity, a `/proc` fact, a listening socket, or a hash. *Why:* acting on a guess on a production box gets legitimate services killed and lets real threats survive.

2. **Read-only first.** All detection and all proof happen with read-only commands. Nothing that changes state — no `kill`, `rm`, `mv`, `chmod`, `systemctl stop/disable`, no config edits — runs during the investigation phase. *Why:* you cannot un-ring a bell; a wrong `kill` or `rm` destroys both a running service and the evidence you needed.

3. **Human-approval gate before every destructive step.** Before *any* containment or eradication action, STOP. Present the evidence, state exactly what you propose to do and what the blast radius is, and wait for an explicit "yes". *Why:* the human owns the risk on their production host; irreversible actions are their call, not yours.

4. **Preserve chain-of-custody.** Before killing a process or deleting a file, archive the evidence (copy the binary, dump `/proc/<pid>`, record the listening sockets) into a timestamped evidence directory and record a SHA-256 hash. *Why:* once it's gone you can't analyze it, attribute it, or prove what happened.

5. **No external tools, no remote code.** Do not `curl … | sh`, do not download scanners or "cleaners", do not pipe anything from the network into a shell. Use what the base OS provides (coreutils, `procps`, `dpkg`, `ss`, `lsof`). *Why:* an "incident response tool" fetched during an incident is an ideal place to hide a second-stage payload — and the box is already suspect.

## The four phases

Run these in order. Do not skip ahead to containment because something "obviously" looks bad — obvious is exactly when doctrine #1 catches you.

### Phase 0 — Frame (read-only)
Establish what "normal" looks like before hunting anomalies. Confirm the host, the app root (`/var/www/vhosts/kalfa.me/beta`), the process manager (pm2), the web server (nginx), and what *should* be listening. Note the disk state. **Read `references/triage-playbook.md` now** — it is the step-by-step workflow for phases 0–3 and you should follow it rather than improvising the order.

### Phase 1 — Detect & prove (read-only)
Hunt for the anomaly and *prove* it, per doctrine #1. Typical leads: a process eating CPU, an unrecognized listening port, a file with a random name, a modified system binary. For each lead, gather direct evidence before you call it malicious.
- For **persistence** hunting (cron, systemd, init.d, `rc*.d`, `ld.so.preload`, `authorized_keys`), read `references/linux-persistence.md`.
- Remember system binaries themselves can be trojaned — `ps`, `netstat`, `ss`, `lsof` output can lie. Cross-check with `dpkg -V` and read directly from `/proc`. This is in the playbook.

### Phase 2 — Preserve, then propose (approval gate)
Once a threat is *proven*, do not remove it yet.
1. Collect evidence per `references/evidence-collection.md` (volatile-first ordering, hashes, timestamped dir).
2. Present a short **containment proposal** to the human: what was proven (with the evidence), what you propose to do, and the blast radius.
3. **Wait for explicit approval.** Only then proceed to Phase 3.

### Phase 3 — Contain & eradicate (only after approval)
Execute the approved actions, narrowest first: kill the confirmed process (verify no respawn), remove the confirmed persistence, restore trojaned binaries from `apt`. Re-verify after each step. Then run a residual sweep (twins by size/signature, stray static binaries, foreign listeners) and confirm clean.

## Disk-full path
A full disk is a common trigger and is often *not* a security incident — but treat it with the same evidence discipline, because "junk" and "live service" can look alike. **Read `references/disk-cleanup.md`** for how to separate certifiably-safe junk from live state (`.next` vs `.next-verify`, npm cache, abandoned clones) before proposing any deletion. Deletion is still a destructive action → doctrine #3 applies.

## Reporting
After an incident, produce an incident report with this exact structure:

```
# דוח אירוע אבטחה — [תאריך]
## תקציר מנהלים
## ציר זמן (timeline)
## ממצאים מאומתים (כל ממצא + הראיה שגיבתה אותו)
## פעולות שבוצעו
## פעולות שנותרו למשתמש (rotation / hardening)
## נספח ראיות (נתיב תיקיית הראיות + hashes)
```
User-facing text in Hebrew (RTL); commands, paths, and technical identifiers in English.

## Known gotchas (learn from what has failed here)
- **Managed AV can miss active rootkits.** Imunify360 did not flag a live BillGates/Elknot rootkit on this host. A clean managed-scanner result is *not* proof of a clean host — verify independently with `dpkg -V` and `/proc`.
- **A compromised root means everything is leaked.** If the attacker had root, treat every secret as disclosed: passwords, all SSH keys, every `.env`, Plesk password, DB creds, Google service-account keys. Rotation is not optional and it is the *user's* action — put it in the report, don't attempt it silently.
- **Eradication is not remediation.** Killing the bot and clearing persistence does not close the entry vector. Until the initial vector (often app-level RCE/upload; owner = the web user) is found and fixed, reinfection is likely. Say so explicitly. For a host that was root-compromised, note that a clean rebuild is the gold standard.
- **`777` and creds in the webroot are the smoking gun's neighborhood.** When you find world-writable paths or `key.json` / `client_secret_*.json` / `.env.bak` under the vhost, flag them — they're both a likely cause and a leaked asset.
