#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 3 ]]; then echo "Использование: bash scripts/ops/restore.sh preview|production ПАПКА_КОПИИ emil2_restore_НОВОЕ_ИМЯ" >&2; exit 2; fi
source "$(dirname "$0")/compose.sh" "$1"
archive=$(cd "$2" && pwd -P)
restore_db=$3
if [[ ! "$restore_db" =~ ^emil2_restore_[a-z0-9_]{1,40}$ ]]; then echo "Имя новой базы должно начинаться с emil2_restore_ и содержать только a-z, цифры и _." >&2; exit 2; fi
[[ -f "$archive/FORMAT" && "$(cat "$archive/FORMAT")" == emil2-backup-v1 ]]
[[ ! -L "$archive/database.dump" && ! -L "$archive/uploads.tar" && ! -L "$archive/SHA256SUMS" ]]
# Never trust a manifest to select arbitrary host paths.
[[ $(wc -l < "$archive/SHA256SUMS" | tr -d ' ') == 3 ]]
for file in database.dump uploads.tar FORMAT; do
  expected=$(sed -n "s/^\([a-f0-9]\{64\}\)  $file$/\1/p" "$archive/SHA256SUMS")
  [[ ${#expected} == 64 ]]
  actual=$(checksum "$archive/$file"); actual=${actual%% *}
  [[ "$actual" == "$expected" ]] || { echo "Повреждена копия: $file" >&2; exit 1; }
done
volume="${project}_${restore_db}_uploads"
if docker volume inspect "$volume" >/dev/null 2>&1; then echo "Том восстановления уже существует. Выберите новое имя; данные не изменены." >&2; exit 1; fi
# Reject anything except the flat opaque files produced by LocalStorageDriver.
"${compose[@]}" run --rm --no-deps -T -v "$archive:/backup:ro" --entrypoint node web --import tsx scripts/ops/check-archive.ts /backup/uploads.tar
# createdb fails if the target exists. There is deliberately no DROP, --clean or overwrite mode.
"${compose[@]}" exec -T postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec createdb -U "$POSTGRES_USER" --template=template0 --owner="$POSTGRES_USER" "$1"' sh "$restore_db"
"${compose[@]}" exec -T postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_restore --exit-on-error --single-transaction --no-owner --no-acl -U "$POSTGRES_USER" -d "$1"' sh "$restore_db" < "$archive/database.dump"
docker volume create --label emil2.managed=restore "$volume" >/dev/null
"${compose[@]}" run --rm --no-deps -T --user 0:0 -v "$archive:/backup:ro" -v "$volume:/restored" --entrypoint sh web -c 'tar --extract --no-same-owner -f /backup/uploads.tar -C /restored && chown -R 1000:1000 /restored'
printf 'Восстановлено отдельно: база %s, том %s. Текущий сайт использует прежнюю базу.\n' "$restore_db" "$volume"
