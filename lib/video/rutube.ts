export const RUTUBE_ORIGIN = "https://rutube.ru";
const videoPath = /^\/(video\/(?:private\/)?|play\/embed\/)([a-f0-9]{32})\/?$/;
const keyPattern = /^[A-Za-z0-9_-]{1,128}$/;
export const rutubeLinkHelp =
  "Вставьте ссылку вида https://rutube.ru/video/private/… или код iframe Rutube.";

export function parseRutube(value: string) {
  const trimmed = value.trim();
  const iframe = /^<iframe\s+([^<>]*)>\s*<\/iframe>$/i.exec(trimmed);
  const attributes = iframe?.[1].matchAll(
    /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)')(?=\s|$)/gi,
  );
  const sources = attributes ? [...attributes] : [];
  if (iframe && sources.length !== 1) return null;
  const raw = iframe
    ? (sources[0][1] ?? sources[0][2]).replaceAll("&amp;", "&")
    : trimmed;
  if (!raw.startsWith(RUTUBE_ORIGIN + "/") || /[\s\\]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    const path = videoPath.exec(url.pathname);
    if (
      url.origin !== RUTUBE_ORIGIN ||
      !path ||
      raw.split(/[?#]/, 1)[0] !== RUTUBE_ORIGIN + url.pathname
    )
      return null;
    const keys = url.searchParams.getAll("p");
    const accessKey = keys[0] ?? null;
    if (
      keys.length > 1 ||
      (accessKey !== null && !keyPattern.test(accessKey)) ||
      (path[1] === "video/private/" && !accessKey)
    )
      return null;
    return { externalId: path[2], accessKey };
  } catch {
    return null;
  }
}

export function rutubeEmbed(video: {
  externalId: string;
  accessKey: string | null;
}) {
  const url = new URL(`/play/embed/${video.externalId}/`, RUTUBE_ORIGIN);
  if (video.accessKey) url.searchParams.set("p", video.accessKey);
  return url.href;
}

export function parseVideoTime(value: string) {
  if (!/^(?:\d{1,2}:)?\d{1,4}:\d{2}$/.test(value.trim())) return null;
  const parts = value.trim().split(":").map(Number);
  const seconds = parts.at(-1)!;
  const minutes = parts.at(-2)!;
  const hours = parts.length === 3 ? parts[0] : 0;
  const total = hours * 3600 + minutes * 60 + seconds;
  return seconds < 60 && (parts.length === 2 || minutes < 60) && total <= 86400
    ? total
    : null;
}

export function videoTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export const VIDEO_ID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const videoMarker = new RegExp(`^::video\\{#(${VIDEO_ID})\\}$`);
