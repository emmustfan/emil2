export class EditorRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issues: {
      line: number;
      column: number;
      message: string;
      code: string;
    }[] = [],
    public readonly code?: string,
  ) {
    super(message);
  }
}
export async function requestContent<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/admin/content/${path}`, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new EditorRequestError(
      data.error ?? "Не удалось выполнить действие.",
      response.status,
      data.issues ?? [],
      data.code,
    );
  return data as T;
}
export const fieldClass =
  "mt-2 min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 outline-offset-4 focus:outline-emerald-700 disabled:bg-stone-100";
