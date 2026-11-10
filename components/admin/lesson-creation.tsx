"use client";
import { useState, type ReactNode } from "react";
export function LessonCreation({
  manual,
  upload,
}: {
  manual: ReactNode;
  upload: ReactNode;
}) {
  const [mode, setMode] = useState("manual");
  return (
    <>
      <div
        role="tablist"
        aria-label="Способ создания урока"
        className="editor-tabs"
      >
        {[
          ["manual", "Написать урок"],
          ["upload", "Из файла PDF / DOCX"],
        ].map(([key, title]) => (
          <button
            key={key}
            role="tab"
            aria-selected={mode === key}
            tabIndex={mode === key ? 0 : -1}
            aria-controls={`creation-${key}`}
            id={`tab-${key}`}
            className={`px-4 py-3 text-sm font-semibold ${mode === key ? "border-b-2 border-[var(--gum)] text-[var(--gum-ink)]" : "emal-muted"}`}
            onClick={() => setMode(key)}
            onKeyDown={(event) => {
              const keys = ["manual", "upload"];
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "manual"
                  : event.key === "End"
                    ? "upload"
                    : keys[1 - keys.indexOf(key)];
              setMode(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}
          >
            {title}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        aria-labelledby="tab-manual"
        id="creation-manual"
        hidden={mode !== "manual"}
      >
        <div className="emal-panel">{manual}</div>
      </div>
      <div
        role="tabpanel"
        aria-labelledby="tab-upload"
        id="creation-upload"
        hidden={mode !== "upload"}
      >
        {upload}
      </div>
    </>
  );
}
