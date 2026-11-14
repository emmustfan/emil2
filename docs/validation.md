# Проверка этапа 0 — 2026-11-06

Проверки повторены после публикации среды в `/workspace/emil2`, Node.js 24.22.1,
pnpm 10.34.9. Сетевые запреты из предыдущего запуска сняты в опубликованной
конфигурации. Новые настройки среды не сохранялись, публикация агентом не выполнялась.

| Проверка                         | Результат                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                      | Успешно, без предупреждений                                                                                                                    |
| `pnpm typecheck`                 | Успешно: Prisma Client, типы маршрутов Next.js и TypeScript strict                                                                             |
| `pnpm test`                      | 15 unit-тестов успешно; без БД, Docker и внешних API                                                                                           |
| `pnpm build`                     | Успешно: оптимизированная сборка, `/` статический, `/api/health` динамический                                                                  |
| `pnpm test:e2e`                  | 2 успешно: desktop и mobile, Chromium из закреплённой версии Playwright                                                                        |
| Полный Docker Compose            | MinIO и приложение собраны; PostgreSQL, MinIO, Mailpit, web и worker запущены                                                                  |
| Миграции Prisma                  | `20261106000000_foundation` применена; сервис migrate завершился с кодом 0                                                                     |
| Повторный `pnpm db:migrate`      | Успешно: `No pending migrations to apply`                                                                                                      |
| `pnpm db:seed`                   | Успешно; пока только проверка БД, без продуктовых seed-данных этапа 1                                                                          |
| `/api/health`                    | HTTP 200, `status: ok`, `database: ok` — реальный запрос к PostgreSQL                                                                          |
| Worker                           | `worker:smoke` отправил задачу, отдельный worker выполнил её, отправитель дождался completed                                                   |
| MinIO                            | Подписанные AWS SigV4 запросы: создание временного бакета, запись бинарного объекта, чтение с побайтовым сравнением, удаление объекта и бакета |
| Mailpit                          | SMTP принял тестовое письмо, HTTP API вернул письмо с темой текущего запуска                                                                   |
| `scripts/codex-setup.sh`         | Успешно: frozen install, генерация Prisma, запуск инфраструктуры, миграции, установка браузера                                                 |
| `scripts/codex-maintenance.sh`   | Успешно на уже подготовленной машине; данные сохранены, ожидающих миграций нет                                                                 |
| Перезапуск web/worker            | После запуска новых процессов health и worker smoke проходят                                                                                   |
| Форматирование и shell-синтаксис | Prettier, `git diff --check`, `bash -n` успешно                                                                                                |

GitHub Actions описан в `.github/workflows/ci.yml`; все команды этого workflow
прошли локально. Удалённый CI не запускался, PR и merge не выполнялись.

## Воспроизведение

```sh
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
docker compose -f docker-compose.yml -f docker-compose.cloud.yml up --build -d
corepack pnpm db:migrate
corepack pnpm db:seed
docker compose exec -T worker pnpm worker:smoke
corepack pnpm test:e2e
```

Cloud override нужен только в среде с сессионным прокси/CA. Обычный локальный
запуск описан в README. TLS, контрольные суммы Prisma и Go sum verification
оставлены включёнными. Браузер хранится в игнорируемом `tmp/playwright`.

## Что остаётся за пределами этапа 0

- Полная схема данных, продуктовый seed и аутентификация — этап 1.
- Учебные сценарии, тьютор, реальные платёжные и почтовые адаптеры — следующие этапы ТЗ.
- Реальные ключи и production-деплой не настраивались; production-моки запрещены.
- Ручная визуальная оценка и проверка с клавиатуры остаются в чек-листе README.

Ранее проверены JSONB и cosine distance pgvector в отдельной транзакции с откатом.
Текущая Prisma-миграция также успешно создала расширение vector и таблицу AppSetting.
