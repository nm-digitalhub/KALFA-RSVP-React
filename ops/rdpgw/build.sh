#!/usr/bin/env bash
# ops/rdpgw/build.sh - reproducible build of rdpgw at the pinned commit + KALFA patches. Builds and verifies only:
# it never installs or starts anything.
# Needs: git, go (>= 1.25), gcc (go test -race), govulncheck, network (github.com, proxy.golang.org, sum.golang.org).
# govulncheck is a REQUIRED gate, not an option: go install golang.org/x/vuln/cmd/govulncheck@latest
# Every step prints a "##### <name>" header, and the script stops at the first failing step.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
step() { printf '\n##### %s\n' "$*"; }

GOVULN=$(command -v govulncheck || true)
[ -n "$GOVULN" ] || GOVULN="$HOME/.local/bin/govulncheck"
if [ ! -x "$GOVULN" ]; then
  echo "ERROR: govulncheck is required: the vulnerability scan is a gate and cannot be skipped." >&2
  echo "Install it: go install golang.org/x/vuln/cmd/govulncheck@latest" >&2
  exit 1
fi

PIN=$(cat "$HERE/PINNED_COMMIT")
WORK="$HERE/build"                                   # gitignored
export GOTOOLCHAIN=go1.26.6 GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org   # >= 1.26.6 carries the stdlib security fixes

step "inputs: patches and go.sum are exactly the reviewed ones"
( cd "$HERE" && sha256sum --check SHA256SUMS )
rm -rf "$WORK"; mkdir -p "$WORK"
git clone --quiet https://github.com/bolkedebruin/rdpgw.git "$WORK/src"
git -C "$WORK/src" checkout --quiet --detach "$PIN"
test "$(git -C "$WORK/src" rev-parse HEAD)" = "$PIN"
( cd "$WORK/src"
  for p in "$HERE"/patches/*.patch; do git apply --check "$p"; git apply "$p"; done
  cp "$HERE/go.sum" go.sum                           # upstream .gitignore lists go.sum -> we pin our own
  go version

  step "go vet"
  go vet ./cmd/rdpgw/...

  step "source vulnerability scan (govulncheck, source mode)"
  CGO_ENABLED=0 "$GOVULN" ./cmd/rdpgw

  step "race tests (go test -race)"
  go test -race -count=1 ./cmd/rdpgw/...

  step "build"
  CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags='-buildid=' -o "$WORK/rdpgw" ./cmd/rdpgw )
sha256sum "$WORK/rdpgw" | tee "$WORK/rdpgw.sha256"

step "binary vulnerability scan (govulncheck, binary mode)"
"$GOVULN" -mode=binary "$WORK/rdpgw"

step "BINARY_SHA256: the recorded hash of the reviewed binary"
if ! ( cd "$HERE" && sha256sum --check BINARY_SHA256 ); then
  echo "BINARY_SHA256 MISMATCH: recorded $(cut -d' ' -f1 "$HERE/BINARY_SHA256"), built $(cut -d' ' -f1 "$WORK/rdpgw.sha256")" >&2
  exit 1
fi
echo "all gates passed"
