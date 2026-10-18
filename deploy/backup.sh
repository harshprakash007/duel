#!/bin/sh
# Nightly Postgres backup loop: dumps at ~03:00 UTC, keeps the last 14 dumps.
set -eu
while true; do
  now=$(date -u +%H%M)
  if [ "$now" = "0300" ]; then
    f="/backups/duel-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
    pg_dump -h postgres -U duel duel | gzip > "$f"
    echo "backup written: $f"
    ls -1t /backups/duel-*.sql.gz | tail -n +15 | xargs -r rm -f
    sleep 61
  fi
  sleep 30
done
