import {
  requireContentEditor,
  contentJSON,
  contentFailure,
} from "@/lib/content/http";
import { getImport } from "@/lib/imports/service";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireContentEditor(),
      { id } = await params;
    return contentJSON(await getImport(actor.id, id));
  } catch (e) {
    return contentFailure(e);
  }
}
