"use client";
import { useState, useEffect, useRef } from "react";
import { imageMarkdown } from "@/lib/content/image-reference";
import { fieldClass } from "./helpers";
export function ImageUpload({
  topicId,
  maxBytes,
  busy,
  onInsert,
  open,
  onOpenChange,
}: {
  topicId: string;
  maxBytes: number;
  busy: boolean;
  onInsert: (markdown: string, id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false),
    [alt, setAlt] = useState(""),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open) dialog.current?.close();
  }, [open]);
  return (
    <div className="rich-image-upload">
      <button
        type="button"
        disabled={busy}
        className="lesson-secondary"
        onClick={() => onOpenChange(true)}
      >
        Добавить изображение
      </button>
      <dialog
        ref={dialog}
        className="rich-gap-dialog"
        aria-label="Изображение в уроке"
        onCancel={(e) => {
          e.preventDefault();
          if (!uploading) onOpenChange(false);
        }}
      >
        <div className="rich-dialog-heading">
          <h2>Изображение в уроке</h2>
          <button
            type="button"
            aria-label="Закрыть загрузку изображения"
            disabled={uploading}
            onClick={() => onOpenChange(false)}
          >
            ✕
          </button>
        </div>
        <form
          className="mt-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (uploading) return;
            const form = e.currentTarget,
              data = new FormData(form),
              file = data.get("file");
            if (!(file instanceof File) || !file.size || file.size > maxBytes) {
              setError("Выберите изображение в пределах указанного размера.");
              return;
            }
            setUploading(true);
            setError("");
            try {
              const r = await fetch(
                  `/api/admin/content/topics/${topicId}/images`,
                  { method: "POST", body: data },
                ),
                result = await r.json();
              if (!r.ok) throw new Error(result.error);
              onInsert(
                imageMarkdown(result.id, alt, result.width, result.height),
                result.id,
              );
              form.reset();
              setAlt("");
              onOpenChange(false);
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Не удалось загрузить изображение.",
              );
            } finally {
              setUploading(false);
            }
          }}
        >
          <p className="text-sm leading-7 text-stone-600">
            PNG, JPEG или WebP, до{" "}
            {Math.round((maxBytes / 1024 / 1024) * 10) / 10} МБ. Картинка
            вставится в позицию курсора в методичке. Используйте учебные
            изображения без персональных данных.
          </p>
          <label className="block text-sm">
            Файл изображения
            <input
              type="file"
              name="file"
              accept="image/png,image/jpeg,image/webp"
              required
              disabled={uploading || busy}
              className={fieldClass}
            />
          </label>
          <label className="block text-sm">
            Описание под изображением
            <input
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              required
              maxLength={300}
              disabled={uploading || busy}
              className={fieldClass}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-800">
              {error}
            </p>
          )}
          <button
            disabled={uploading || busy || !alt.trim()}
            className="lesson-primary"
          >
            {uploading ? "Загружаем…" : "Загрузить и вставить"}
          </button>
        </form>
      </dialog>
    </div>
  );
}
