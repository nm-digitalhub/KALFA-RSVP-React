#!/usr/bin/env bash
# Isolated preflight of STAGED worker / owner-agent bundles (deploy plan, step 2.4).
#
#   bash plans/db-config-f2bafdcf-verification/preflight-bundles.sh <stage-dir>
#
# <stage-dir> must contain worker.cjs and owner-agent.cjs. Each bundle is started with:
#   env -i (no .env.local, no real credentials), NODE_ENV=production, a Supabase pooler host,
#   dummy credentials, and every socket connect / fetch blocked and logged.
# Expected:
#   port 54322 / ' 54322 '  → "invalid database configuration", 0 connect attempts, no secret in output
#   port '   ' (blank → 5432) and 6543 → reach a connect attempt (blocked) = the rule lets them through
# Touches nothing outside <stage-dir>/preflight. No pm2, no dist/, no database.
set -u
S=$(cd "${1:?usage: preflight-bundles.sh <stage-dir>}" && pwd)
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
R=$S/preflight; rm -rf "$R"; mkdir -p "$R"
for b in worker.cjs owner-agent.cjs; do [ -f "$S/$b" ] || { echo "missing $S/$b"; exit 2; }; done

cat > "$R/block-net.cjs" <<'EOF'
const net = require('node:net'); const fs = require('node:fs');
const log = (m) => fs.appendFileSync(process.env.NET_LOG, m + '\n');
net.Socket.prototype.connect = function (...a) { const o = a[0]; log('connect ' + (typeof o === 'object' ? o.port : o)); this.destroy(new Error('network blocked')); return this; };
globalThis.fetch = async (u) => { log('fetch ' + String(u).replace(/\?.*/, '').slice(0, 60)); throw new Error('network blocked'); };
EOF

fail=0
run() { # name bundle port expect(refuse|connect)
  local n=$1 b=$2 p=$3 want=$4; : > "$R/$n.net"
  (cd "$R" && env -i PATH=/usr/bin:/bin HOME="$R" NODE_PATH="$ROOT/node_modules" NODE_ENV=production TZ=Asia/Jerusalem \
     MASTRA_TELEMETRY_DISABLED=true NET_LOG="$R/$n.net" SUPABASE_DB_HOST=aws-1-ap-south-1.pooler.supabase.com SUPABASE_DB_PORT="$p" \
     SUPABASE_DB_USER=postgres.dummyref SUPABASE_DB_PASSWORD=dummy-pass-xyz SUPABASE_DB_NAME=postgres \
     timeout 40 node --require "$R/block-net.cjs" "$S/$b" > "$R/$n.out" 2>&1)
  local cfg conn db leak got
  cfg=$(grep -c "invalid database configuration" "$R/$n.out")
  conn=$(sort "$R/$n.net" | uniq -c | tr '\n' ';')
  db=$(grep -cE "^connect (5432|6543|54322)$" "$R/$n.net")
  leak=$(grep -c "dummy-pass-xyz\|postgres.dummyref" "$R/$n.out")
  if [ "$cfg" -gt 0 ] && [ "$db" -eq 0 ]; then got=refuse; elif [ "$db" -gt 0 ] && [ "$cfg" -eq 0 ]; then got=connect; else got=unclear; fi
  local ok=OK; { [ "$got" = "$want" ] && [ "$leak" -eq 0 ]; } || { ok=FAIL; fail=1; }
  echo "$ok $n port='$p': expected=$want got=$got network=[${conn:-none}] secret-lines=$leak"
}
run worker-54322   worker.cjs      54322     refuse
run worker-padded  worker.cjs      ' 54322 ' refuse
run worker-blank   worker.cjs      '   '     connect
run worker-6543    worker.cjs      6543      connect
run owner-54322    owner-agent.cjs 54322     refuse
run owner-6543     owner-agent.cjs 6543      connect
echo "outputs: $R"
exit $fail
