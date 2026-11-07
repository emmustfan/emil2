"use client";
import { useEffect, useState, useSyncExternalStore, useRef } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

function consentSnapshot() {
  try {
    return localStorage.getItem("analytics-consent");
  } catch {
    return "no";
  }
}
function subscribeConsent(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("analytics-preference", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("analytics-preference", callback);
  };
}
type Goal = "demo_started" | "demo_completed" | "signup_completed";
declare global {
  interface Window {
    ym?: (id: number, method: string, ...args: unknown[]) => void;
    dentalMetrikaId?: number;
  }
}
export function metrikaGoal(goal: Goal) {
  if (window.dentalMetrikaId)
    window.ym?.(window.dentalMetrikaId, "reachGoal", goal);
}
export function AnalyticsConsent({ metrikaId }: { metrikaId?: string }) {
  const path = usePathname(),
    consent = useSyncExternalStore(
      subscribeConsent,
      consentSnapshot,
      () => null,
    ),
    [editing, setEditing] = useState(false);
  const landingViewId = useRef<string | null>(null);
  const privatePage =
    /^\/(cabinet|student|teacher|admin|tutor|onboarding|auth|login|learn|review)(\/|$)/.test(
      path,
    );
  useEffect(() => {
    if (document.cookie.split("; ").some((c) => c === "signup_goal=1")) {
      try {
        localStorage.setItem("signup-goal-pending", "1");
      } catch {
        /* Storage may be disabled. */
      }
      document.cookie = "signup_goal=; Path=/; Max-Age=0; SameSite=Lax";
    }
  }, [path]);
  useEffect(() => {
    if (path !== "/") {
      landingViewId.current = null;
      return;
    }
    landingViewId.current ??= crypto.randomUUID();
    if (path === "/")
      fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "landing_viewed",
          props: {},
          requestId: landingViewId.current,
        }),
      }).catch(() => {});
  }, [path]);
  useEffect(() => {
    if (!metrikaId || consent !== "yes" || privatePage) return;
    const id = Number(metrikaId);
    let cancelled = false;
    const init = () => {
      if (cancelled) return;
      window.dentalMetrikaId = id;
      window.ym?.(id, "init", {
        clickmap: false,
        trackLinks: false,
        accurateTrackBounce: false,
        webvisor: false,
        defer: true,
      });
      // Send a clean URL: no tokens, UTM text, account identifiers or form fields.
      window.ym?.(id, "hit", `${location.origin}${path}`, {
        referer: location.origin,
      });
      if (path === "/demo") metrikaGoal("demo_started");
      try {
        if (localStorage.getItem("signup-goal-pending") === "1") {
          metrikaGoal("signup_completed");
          localStorage.removeItem("signup-goal-pending");
        }
      } catch {
        /* Storage may be disabled. */
      }
    };
    if (window.ym) init();
    else {
      const queue: unknown[][] = [];
      const ym = (...args: unknown[]) => {
        queue.push(args);
      };
      Object.assign(ym, { a: queue, l: Date.now() });
      window.ym = ym;
      const script = document.createElement("script");
      script.src = "https://mc.yandex.ru/metrika/tag.js";
      script.async = true;
      script.id = "metrika-script";
      script.onload = init;
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      window.ym?.(id, "destruct");
      window.dentalMetrikaId = undefined;
    };
  }, [metrikaId, consent, path, privatePage]);
  function choose(value: string) {
    try {
      localStorage.setItem("analytics-consent", value);
    } catch {
      /* Storage may be disabled. */
    }
    window.dispatchEvent(new Event("analytics-preference"));
    setEditing(false);
  }
  if (!metrikaId) return null;
  return (
    <>
      <button
        className="mx-5 my-3 min-h-11 text-xs text-stone-600 underline"
        onClick={() => setEditing(true)}
      >
        Настройки аналитики
      </button>
      {(consent === null || editing) && (
        <aside
          aria-label="Настройки аналитики"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-2xl border border-stone-300 bg-white p-5 shadow-lg"
        >
          <p className="text-sm leading-6">
            С вашего согласия подключим Яндекс.Метрику для статистики посещений.
            Запись экрана отключена; на страницах обучения и личных данных
            Метрика не загружается.{" "}
            <Link href="/legal/privacy" className="underline">
              Политика конфиденциальности
            </Link>
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="lesson-primary" onClick={() => choose("no")}>
              Только необходимые
            </button>
            <button className="lesson-primary" onClick={() => choose("yes")}>
              Разрешить аналитику
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
