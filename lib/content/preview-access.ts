/** Only the disposable preview databases can use the simplified publication workflow. */
export function allowsQuickPublication(env: {
  NODE_ENV: string;
  DATABASE_URL: string;
}) {
  return (
    env.NODE_ENV !== "production" &&
    /^dental_preview_[a-f0-9]{12}$/.test(
      new URL(env.DATABASE_URL).pathname.slice(1),
    )
  );
}
