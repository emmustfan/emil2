#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -d /Applications/Docker.app/Contents/Resources/bin ]]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi
finish() {
  result=$?
  if [[ "$result" != 0 ]]; then
    echo ""
    echo "Запуск не завершён. Сохраните текст ошибки из этого окна."
    if [[ -t 0 ]]; then read -r -p "Нажмите Enter, чтобы выйти… " || true; fi
  fi
}
trap finish EXIT
if ! command -v docker >/dev/null 2>&1; then
  echo "Установите Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Откройте Docker Desktop, дождитесь запуска и повторите эту команду."
  exit 1
fi
if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
fi
compose=(docker compose -f docker-compose.yml -f docker-compose.preview.yml)
echo "Запускаем локальный просмотр. Первая сборка может занять несколько минут."
"${compose[@]}" up --build -d postgres mailpit migrate web worker
for attempt in {1..60}; do
  if curl --fail --silent --max-time 3 http://localhost:3000/api/health >/dev/null 2>&1; then
    echo "Готово: http://localhost:3000/subjects"
    echo "Письма для тестового входа: http://localhost:8025"
    if command -v open >/dev/null 2>&1; then open http://localhost:3000/subjects; fi
    exit 0
  fi
  if (( attempt % 10 == 0 )); then echo "Ожидаем готовности сайта…"; fi
  sleep 1
done
echo "Сайт пока не ответил. Диагностика:"
"${compose[@]}" logs --tail 30 web migrate
exit 1
