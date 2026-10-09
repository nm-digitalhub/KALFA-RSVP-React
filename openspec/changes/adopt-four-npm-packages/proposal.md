# Adopt four maintained npm packages

Replace both CSV parsers with csv-parse, fixed-window counters with
rate-limiter-flexible, numeric-host classification with ipaddr.js and the six
HTML email builders with React Email component rendering.

All production consumers await the async limiter and email builders. Preserve
thread subjects, authored text/plain alternatives, narrow escape-first Markdown,
UTF-8/Windows-1255 decoding, spreadsheet detection and existing field validation.
Malformed CSV now produces a fixed upload error. Deny IPv4-mapped and non-unicast
IPv6 addresses; public DNS names starting with fc/fd are no longer false positives.

No schema migration. Rate limiting remains per-process. DNS resolution and
connection pinning are outside this change. Installation pins four exact direct
versions and generates the project's lockfile locally. No deployment is included.

Baseline: nm-digitalhub/KALFA-RSVP-React at
11549d3e8aa3b9bf838096a818f739ff10d643b7.

The updated review inventories every archived repository file and parses all
JavaScript/TypeScript across application, scripts, workers, agents and tooling.
It also migrates the separate log-download and session-command IP classifiers,
preserving the latter's public-IP provider capability policy. DNS results now
reject invalid/reserved addresses, including expanded and hexadecimal mapped
IPv6. Cancellation requestCode and all upstream business changes are preserved.
Preflight validates the complete tracked-file inventory and baseline hashes,
not just the files receiving edits. No force-install or checksum bypass exists.
