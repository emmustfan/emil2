"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { contentRu as t } from "@/lib/i18n/ru";
import type { SectionDTO } from "@/lib/content/types";
import { fieldClass, requestContent } from "./helpers";
export function SectionForm({
  subjectId,
  initial,
}: {
  subjectId: string;
  initial?: SectionDTO;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setError("");
    setPending(true);
    try {
      await requestContent(
        initial ? `sections/${initial.id}` : "sections",
        initial ? "PATCH" : "POST",
        {
          title: values.get("title"),
          order: Number(values.get("order")),
          ...(initial ? { revision: initial.editRevision } : { subjectId }),
        },
      );
      if (!initial) form.reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.error);
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    if (!initial || !confirm(t.confirmDelete)) return;
    setPending(true);
    try {
      await requestContent(`sections/${initial.id}`, "DELETE", {
        revision: initial.editRevision,
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.error);
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={save} className="rounded-xl border border-stone-200 p-4">
      <fieldset disabled={pending} className="flex flex-wrap items-end gap-3">
        <label className="min-w-44 flex-1 text-sm">
          {t.name}
          <input
            name="title"
            className={fieldClass}
            required
            maxLength={200}
            defaultValue={initial?.title}
          />
        </label>
        <label className="w-24 text-sm">
          {t.order}
          <input
            name="order"
            type="number"
            min={0}
            max={10000}
            className={fieldClass}
            defaultValue={initial?.order ?? 0}
          />
        </label>
        <Button>{initial ? t.save : t.newSection}</Button>
        {initial && (
          <Button type="button" variant="outline" onClick={remove}>
            {t.remove}
          </Button>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {error}
        </p>
      )}
    </form>
  );
}
