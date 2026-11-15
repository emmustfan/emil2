"use client";
import { useEffect, useRef, useState } from "react";
export function ImpersonationBanner({
  name,
  expiresAt,
  targetId,
  minutes,
}: {
  name: string;
  expiresAt: string;
  targetId: string;
  minutes: number;
}) {
  const ref = useRef<HTMLElement>(null),
    [remaining, setRemaining] = useState(minutes);
  useEffect(() => {
    const measure = () =>
      document.documentElement.style.setProperty(
        "--impersonation-banner-height",
        `${ref.current?.getBoundingClientRect().height ?? 0}px`,
      );
    const observer = new ResizeObserver(measure);
    if (ref.current) observer.observe(ref.current);
    measure();
    const update = () => {
      const left = Math.max(
        0,
        Math.ceil((+new Date(expiresAt) - Date.now()) / 60000),
      );
      setRemaining(left);
      if (!left)
        window.location.replace(`/admin/users/${encodeURIComponent(targetId)}`);
    };
    const interval = setInterval(update, 1000);
    return () => {
      clearInterval(interval);
      observer.disconnect();
      document.documentElement.style.removeProperty(
        "--impersonation-banner-height",
      );
    };
  }, [expiresAt, targetId]);
  return (
    <aside
      ref={ref}
      className="impersonation-banner"
      aria-label="Режим просмотра"
    >
      <p>
        Вы смотрите как <strong>{name}</strong> · только просмотр · осталось{" "}
        {remaining} мин
      </p>
      <form method="POST" action="/api/admin/impersonation/stop">
        <button className="min-h-11 rounded border px-4 font-semibold">
          Выйти
        </button>
      </form>
    </aside>
  );
}
