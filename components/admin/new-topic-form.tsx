"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { contentRu as t } from "@/lib/i18n/ru";
import type { SectionDTO, TopicDTO } from "@/lib/content/types";
import { headingSlug } from "@/lib/content/slug";
import { fieldClass, requestContent } from "./helpers";
export function NewTopicForm({
  subjectId,
  sections,
}: {
  subjectId: string;
  sections: SectionDTO[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const row = await requestContent<TopicDTO>("topics", "POST", {
        subjectId,
        title,
        slug,
        sectionId: values.get("sectionId") || null,
        order: 0,
        isFree: false,
        contentMd: "",
        readingMinutes: null,
        authorName: null,
        reviewerName: null,
        referencesMd: null,
        reviewed: false,
      });
      router.push(`/admin/topics/${row.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.error);
      setPending(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-5">
      <fieldset disabled={pending} className="grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-medium">
          {t.name}
          <input
            className={fieldClass}
            required
            maxLength={200}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setSlug(headingSlug(e.target.value));
            }}
          />
        </label>
        <label className="text-sm font-medium">
          {t.slug}
          <input
            className={fieldClass}
            required
            maxLength={100}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          {t.section}
          <select name="sectionId" className={fieldClass}>
            <option value="">{t.noSection}</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      <Button disabled={pending}>{t.create}</Button>
    </form>
  );
}
