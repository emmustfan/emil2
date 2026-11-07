export function dayWindow(now: Date, timeZone: string) {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      calendar: "iso8601",
      numberingSystem: "latn",
    });
  } catch {
    timeZone = "Europe/Moscow";
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  const key = (date: Date) => {
    const p = Object.fromEntries(
      format.formatToParts(date).map((p) => [p.type, p.value]),
    );
    return `${p.year}-${p.month}-${p.day}`;
  };
  const today = key(now),
    next = new Date(today + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const tomorrow = next.toISOString().slice(0, 10);
  const boundary = (target: string) => {
    let left = now.getTime() - 48 * 3600000,
      right = now.getTime() + 48 * 3600000;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if (key(new Date(middle)) < target) left = middle + 1;
      else right = middle;
    }
    return new Date(left);
  };
  return { start: boundary(today), end: boundary(tomorrow), timeZone };
}
