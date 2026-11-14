"use client";
import { useEffect, useRef, useState } from "react";
import { authRu } from "@/lib/i18n/ru";
export function TelegramWidget({
  username,
  intent = "login",
}: {
  username?: string;
  intent?: "login" | "link";
}) {
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!username || !root.current) return;
    const container = root.current;
    // Receive the official widget's message directly: data-onauth uses eval in
    // telegram-widget.js v22, which would require weakening production CSP.
    async function receive(event: MessageEvent) {
      const frame = container.querySelector("iframe");
      if (
        event.origin !== "https://oauth.telegram.org" ||
        !frame ||
        event.source !== frame.contentWindow
      )
        return;
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.event !== "auth_user" || data.init || !data.auth_data) return;
        const response = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: data.auth_data, intent }),
        });
        const result = await response.json();
        if (response.ok) window.location.assign(result.redirect);
        else setError(result.error);
      } catch {
        setError(authRu.errors.unavailable);
      }
    }
    window.addEventListener("message", receive);
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", username);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-init-auth", "false");
    script.setAttribute("data-lang", "ru");
    container.appendChild(script);
    return () => {
      window.removeEventListener("message", receive);
      container.replaceChildren();
    };
  }, [username, intent]);
  if (!username)
    return (
      <p className="text-sm leading-6 text-stone-500">
        {authRu.telegramUnavailable}
      </p>
    );
  return (
    <div>
      <div
        ref={root}
        aria-label={intent === "link" ? authRu.linkTelegram : authRu.telegram}
      />
      {error && (
        <p className="mt-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
