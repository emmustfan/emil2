"use client";

import { useRouter } from "next/navigation";
import { fieldClass, GroupFeedback, useGroupAction } from "./action";

export function GroupButtons({
  id,
  buttons,
}: {
  id: string;
  buttons: {
    label: string;
    input: Record<string, unknown>;
    confirmText?: string;
  }[];
}) {
  const router = useRouter();
  const { submit, ...state } = useGroupAction();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {buttons.map(({ label, input, confirmText }) => (
          <button
            key={label}
            className="emal-button emal-button-outline"
            disabled={state.busy}
            onClick={async () => {
              if (confirmText && !window.confirm(confirmText)) return;
              if (await submit(`manage/${id}`, input)) router.refresh();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {state.message && <GroupFeedback {...state} />}
    </div>
  );
}

export function GroupSelectAction({
  id,
  action,
  subjectId,
  options,
  label,
  button,
}: {
  id: string;
  action: "open-subject" | "assign-teacher";
  options: { id: string; title: string }[];
  label: string;
  button: string;
} & (
  | { action: "open-subject"; subjectId?: never }
  | { action: "assign-teacher"; subjectId: string }
)) {
  const router = useRouter();
  const { submit, ...state } = useGroupAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const selected = new FormData(event.currentTarget).get("selected");
        if (typeof selected !== "string") return;
        const input =
          action === "open-subject"
            ? { action, subjectId: selected }
            : { action, subjectId, teacherId: selected };
        if (await submit(`manage/${id}`, input)) router.refresh();
      }}
    >
      <label className="min-w-48 flex-1 space-y-1 text-sm font-medium">
        {label}
        <select className={fieldClass} name="selected">
          {options.map(({ id, title }) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
      <button className="lesson-primary" disabled={state.busy}>
        {button}
      </button>
      {state.message && <GroupFeedback {...state} />}
    </form>
  );
}
