"use client";
import { useState } from "react";
import { useClientReady } from "@/lib/use-client-ready";
export function useAdminSave() {
  const ready = useClientReady();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  async function save(path: string, input: unknown) {
    if (busy) return null;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const r = await fetch(`/api/admin/manage/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
        data = await r.json();
      if (!r.ok)
        throw new Error(data.error ?? "Не удалось сохранить изменения.");
      setMessage("Сохранено.");
      return data;
    } catch (e) {
      setFailed(true);
      setMessage(e instanceof Error ? e.message : "Попробуйте снова.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { save, busy: busy || !ready, message, failed };
}
