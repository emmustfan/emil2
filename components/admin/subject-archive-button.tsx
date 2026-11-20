"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { requestContent } from "./helpers";

export function SubjectArchiveButton({
  id,
  revision,
  archived,
  returnTo,
}: {
  id: string;
  revision: number;
  archived: boolean;
  returnTo: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (
      !archived &&
      !confirm(
        "Убрать предмет в архив? Студенты потеряют доступ к его урокам. Ответы и прогресс сохранятся.",
      )
    )
      return;
    setPending(true);
    setError("");
    try {
      const action = archived ? "restore" : "archive";
      await requestContent(`subjects/${id}/${action}`, "POST", { revision });
      if (!archived) router.replace(returnTo);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить архив.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => void submit()}
      >
        {archived ? "Восстановить предмет" : "В архив"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
