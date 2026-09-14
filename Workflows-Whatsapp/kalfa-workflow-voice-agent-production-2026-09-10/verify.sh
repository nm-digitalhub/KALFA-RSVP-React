#!/usr/bin/env bash
set -euo pipefail
npx tsc --noEmit
npm run lint
npm run worker:deps
npm test
npm run build
