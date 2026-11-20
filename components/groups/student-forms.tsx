"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { fieldClass, GroupFeedback, useGroupAction } from "./action";

export function JoinGroupForm({
  code,
  student,
  notice,
}: {
  code: string;
  student: {
    firstName: string | null;
    lastName: string | null;
    middleName: string | null;
    studentNumber: string | null;
  };
  notice: { contentMd: string; version: string };
}) {
  const router = useRouter();
  const { submit, ...state } = useGroupAction();
  return (
    <form
      className="emal-panel space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = Object.fromEntries(new FormData(form));
        const result = await submit(
          "join",
          {
            ...values,
            accepted: values.accepted === "on",
            noticeVersion: notice.version,
          },
          "Заявка отправлена.",
        );
        if (result) {
          form.reset();
          router.replace("/cabinet/groups");
          router.refresh();
        }
      }}
    >
      <h2 className="text-xl font-semibold">Вступить в группу</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium">
          Код группы
          <input
            className={fieldClass}
            name="code"
            defaultValue={code}
            required
            minLength={8}
            maxLength={8}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Фамилия
          <input
            className={fieldClass}
            name="lastName"
            defaultValue={student.lastName ?? ""}
            autoComplete="family-name"
            required
            maxLength={100}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Имя
          <input
            className={fieldClass}
            name="firstName"
            defaultValue={student.firstName ?? ""}
            autoComplete="given-name"
            required
            maxLength={100}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Отчество
          <input
            className={fieldClass}
            name="middleName"
            defaultValue={student.middleName ?? ""}
            autoComplete="additional-name"
            maxLength={100}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Номер зачётной книжки
          <input
            className={fieldClass}
            name="studentNumber"
            defaultValue={student.studentNumber ?? ""}
            maxLength={80}
          />
        </label>
      </div>
      <div className="space-y-3 rounded-xl bg-emerald-50 p-4 text-sm leading-6">
        <Link className="font-semibold underline" href="/legal/group-notice">
          Что видит преподаватель
        </Link>
        <p className="whitespace-pre-wrap">{notice.contentMd}</p>
        <label className="flex items-start gap-2">
          <input className="mt-1.5" type="checkbox" name="accepted" required />Я
          прочитал(а) и принимаю уведомление
        </label>
      </div>
      <button className="lesson-primary" disabled={state.busy}>
        Вступить
      </button>
      {state.failed && <GroupFeedback {...state} />}
    </form>
  );
}

export function LeaveGroup({ id, pending }: { id: string; pending: boolean }) {
  const router = useRouter();
  const { submit, ...state } = useGroupAction();
  return (
    <div>
      <button
        className="emal-button emal-button-outline"
        disabled={state.busy}
        onClick={async () => {
          if (await submit(`leave/${id}`, {})) router.refresh();
        }}
      >
        {pending ? "Отозвать заявку" : "Выйти из группы"}
      </button>
      {state.failed && <GroupFeedback {...state} />}
    </div>
  );
}
