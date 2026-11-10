import Link from "next/link";
export function Brand({ name = "Эмаль" }: { name?: string }) {
  const title = ["Учебная платформа", "Рабочее название"].includes(name)
    ? "Эмаль"
    : name;
  return (
    <Link href="/" className="emal-brand" aria-label={`${title} — на главную`}>
      <svg viewBox="0 0 32 32" width="27" height="31" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 3c-5 0-5 6-3 11l3 12c1 4 4 4 5-1l2-8c.3-1.6 1.7-1.6 2 0l2 8c1 5 4 5 5 1l3-12c2-5 2-11-3-11-3 0-5 2-8 2S11 3 8 3Z"
        />
      </svg>
      <span>{title}</span>
    </Link>
  );
}
