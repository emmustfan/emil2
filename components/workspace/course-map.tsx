"use client";
import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
type Topic = {
  id: string;
  title: string;
  subject: string;
  href: string;
  free: boolean;
  completed?: boolean;
  started?: boolean;
};
const fdi = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46,
  45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
];
export function CourseMap({ topics }: { topics: Topic[] }) {
  const [selected, setSelected] = useState(0),
    topic = topics[selected];
  return (
    <section className="course-map" aria-label="Карта тем курса">
      <div className="course-map-head">
        <h2>Зубная формула курса</h2>
        <span>
          {topics.length
            ? `${topics.length} тем в навигации`
            : "Темы появятся после публикации"}
        </span>
      </div>
      <div className="teeth-scroll">
        <div className="teeth-grid">
          {fdi.map((n, i) => {
            const t = topics[i];
            return t ? (
              <button
                key={n}
                className={`course-tooth ${t.completed ? "is-done" : t.started ? "is-started" : t.free ? "is-free" : "is-locked"}`}
                aria-label={`Тема ${i + 1}: ${t.title}`}
                aria-pressed={selected === i}
                onClick={() => setSelected(i)}
                title={t.title}
              >
                <small>{n}</small>
                {t.completed && <Check size={15} />}
              </button>
            ) : (
              <span key={n} className="course-tooth is-empty" aria-hidden>
                <small>{n}</small>
              </span>
            );
          })}
        </div>
      </div>
      <p className="teeth-hint">
        Листайте карту в сторону, чтобы выбрать тему →
      </p>
      <div className="course-map-legend">
        <span>
          <i className="done" />
          Пройдена
        </span>
        <span>
          <i />
          Тема курса
        </span>
        <span>
          <i className="free" />
          Бесплатная
        </span>
      </div>
      <div className="course-map-detail">
        {topic ? (
          <>
            <span>
              {topic.subject} · {topic.title}
            </span>
            <Link href={topic.href}>Открыть урок →</Link>
          </>
        ) : (
          <span className="emal-muted">
            Сейчас материалы проходят подготовку и экспертную проверку.
          </span>
        )}
      </div>
    </section>
  );
}
