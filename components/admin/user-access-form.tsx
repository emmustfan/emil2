"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ManagedUser } from "@/lib/admin/users";
import type { AppRole } from "@/lib/auth/roles";
import { auditAccess } from "@/lib/admin/audit";
import { rolesRu as t } from "@/lib/i18n/ru";
const roles: AppRole[] = ["USER", "EDITOR", "ADMIN"];
export function UserAccessForm({
  initial,
  actorId,
  timeZone,
}: {
  initial: ManagedUser;
  actorId: string;
  timeZone: string;
}) {
  const [data, setData] = useState(initial),
    [role, setRole] = useState<AppRole>(initial.user.role),
    [blocked, setBlocked] = useState(!!initial.user.blockedAt),
    [subjectIds, setSubjectIds] = useState(
      initial.assignments.map((a) => a.subjectId),
    ),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const running = useRef(false),
    router = useRouter(),
    user = data.user,
    self = actorId === user.id,
    protectedUser = user.owner || self,
    verified = !!user.emailVerifiedAt || !!user.telegramId;
  function accept(value: ManagedUser) {
    setData(value);
    setRole(value.user.role);
    setBlocked(!!value.user.blockedAt);
    setSubjectIds(value.assignments.map((a) => a.subjectId));
  }
  async function request(method: "GET" | "PATCH") {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await fetch(
        `/api/admin/users/${user.id}`,
        method === "GET"
          ? { cache: "no-store" }
          : {
              method,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                revision: user.roleRevision,
                role,
                blocked,
                subjectIds: role === "EDITOR" ? subjectIds : [],
              }),
            },
      );
      const value = await result.json();
      if (!result.ok) throw new Error(value.error ?? t.failure);
      accept(value);
      if (method === "PATCH") setMessage(t.saved);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.failure);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <section className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="font-semibold">{t.account}</h2>
        <dl className="mt-4 space-y-3 text-sm leading-7">
          <div>
            <dt className="text-xs text-stone-500">{t.email}</dt>
            <dd className="break-all">{user.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">{t.telegram}</dt>
            <dd className="break-all">
              {user.telegramUsername
                ? `@${user.telegramUsername}`
                : (user.telegramId ?? "—")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">{t.created}</dt>
            <dd>
              {new Intl.DateTimeFormat("ru-RU", {
                dateStyle: "long",
                timeZone,
              }).format(new Date(user.createdAt))}
            </dd>
          </div>
        </dl>
        <p
          className={`mt-4 text-xs leading-6 ${verified ? "text-emerald-800" : "text-amber-900"}`}
        >
          {verified ? t.verified : t.unverified}
        </p>
      </section>
      <form
        className="mt-6 rounded-xl border border-stone-200 bg-white p-5 sm:p-7"
        onSubmit={(e) => {
          e.preventDefault();
          void request("PATCH");
        }}
      >
        <h2 className="text-xl font-semibold">{t.accessTitle}</h2>
        {user.owner && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-7 text-amber-950">
            {t.ownerHint}
          </p>
        )}
        {self && (
          <p className="mt-3 text-xs leading-7 text-stone-600">{t.selfHint}</p>
        )}
        <label className="mt-5 block text-sm font-medium">
          {t.role}
          <select
            value={role}
            onChange={(e) => {
              const next = e.target.value as AppRole;
              setRole(next);
              if (next !== "EDITOR") setSubjectIds([]);
            }}
            disabled={busy || protectedUser}
            className="mt-2 block min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 disabled:bg-stone-50"
          >
            {roles.map((r) => (
              <option
                key={r}
                value={r}
                disabled={r !== "USER" && r !== user.role && !verified}
              >
                {t.roles[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-5 flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={blocked}
            onChange={(e) => setBlocked(e.target.checked)}
            disabled={busy || protectedUser}
            className="size-4 accent-emerald-800"
          />
          {t.blockedLabel}
        </label>
        <p className="text-xs leading-7 text-stone-500">{t.blockHint}</p>
        {initial.user.role === "EDITOR" && role !== "EDITOR" && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm leading-7 text-amber-950">
            {t.noMoreTeacherAccess}
          </p>
        )}
        {role === "EDITOR" && (
          <fieldset disabled={busy} className="mt-6">
            <legend className="mb-3 font-semibold">{t.subjects}</legend>
            <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-stone-200 p-3">
              {data.subjects.map((s) => (
                <label
                  key={s.id}
                  className="flex min-h-11 items-start gap-3 rounded p-2 text-sm leading-7"
                >
                  <input
                    type="checkbox"
                    className="mt-1.5 size-4 shrink-0 accent-emerald-800"
                    checked={subjectIds.includes(s.id)}
                    onChange={(e) =>
                      setSubjectIds((old) =>
                        e.target.checked
                          ? [...old, s.id]
                          : old.filter((id) => id !== s.id),
                      )
                    }
                  />
                  <span className="min-w-0 break-words">{s.title}</span>
                </label>
              ))}
              {!data.subjects.length && (
                <p className="text-sm text-stone-500">{t.noSubjects}</p>
              )}
            </div>
          </fieldset>
        )}
        {error && (
          <div
            role="alert"
            className="mt-5 rounded-lg border border-red-300 bg-red-50 p-4 text-sm leading-7 text-red-900"
          >
            <p>{error}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void request("GET")}
              className="mt-2 min-h-11 underline"
            >
              {t.reload}
            </button>
          </div>
        )}
        {message && (
          <p role="status" className="mt-5 text-sm text-emerald-800">
            {message}
          </p>
        )}
        <button
          className="lesson-primary mt-6"
          disabled={
            busy || (role !== "USER" && role !== user.role && !verified)
          }
        >
          {busy ? t.saving : t.save}
        </button>
      </form>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">{t.auditTitle}</h2>
        {data.audit.length ? (
          <ol className="mt-4 space-y-3">
            {data.audit.map((event) => {
              const change = auditAccess.safeParse(event.changes),
                names = (ids: string[]) =>
                  ids
                    .map(
                      (id) =>
                        data.subjects.find((s) => s.id === id)?.title ??
                        "Предмет недоступен",
                    )
                    .join(", ") || "—";
              return (
                <li
                  key={event.id}
                  className="rounded-xl border border-stone-200 bg-white p-4 text-xs leading-7 break-words"
                >
                  <p className="text-stone-500">
                    {new Intl.DateTimeFormat("ru-RU", {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone,
                    }).format(new Date(event.createdAt))}{" "}
                    · {event.actor?.name || t.auditActorUnknown}
                  </p>
                  {change.success ? (
                    <div className="mt-2">
                      <p>
                        {t.role}: {t.roles[change.data.before.role]} →{" "}
                        {t.roles[change.data.after.role]}
                      </p>
                      <p>
                        {t.status}:{" "}
                        {change.data.before.blocked ? t.blocked : t.active} →{" "}
                        {change.data.after.blocked ? t.blocked : t.active}
                      </p>
                      {JSON.stringify(change.data.before.subjectIds) !==
                        JSON.stringify(change.data.after.subjectIds) && (
                        <p>
                          {t.subjects}: {names(change.data.before.subjectIds)} →{" "}
                          {names(change.data.after.subjectIds)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p>{t.auditAction}</p>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-3 text-sm leading-7 text-stone-500">
            {t.auditEmpty}
          </p>
        )}
      </section>
    </>
  );
}
