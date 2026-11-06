"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authRu } from "@/lib/i18n/ru";
export function VerifyForm({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        body: new URLSearchParams({ token }),
      });
      if (response.redirected) {
        window.location.assign(response.url);
        return;
      }
      const result = await response.json();
      setError(result.error ?? authRu.errors.invalid);
    } catch {
      setError(authRu.errors.unavailable);
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      method="POST"
      action="/api/auth/verify"
      onSubmit={submit}
      className="space-y-5"
    >
      <input type="hidden" name="token" value={token} />
      {error && (
        <div role="alert" className="space-y-3 text-sm leading-6">
          <p className="text-red-800">{error}</p>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center text-emerald-800 underline"
          >
            {authRu.newLink}
          </Link>
        </div>
      )}
      <Button className="w-full" disabled={pending}>
        {authRu.verify}
      </Button>
    </form>
  );
}
