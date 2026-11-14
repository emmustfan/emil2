#!/bin/sh
set -eu
node --import tsx scripts/ops/preflight.ts
exec "$@"
