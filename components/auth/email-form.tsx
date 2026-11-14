"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { authRu } from "@/lib/i18n/ru";
import { inputClass } from "./shell";
export function EmailForm({
  intent = "login",
  resendSeconds,
}: {
  intent?: "login" | "link";
  resendSeconds: number;
}) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), intent }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error);
        return;
      }
      setSent(true);
      setLeft(resendSeconds);
    } catch {
      setError(authRu.errors.unavailable);
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="block text-sm font-medium">
        {authRu.email}
        <input
          className={inputClass}
          name="email"
          type="email"
          autoComplete="email"
          placeholder={authRu.emailPlaceholder}
          maxLength={254}
          required
        />
      </label>
      {sent && (
        <div
          role="status"
          className="rounded-xl bg-emerald-50 p-4 text-sm leading-6"
        >
          <strong className="block">{authRu.sentTitle}</strong>
          {authRu.sentText}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending || left > 0} className="w-full">
        {pending
          ? authRu.sending
          : left > 0
            ? `${authRu.resendIn} ${left} ${authRu.seconds}`
            : sent
              ? authRu.resend
              : authRu.sendLink}
      </Button>
    </form>
  );
}
