import type { AppEnv } from "../env";
export function integrationSummary(env: AppEnv) {
  return [
    {
      id: "email",
      title: "Вход по почте",
      status:
        env.MAIL_TRANSPORT === "log"
          ? "Тестовые письма в файлах"
          : env.SMTP_HOST === "mailpit" || env.SMTP_HOST === "localhost"
            ? "Локальный почтовый ящик Mailpit"
            : "Настройки SMTP заданы",
      description:
        "Письмо содержит одноразовую ссылку. Для настоящих почтовых ящиков нужен почтовый сервис.",
    },
    {
      id: "telegram",
      title: "Вход через Telegram",
      status:
        env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME
          ? "Настройки бота заданы"
          : "Бот не подключён",
      description:
        "Telegram подтверждает личность вместо письма. Это не проверка медицинских знаний и не бот для напоминаний.",
    },
    {
      id: "ai",
      title: "ИИ-тьютор",
      status:
        env.LLM_PROVIDER === "mock"
          ? "Тестовая модель без внешних запросов"
          : "Настройки провайдера заданы",
      description:
        "Реальная работа требует модели для ответов, модели поиска и запущенного фонового процесса. Наличие настроек не подтверждает соединение.",
    },
    {
      id: "images",
      title: "Изображения уроков",
      status:
        env.STORAGE_DRIVER === "local"
          ? "Локальное хранилище Docker"
          : "Выбрано S3-хранилище",
      description:
        env.STORAGE_DRIVER === "local"
          ? "Изображения хранятся в постоянном томе просмотра. Перед запуском в интернете потребуется перенос в хранилище проекта."
          : "S3-адаптер реализован. Нужны закрытый бакет и ключи в окружении; реальное подключение проверяется отдельно.",
    },
  ];
}
