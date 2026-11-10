import { IntegrationWorkspace } from "@/components/admin/integration-workspace";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/server";
import { getEnv } from "@/lib/env";
import { integrationSummary } from "@/lib/admin/integrations";
export const dynamic = "force-dynamic";
export default async function Integrations() {
  await requireAdmin();
  const cards = integrationSummary(getEnv());
  return (
    <main className="mx-auto max-w-5xl">
      <h1 className="text-3xl font-semibold">Подключение сервисов</h1>
      <p className="mt-4 max-w-3xl text-sm leading-7">
        Здесь показано, в каком режиме запущена платформа. Ключи сервисов
        хранятся в настройках сервера, а не в уроках. На этой странице их
        значения не отображаются.
      </p>
      <IntegrationWorkspace
        cards={cards}
        panels={[
          <section
            key="email"
            id="connect-email"
            className="scroll-mt-5 rounded-2xl border bg-white p-5"
          >
            <h2 className="text-xl font-semibold">Почта и повторный вход</h2>
            <p className="mt-3 text-sm leading-7">
              На Mac письма открываются в{" "}
              <a href="http://localhost:8025" className="underline">
                Mailpit
              </a>
              . Они не приходят в настоящий почтовый ящик. Одна форма работает
              для нового и существующего аккаунта; повторно регистрироваться
              каждый раз не нужно. Вход с паролем пока не добавлен.
            </p>
            <p className="mt-3 text-sm leading-7">
              Для рабочего сайта понадобятся адрес отправителя и SMTP-настройки
              почтового сервиса: <code>MAIL_TRANSPORT=smtp</code>,{" "}
              <code>SMTP_HOST</code>, <code>SMTP_PORT</code>,{" "}
              <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code>,{" "}
              <code>MAIL_FROM</code>. Это отдельная настройка перед публикацией;
              дополнительный файл просмотра сохраняет Mailpit.
            </p>
          </section>,
          <section
            key="telegram"
            id="connect-telegram"
            className="mt-6 scroll-mt-5 rounded-2xl border bg-white p-5"
          >
            <h2 className="text-xl font-semibold">
              Telegram: что нужно владельцу
            </h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7">
              <li>
                В Telegram откройте официальный <code>@BotFather</code>,
                выполните <code>/newbot</code> и создайте бота.
              </li>
              <li>
                Имя бота без @ запишите в <code>TELEGRAM_BOT_USERNAME</code>,
                выданный токен — в <code>TELEGRAM_BOT_TOKEN</code>. Токен —
                секрет сервера, не пароль ученика.
              </li>
              <li>
                Для настоящего входа нужен доступный домен сайта. Через{" "}
                <code>/setdomain</code> в BotFather привяжите его к боту. На
                рабочем сайте <code>APP_URL</code> должен совпадать с
                HTTPS-адресом.
              </li>
              <li>
                После перезапуска проверьте вход на этом домене в другом профиле
                браузера. Наличие токена на локальном Mac ещё не означает, что
                Telegram-вход заработал.
              </li>
            </ol>
            <p className="mt-4 text-sm leading-7">
              Здесь реализован вход через Telegram Login Widget. Напоминания в
              Telegram и отдельный учебный бот пока не подключены.
            </p>
          </section>,
          <section
            key="ai"
            id="connect-ai"
            className="mt-6 scroll-mt-5 rounded-2xl border bg-white p-5"
          >
            <h2 className="text-xl font-semibold">ИИ: два вида модели</h2>
            <p className="mt-3 text-sm leading-7">
              Чат-модель формулирует ответ. Модель поиска, или embeddings,
              помогает найти нужные фрагменты методички. Поэтому одного названия
              чат-модели недостаточно. Для текущей базы нужна размерность поиска
              1536.
            </p>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7">
              <li>
                Выберите провайдера. Поддержаны OpenAI-совместимый API и
                Anthropic с отдельным провайдером embeddings.
              </li>
              <li>
                Для совместимого API заполните{" "}
                <code>LLM_PROVIDER=openai_compatible</code>,{" "}
                <code>LLM_BASE_URL</code>, <code>LLM_API_KEY</code>,{" "}
                <code>LLM_CHAT_MODEL</code>, <code>LLM_EMBEDDING_MODEL</code>.
                Адрес и имена моделей выдаёт выбранный сервис; подходят не любые
                модели.
              </li>
              <li>
                Запустите сайт командой с дополнительным файлом выше. Worker
                подготовит поиск по опубликованным проверенным темам. Черновики
                в ответы ученика не попадают.
              </li>
              <li>
                В уроке задайте вопрос по тексту и проверьте ссылки на
                источники. Затем проверьте вопрос вне материала и объяснение
                неправильного ответа. Оценку медицинской точности делает
                преподаватель.
              </li>
            </ol>
            <p className="mt-4 text-sm leading-7">
              Запросы к реальному ИИ оплачиваются по правилам провайдера.
              Дневные лимиты ученика меняются в{" "}
              <Link href="/admin/settings?section=plans" className="underline">
                тарифах
              </Link>
              . Тьютор пока работает с текстом и подписями к картинкам, а не
              анализирует сами изображения.
            </p>
          </section>,
          <section
            key="images"
            id="connect-images"
            className="mt-6 scroll-mt-5 rounded-2xl border bg-white p-5"
          >
            <h2 className="text-xl font-semibold">
              Изображения и проверка урока
            </h2>
            <p className="mt-3 text-sm leading-7">
              Изображение загружается из редактора, преобразуется в WebP и
              хранится в томе Docker вместе с данными просмотра. Ссылка доступна
              по тем же правилам, что урок. Сохраните Docker-тома при
              обновлении.
            </p>
            <p className="mt-3 text-sm leading-7">
              В редакторе есть технический список готовности и шаблон запроса
              для ИИ-рецензирования. Ответы ученика проверяются по эталонам
              автора без промптов. Шаблон можно скопировать для дополнительной
              проверки содержания; это не автоматическая экспертная отметка.
            </p>
          </section>,
        ]}
      />
      <details className="integration-launch">
        <summary>Инструкция: подключение сервисов на Mac</summary>
        <section className="mb-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-xl font-semibold">Два режима запуска на Mac</h2>
          <p className="mt-3 text-sm leading-7">
            Обычная команда <code>bash start-mac.command</code> оставляет
            тестового ИИ, оплату без денег и письма в Mailpit. Это удобно для
            проверки уроков. Для подключения выбранного ИИ или Telegram
            используется отдельный файл запуска; прежняя база сохраняется.
          </p>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7">
            <li>
              Сначала один раз запустите обычный просмотр. Он создаст файл{" "}
              <code>.env</code>.
            </li>
            <li>
              Откройте Terminal в папке проекта, выполните{" "}
              <code>nano .env</code> и заполните поля выбранного сервиса.
              Сохранить: Ctrl+O, Enter; выйти: Ctrl+X. Это Ctrl, не Command.
            </li>
            <li>
              Запустите команду ниже. Платежи останутся тестовыми. Реальные
              ключи в этот чат или GitHub не отправляйте.
            </li>
          </ol>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-white p-4 text-xs leading-6">{`docker compose -p emil2-local-preview \\\n  -f docker-compose.yml -f docker-compose.preview.yml \\\n  -f docker-compose.integrations.yml up --build -d web worker`}</pre>
          <p className="mt-3 text-sm leading-7">
            Если снова запустить обычный <code>start-mac.command</code>, сайт
            вернётся в режим тестового просмотра.
          </p>
        </section>
      </details>
    </main>
  );
}
