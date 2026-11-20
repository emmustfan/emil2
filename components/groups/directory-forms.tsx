"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fieldClass, GroupFeedback, useGroupAction } from "./action";

type Faculty = { id: string; title: string };
type Report = {
  created: number;
  duplicates: number;
  errors: { line: number; message: string }[];
};

function FacultyField({ faculties }: { faculties: Faculty[] }) {
  return (
    <label className="block space-y-1 text-sm font-medium">
      Факультет
      <select className={fieldClass} name="facultyId" required>
        {faculties.map((faculty) => (
          <option key={faculty.id} value={faculty.id}>
            {faculty.title}
          </option>
        ))}
      </select>
    </label>
  );
}

export function GroupCreateForm({
  faculties,
  year,
}: {
  faculties: Faculty[];
  year: string;
}) {
  const router = useRouter();
  const { submit, ...state } = useGroupAction();
  return (
    <form
      className="emal-panel space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const input = new FormData(event.currentTarget);
        const result = await submit<{ id: string }>("create", {
          facultyId: input.get("facultyId"),
          name: input.get("name"),
          course: input.get("course"),
          academicYear: input.get("academicYear"),
          requireApproval: input.has("requireApproval"),
        });
        if (result) router.push(`/teacher/groups/${result.id}`);
      }}
    >
      <h2 className="text-xl font-semibold">Создать группу</h2>
      <FacultyField faculties={faculties} />
      <label className="block space-y-1 text-sm font-medium">
        Название группы
        <input
          className={fieldClass}
          name="name"
          required
          maxLength={80}
          placeholder="101"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-sm font-medium">
          Курс
          <input
            className={fieldClass}
            name="course"
            required
            type="number"
            min={1}
            max={6}
            defaultValue={1}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Учебный год
          <input
            className={fieldClass}
            name="academicYear"
            required
            maxLength={9}
            pattern="[0-9]{4}/[0-9]{4}"
            defaultValue={year}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input name="requireApproval" type="checkbox" defaultChecked />
        Требовать одобрение заявок
      </label>
      <button className="lesson-primary" disabled={state.busy}>
        Создать группу
      </button>
      <GroupFeedback {...state} />
    </form>
  );
}

export function GroupImportForm({ faculties }: { faculties: Faculty[] }) {
  const router = useRouter();
  const { submit, ...state } = useGroupAction();
  const [report, setReport] = useState<Report | null>(null);
  const [fileError, setFileError] = useState("");
  return (
    <form
      className="emal-panel space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const input = new FormData(event.currentTarget);
        const file = input.get("file");
        setFileError("");
        setReport(null);
        if (!(file instanceof File)) return;
        if (file.size > 256 * 1024) {
          setFileError("Размер CSV-файла должен быть не более 256 КБ.");
          return;
        }
        let csv: string;
        try {
          csv = new TextDecoder("utf-8", { fatal: true }).decode(
            await file.arrayBuffer(),
          );
        } catch {
          setFileError("Сохраните CSV-файл в кодировке UTF-8.");
          return;
        }
        const result = await submit<Report>(
          "import",
          { facultyId: input.get("facultyId"), csv },
          "",
        );
        if (result) {
          setReport(result);
          router.refresh();
        }
      }}
    >
      <h2 className="text-xl font-semibold">Загрузить группы из CSV</h2>
      <FacultyField faculties={faculties} />
      <p className="text-sm">
        UTF-8, заголовок <code>name;course;academicYear</code>. Разделитель —
        точка с запятой или запятая.
      </p>
      <label className="block space-y-1 text-sm font-medium">
        Файл CSV
        <input
          className="block max-w-full"
          name="file"
          type="file"
          required
          accept=".csv,text/csv"
        />
      </label>
      <button className="lesson-primary" disabled={state.busy}>
        Загрузить CSV
      </button>
      <GroupFeedback
        message={fileError || state.message}
        failed={!!fileError || state.failed}
      />
      {report && (
        <div role="status" className="space-y-2 text-sm">
          <p>
            Создано: {report.created}. Дубликатов: {report.duplicates}. Ошибок:{" "}
            {report.errors.length}.
          </p>
          {report.errors.length > 0 && (
            <ul className="max-h-52 list-disc space-y-1 overflow-auto pl-5">
              {report.errors.map(({ line, message }) => (
                <li key={line}>
                  Строка {line}. {message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
