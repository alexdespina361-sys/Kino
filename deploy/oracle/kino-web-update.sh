#!/bin/sh
# Keeps the website on GitHub's main, as Render did: when main has moved, check it out, install and build the way Render's Build Command
# did, and restart. One that does not answer /api/health within a minute is let go: the one before comes back, and that commit is not
# tried again (the next push is). Run by kino-web-update.timer; `kino-web-update.sh --force` deploys main even when it has not moved.
set -eu
cd /opt/kino-web
export PATH=/opt/kino-node/bin:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
state=/var/lib/kino-web-update
git fetch -q origin main
old=$(git rev-parse HEAD)
new=$(git rev-parse origin/main)
if [ "${1:-}" != "--force" ]; then
  [ "$old" = "$new" ] && exit 0
  [ "$(cat "$state/failed" 2>/dev/null || true)" = "$new" ] && exit 0
fi

deploy() {
  git checkout -q -f --detach "$1" || return 1
  corepack pnpm install --frozen-lockfile --prod=false || return 1
  corepack pnpm build || return 1
  systemctl restart kino-web || return 1
  for _ in $(seq 1 60); do
    curl -fs -m 2 http://127.0.0.1:8787/api/health >/dev/null && return 0
    sleep 1
  done
  return 1
}

if deploy "$new"; then
  rm -f "$state/failed"
  echo "kino-web: now at $(git log --oneline -1)"
else
  echo "$new" >"$state/failed"
  echo "kino-web: $(git log --oneline -1 "$new") did not start; back to $(git log --oneline -1 "$old")" >&2
  deploy "$old" || echo "kino-web: and $old did not start either" >&2
  exit 1
fi
