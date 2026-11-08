import { getCurrentSession } from "@/lib/auth/server";
import { readTopicImage } from "@/lib/content/images";
import { contentFailure } from "@/lib/content/http";
import { z } from "zod";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    z.uuid().parse(id);
    const session = await getCurrentSession(),
      image = await readTopicImage(id, session?.userId ?? null);
    return new Response(new Uint8Array(image.body), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(image.body.length),
        "Content-Disposition": 'inline; filename="lesson-image.webp"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (e) {
    return contentFailure(e);
  }
}
