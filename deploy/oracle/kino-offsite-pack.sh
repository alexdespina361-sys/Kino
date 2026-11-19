#!/usr/bin/env bash
set -euo pipefail
umask 027

SRC=/var/backups/kino-db
OUT=/var/backups/kino-offsite
KEY=/etc/kino-backup/recipient.asc
PULL_GROUP=${PULL_GROUP:-ubuntu}
KEEP=${KEEP:-7}

[ -r "$KEY" ] || { echo "no recipient key at $KEY" >&2; exit 1; }
dump=$(ls -1t "$SRC"/kino-*.dump 2>/dev/null | head -n 1 || true)
[ -n "$dump" ] || { echo "no database copy in $SRC" >&2; exit 1; }

name="kino-offsite-$(date -u +%F).tar.gz.gpg"
part="$OUT/.$name.part"
install -d -m 0750 -g "$PULL_GROUP" "$OUT"

items=(-C "$SRC" "$(basename "$dump")")
if [ -n "${DATA_DIR:-}" ] && [ "$DATA_DIR" != memory ] && [ -d "$DATA_DIR" ]; then
  items+=(-C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")")
else
  echo "DATA_DIR not found, packing the database copy only" >&2
fi

keys=$(mktemp -d)
trap 'rm -rf "$keys" "$part"' EXIT
(tar -czf - --warning=no-file-changed "${items[@]}" || [ $? -eq 1 ]) | gpg --batch --yes --no-tty --homedir "$keys" --trust-model always --recipient-file "$KEY" --encrypt --output "$part"
[ -s "$part" ] || { echo "the packed copy is empty" >&2; exit 1; }
chgrp "$PULL_GROUP" "$part"
chmod 0640 "$part"
mv -f "$part" "$OUT/$name"
ls -1t "$OUT"/kino-offsite-*.tar.gz.gpg | tail -n +"$((KEEP + 1))" | xargs -r rm -f
echo "packed $name ($(stat -c %s "$OUT/$name") bytes, from $(basename "$dump"))"
