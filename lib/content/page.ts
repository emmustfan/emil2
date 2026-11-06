import { notFound } from "next/navigation";
import { ContentError } from "./errors";
import { listSchema } from "./validation";
export async function contentPage<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ContentError && e.status === 404) notFound();
    throw e;
  }
}
export function searchState(
  input: Record<string, string | string[] | undefined>,
) {
  const result = listSchema.safeParse({
    q: input.q ?? "",
    page: input.page ?? 1,
  });
  return result.success ? result.data : { q: "", page: 1 };
}
