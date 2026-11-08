"use client";
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ru">
      <body style={{ fontFamily: "sans-serif", padding: 32, lineHeight: 1.7 }}>
        <h1>Не удалось открыть страницу</h1>
        <p>
          Попробуйте ещё раз. Сохранённый прогресс останется в вашем кабинете.
        </p>
        <button onClick={reset} style={{ padding: 16, cursor: "pointer" }}>
          Попробовать снова
        </button>
      </body>
    </html>
  );
}
