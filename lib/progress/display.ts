export function percent(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

export function dateTime(value: Date | null, timeZone = "Europe/Moscow") {
  return (
    value?.toLocaleString("ru-RU", {
      timeZone,
      dateStyle: "short",
      timeStyle: "short",
    }) ?? "—"
  );
}
