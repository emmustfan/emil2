import { assertOrigin } from "@/lib/auth/http";
import { getCurrentSession } from "@/lib/auth/server";
import { contentFailure } from "@/lib/content/http";
import { exportJournal } from "@/lib/progress/export";
import { journalFilters } from "@/lib/progress/journal";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ groupId: string; subjectId: string }> },
) {
  try {
    assertOrigin(request);
    const session = await getCurrentSession();
    const actor = session && {
      id: session.user.id,
      readOnly: session.readOnly,
    };
    const text = await exportJournal(
      actor,
      await params,
      journalFilters(Object.fromEntries(new URL(request.url).searchParams)),
    );
    return new Response(text, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="progress.csv"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return contentFailure(error);
  }
}
