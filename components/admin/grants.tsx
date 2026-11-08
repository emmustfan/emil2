"use client";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useAdminSave } from "./save";
export function GrantForm({
  userId,
  subjects,
  defaultDays,
  maxDays,
}: {
  userId: string;
  subjects: { id: string; title: string }[];
  defaultDays: number;
  maxDays: number;
}) {
  const router = useRouter(),
    requestId = useRef<string | null>(null),
    { save, busy, message, failed } = useAdminSave();
  return (
    <form
      className="mt-4 space-y-4 rounded-xl border bg-white p-5"
      onChange={() => {
        requestId.current = null;
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        requestId.current ??= crypto.randomUUID();
        const r = await save(`grants/${userId}`, {
          requestId: requestId.current,
          subjectId: f.get("subject") || null,
          days: Number(f.get("days")),
          reason: f.get("reason"),
        });
        if (r) router.refresh();
      }}
    >
      <label className="block text-sm">
        Область доступа
        <select
          name="subject"
          className="mt-1 block min-h-11 w-full rounded-lg border bg-white p-3"
        >
          <option value="">Все предметы</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Дней доступа
        <input
          name="days"
          type="number"
          min={1}
          max={maxDays}
          defaultValue={Math.min(defaultDays, maxDays)}
          required
          className="mt-1 block min-h-11 w-full rounded-lg border p-3"
        />
      </label>
      <label className="block text-sm">
        Причина выдачи
        <input
          name="reason"
          minLength={3}
          maxLength={500}
          required
          className="mt-1 block min-h-11 w-full rounded-lg border p-3"
        />
      </label>
      <p className="text-xs leading-6">
        Ручной доступ не создаёт подписку и не запускает списания.
      </p>
      {message && <p role={failed ? "alert" : "status"}>{message}</p>}
      <button className="lesson-primary" disabled={busy}>
        Выдать доступ
      </button>
    </form>
  );
}
export function RevokeGrant({ id, userId }: { id: string; userId: string }) {
  const router = useRouter(),
    { save, busy, message, failed } = useAdminSave(),
    confirm = useRef(false);
  return (
    <div>
      {message && <p role={failed ? "alert" : "status"}>{message}</p>}
      <button
        className="min-h-11 text-sm underline"
        disabled={busy}
        onClick={async (e) => {
          if (!confirm.current) {
            confirm.current = true;
            e.currentTarget.textContent = "Подтвердить отзыв доступа";
            return;
          }
          if (await save(`grants/${userId}/${id}`, { confirm: true }))
            router.refresh();
        }}
      >
        Отозвать ручной доступ
      </button>
    </div>
  );
}
