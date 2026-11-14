#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/compose.sh" "${1:-preview}"
umask 077
backup_root=${EMIL2_BACKUP_DIR:-"$HOME/Documents/Emil2-Backups"}
mkdir -p "$backup_root"
backup_root=$(cd "$backup_root" && pwd -P)
partial=$(mktemp -d "$backup_root/.emil2-partial-XXXXXXXX")
active=()
finished=false
cleanup() {
  result=$?
  if [[ ${#active[@]} -gt 0 ]]; then "${compose[@]}" start "${active[@]}" >&2 || result=1; fi
  if [[ "$finished" != true ]]; then rm -rf -- "$partial"; fi
  exit "$result"
}
trap cleanup EXIT
# Local files and database need one consistent point. Restart only services that were running.
if [[ "$mode" == preview ]]; then
  while IFS= read -r service; do
    if [[ "$service" == web || "$service" == worker ]]; then active+=("$service"); fi
  done < <("${compose[@]}" ps --status running --services)
  if [[ ${#active[@]} -gt 0 ]]; then "${compose[@]}" stop "${active[@]}" >&2; fi
fi
"${compose[@]}" exec -T postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$partial/database.dump"
"${compose[@]}" run --rm --no-deps -T --entrypoint tar web --format=ustar -C /app/tmp/uploads -cf - . > "$partial/uploads.tar"
[[ -s "$partial/database.dump" && -s "$partial/uploads.tar" ]]
printf '%s\n' emil2-backup-v1 > "$partial/FORMAT"
(cd "$partial" && checksum database.dump uploads.tar FORMAT > SHA256SUMS)
backup_id="emil2-$(date -u +%Y%m%dT%H%M%SZ)-${partial##*-}"
destination="$backup_root/$backup_id"
[[ ! -e "$destination" ]]
mv "$partial" "$destination"
finished=true
# In production, remote files are immutable versioned S3 objects. Offsite completion is mandatory.
if [[ "$mode" == production || ${EMIL2_UPLOAD_BACKUP:-false} == true ]]; then
  "${compose[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" -v "$destination:/backup" --entrypoint node web --import tsx scripts/ops/offsite.ts upload /backup
fi
if [[ ${EMIL2_PRUNE_EXPIRED:-false} == true ]]; then
  "${compose[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" -v "$backup_root:/backups" --entrypoint node web --import tsx scripts/ops/offsite.ts prune-local /backups
fi
printf 'Копия создана: %s\n' "$destination"
