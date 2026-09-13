#!/usr/bin/env bash
# Build and serve in the foreground; the caller/service owns the process.
set -euo pipefail
viewer_port="${1:-3001}"
if [[ ! "$viewer_port" =~ ^[0-9]+$ ]] || (( viewer_port < 1 || viewer_port > 65535 )); then
  echo "Usage: $0 [port 1–65535]" >&2
  exit 2
fi
cd "$(dirname "$0")/.."
npm run build
printf 'Viewer: http://vibecheck.local:%s/ and http://vibecheck.taildd340.ts.net:%s/\n' "$viewer_port" "$viewer_port"
exec npm run start -- --host 0.0.0.0 --port "$viewer_port"
