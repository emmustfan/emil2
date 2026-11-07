"use client";
import { useState } from "react";
import { TutorPanel } from "./panel";
import { tutorRu as t } from "@/lib/i18n/ru";
export function TutorWorkspace({
  subjects,
  mock,
  selected,
}: {
  subjects: { id: string; title: string }[];
  mock: boolean;
  selected?: string;
}) {
  const [subjectId, setSubjectId] = useState(
    subjects.some((s) => s.id === selected)
      ? selected!
      : (subjects[0]?.id ?? ""),
  );
  return (
    <div className="mx-auto max-w-3xl">
      {subjects.length ? (
        <>
          <label className="block text-sm font-medium">
            {t.subject}
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="mt-2 block min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <TutorPanel key={subjectId} subjectId={subjectId} mock={mock} />
        </>
      ) : (
        <p className="rounded-xl bg-emerald-50 p-5 leading-8">{t.noSubjects}</p>
      )}
    </div>
  );
}
