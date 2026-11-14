"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { contentRu as t } from "@/lib/i18n/ru";
import type { SubjectDTO } from "@/lib/content/types";
import { headingSlug } from "@/lib/content/slug";
import { fieldClass, requestContent } from "./helpers";
export function SubjectForm({ initial }: { initial?: SubjectDTO }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      const body = {
        title,
        slug,
        shortDescription: String(values.get("shortDescription")),
        descriptionMd: String(values.get("descriptionMd")) || null,
        courses: String(values.get("courses"))
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
          .map(Number),
        order: Number(values.get("order")),
        status: String(values.get("status")),
        seoTitle: String(values.get("seoTitle")) || null,
        seoDescription: String(values.get("seoDescription")) || null,
        ...(initial ? { revision: initial.editRevision } : {}),
      };
      const row = await requestContent<SubjectDTO>(
        initial ? `subjects/${initial.id}` : "subjects",
        initial ? "PATCH" : "POST",
        body,
      );
      if (initial) router.refresh();
      else router.push(`/admin/subjects/${row.id}`);
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
      await requestContent(`subjects/${initial.id}`, "DELETE", {
        revision: initial.editRevision,
      });
      router.push("/admin");
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
              if (!initial) setSlug(headingSlug(e.target.value));
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
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          {t.shortDescription}
          <textarea
            name="shortDescription"
            className={fieldClass}
            required
            maxLength={1000}
            defaultValue={initial?.shortDescription}
          />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          {t.descriptionMd}
          <textarea
            name="descriptionMd"
            rows={5}
            maxLength={20000}
            className={fieldClass}
            defaultValue={initial?.descriptionMd ?? ""}
          />
        </label>
        <label className="text-sm font-medium">
          {t.courses}
          <input
            name="courses"
            className={fieldClass}
            defaultValue={initial?.courses.join(", ") ?? "1, 2, 3"}
          />
        </label>
        <label className="text-sm font-medium">
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
        <label className="text-sm font-medium">
          {t.status}
          <select
            name="status"
            className={fieldClass}
            defaultValue={initial?.status ?? "DRAFT"}
          >
            {Object.entries(t.statuses).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          {t.seoTitle}
          <input
            name="seoTitle"
            maxLength={200}
            className={fieldClass}
            defaultValue={initial?.seoTitle ?? ""}
          />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          {t.seoDescription}
          <textarea
            name="seoDescription"
            maxLength={500}
            className={fieldClass}
            defaultValue={initial?.seoDescription ?? ""}
          />
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button disabled={pending}>{initial ? t.save : t.create}</Button>
        {initial && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={remove}
          >
            {t.remove}
          </Button>
        )}
      </div>
    </form>
  );
}
