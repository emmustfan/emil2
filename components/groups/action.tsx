"use client";

import { useState } from "react";
import { useClientReady } from "@/lib/use-client-ready";

export function useGroupAction() {
  const ready = useClientReady();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function submit<T>(
    path: string,
    input: unknown,
    success = "Сохранено.",
  ) {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch(`/api/groups/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMessage(success);
      return data as T;
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : "Попробуйте ещё раз.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { submit, busy: busy || !ready, message, failed };
}

export function GroupFeedback({
  message,
  failed,
}: {
  message: string;
  failed: boolean;
}) {
  return (
    <p
      role={failed ? "alert" : "status"}
      className={failed ? "text-sm text-red-800" : "text-sm text-emerald-800"}
    >
      {message}
    </p>
  );
}

export const fieldClass =
  "min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3";
