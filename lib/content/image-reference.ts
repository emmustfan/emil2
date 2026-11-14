export const imageSourcePattern =
  /^\/api\/content-images\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
export function imageId(source?: string) {
  return source?.match(imageSourcePattern)?.[1] ?? null;
}
export function imageMarkdown(
  id: string,
  description: string,
  width?: number,
  height?: number,
) {
  const source = `/api/content-images/${id}`;
  if (!imageId(source)) throw new Error("Некорректное изображение.");
  const alt = description.trim().replace(/\s+/g, " ");
  if (!alt || alt.length > 300)
    throw new Error("Добавьте описание изображения до 300 символов.");
  const size =
    width && height && Number.isInteger(width) && Number.isInteger(height)
      ? ` "${width}x${height}"`
      : "";
  return `![${alt.replace(/[\\[\]]/g, "\\$&")}](${source}${size})`;
}
