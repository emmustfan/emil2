"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { headingSlug } from "@/lib/content/slug";
import { staffLabels } from "@/lib/org/labels";
import type { StaffRole } from "@/lib/generated/prisma/client";

const field = "min-h-11 rounded border border-stone-300 bg-white px-3";
function OrgForm({
  path,
  fields,
  label,
  input,
}: {
  path: string;
  fields: ReactNode;
  label: string;
  input: (form: FormData) => Record<string, unknown>;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch("/api/admin/org/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input(new FormData(e.currentTarget))),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Не удалось сохранить изменения.");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось сохранить изменения.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="space-y-2" onSubmit={submit}>
      <fieldset disabled={saving} className="flex flex-wrap items-end gap-3">
        {fields}
        <button className="lesson-primary">
          {saving ? "Сохраняем…" : label}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-emerald-800">
          Сохранено.
        </p>
      )}
    </form>
  );
}

export function OrgEntityForm({
  entity,
  initial,
  facultyId,
}: {
  entity: "faculties" | "departments";
  initial?: {
    id: string;
    title: string;
    slug: string;
    order: number;
    archived: boolean;
    requireSeparateReviewer?: boolean;
  };
  facultyId?: string;
}) {
  const [title, setTitle] = useState(initial?.title ?? ""),
    [slug, setSlug] = useState(initial?.slug ?? "");
  const noun = entity === "faculties" ? "факультет" : "кафедру";
  return (
    <OrgForm
      path={entity + (initial ? "/" + initial.id : "")}
      label={initial ? "Сохранить" : "Создать " + noun}
      input={(form) => ({
        title,
        slug,
        order: Number(form.get("order")),
        archived: form.has("archived"),
        ...(facultyId
          ? { facultyId, requireSeparateReviewer: form.has("review") }
          : {}),
      })}
      fields={
        <>
          <label className="grid gap-1 text-sm">
            Название{" "}
            <input
              className={field}
              required
              maxLength={200}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!initial)
                  setSlug(headingSlug(e.target.value).slice(0, 100));
              }}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Адрес{" "}
            <input
              className={field}
              required
              maxLength={100}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Порядок{" "}
            <input
              className={field + " w-24"}
              type="number"
              min={0}
              name="order"
              defaultValue={initial?.order ?? 0}
            />
          </label>
          {initial && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="archived"
                defaultChecked={initial.archived}
              />{" "}
              В архиве
            </label>
          )}
          {facultyId && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="review"
                defaultChecked={initial?.requireSeparateReviewer}
              />{" "}
              Отдельный рецензент
            </label>
          )}
        </>
      }
    />
  );
}

export function ReviewerRule({
  id,
  enabled,
}: {
  id: string;
  enabled: boolean;
}) {
  return (
    <OrgForm
      path={"reviewer-rule/" + id}
      label="Сохранить правило"
      input={(form) => ({ requireSeparateReviewer: form.has("required") })}
      fields={
        <label className="flex min-h-11 items-center gap-2">
          <input name="required" type="checkbox" defaultChecked={enabled} />{" "}
          Публикация только после отдельного рецензента
        </label>
      }
    />
  );
}

export function StaffAssignmentForm({
  userId,
  roles,
  scope,
  scopeId,
  subjects = [],
}: {
  userId: string;
  roles: StaffRole[];
  scope: string;
  scopeId: string;
  subjects?: { id: string; title: string }[];
}) {
  const [role, setRole] = useState(roles[0]);
  return (
    <OrgForm
      path="assignments/add"
      label="Назначить"
      input={(form) => {
        const subjectId = String(form.get("subject") ?? "");
        return {
          userId,
          role,
          scope: subjectId ? "subject" : scope,
          scopeId: subjectId || scopeId,
        };
      }}
      fields={
        <>
          <label className="grid gap-1 text-sm">
            Роль{" "}
            <select
              className={field}
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {staffLabels[r]}
                </option>
              ))}
            </select>
          </label>
          {scope === "department" &&
            (role === "AUTHOR" || role === "REVIEWER") &&
            subjects.length > 0 && (
              <label className="grid gap-1 text-sm">
                Область{" "}
                <select name="subject" className={field}>
                  <option value="">Вся кафедра</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
        </>
      }
    />
  );
}

export function RevokeAssignment({
  userId,
  role,
  scope,
  scopeId,
}: {
  userId: string;
  role: StaffRole;
  scope: string;
  scopeId: string;
}) {
  return (
    <OrgForm
      path="assignments/remove"
      label="Снять назначение"
      fields={null}
      input={() => ({ userId, role, scope, scopeId })}
    />
  );
}
