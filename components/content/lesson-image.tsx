"use client";
import Image from "next/image";
import { imageId } from "@/lib/content/image-reference";
export function LessonImage({
  src,
  alt,
  title,
}: {
  src?: string;
  alt?: string;
  title?: string;
}) {
  if (!imageId(src)) return null;
  const size = title?.match(/^(\d{1,4})x(\d{1,4})$/),
    width = Math.max(1, Math.min(4096, Number(size?.[1] ?? 1200))),
    height = Math.max(1, Math.min(4096, Number(size?.[2] ?? 800)));
  return (
    <span className="my-5 block">
      <Image
        src={src!}
        alt={alt ?? ""}
        width={width}
        height={height}
        unoptimized
        loading="lazy"
        className="h-auto max-w-full rounded-xl border border-stone-200"
      />
      <span className="mt-2 block text-sm leading-6 text-stone-600">{alt}</span>
    </span>
  );
}
