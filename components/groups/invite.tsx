import qrcode from "qrcode-generator";
import { getEnv } from "@/lib/env";
import { GroupButtons } from "./staff-actions";

export function GroupInvite({
  id,
  code,
  expiresAt,
}: {
  id: string;
  code: string | null;
  expiresAt: Date | null;
}) {
  const url =
    code && expiresAt && expiresAt > new Date()
      ? new URL(`/join/${code}`, getEnv().APP_URL).href
      : null;
  const qr = url ? qrcode(0, "M") : null;
  if (qr && url) {
    qr.addData(url);
    qr.make();
  }
  const size = qr?.getModuleCount() ?? 0;
  const modules = [];
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (qr?.isDark(row, column)) modules.push(`M${column} ${row}h1v1h-1z`);
    }
  }
  return (
    <section className="emal-panel space-y-3">
      <h2 className="text-xl font-semibold">Код вступления</h2>
      {url && qr && expiresAt ? (
        <div className="flex flex-wrap items-center gap-4">
          <svg
            className="h-48 w-48 max-w-full"
            role="img"
            aria-label="QR-код приглашения в группу"
            viewBox={`-4 -4 ${size + 8} ${size + 8}`}
            shapeRendering="crispEdges"
          >
            <rect
              x={-4}
              y={-4}
              width={size + 8}
              height={size + 8}
              fill="white"
            />
            <path d={modules.join("")} fill="black" />
          </svg>
          <div className="min-w-0 space-y-2">
            <strong className="block font-mono text-2xl tracking-wider">
              {code}
            </strong>
            <a className="break-all text-sm underline" href={url}>
              {url}
            </a>
            <p className="text-sm">
              Действует до{" "}
              {expiresAt.toLocaleString("ru-RU", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Europe/Moscow",
              })}{" "}
              (МСК).
            </p>
          </div>
        </div>
      ) : (
        <p>{code ? "Срок действия кода истёк." : "Код ещё не создан."}</p>
      )}
      <GroupButtons
        id={id}
        buttons={[
          {
            label: code ? "Сменить код" : "Создать код",
            input: { action: "rotate-code" },
          },
        ]}
      />
    </section>
  );
}
