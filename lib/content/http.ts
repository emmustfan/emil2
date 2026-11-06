import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentSession } from "../auth/server";
import { hasCurrentConsent } from "../auth/legal";
import { AuthError } from "../auth/errors";
import { authFailure } from "../auth/http";
import { ContentError } from "./errors";
export async function requireContentEditor() {
  const session = await getCurrentSession();
  if (!session) throw new AuthError("unauthorized", 401);
  if (
    !["EDITOR", "ADMIN"].includes(session.user.role) ||
    !(await hasCurrentConsent(session.user))
  )
    throw new AuthError("forbidden", 403);
  return session.user;
}
export function contentJSON(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function contentFailure(error: unknown) {
  if (error instanceof AuthError) return authFailure(error);
  if (error instanceof ContentError)
    return contentJSON(
      { error: error.message, issues: error.issues, code: error.code },
      error.status,
    );
  if (error instanceof ZodError)
    return contentJSON(
      {
        error: "Проверьте заполненные поля.",
        fields: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      422,
    );
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "P2002")
      return contentJSON(
        { error: "Такой slug или ключ уже используется." },
        409,
      );
    if (error.code === "P2003")
      return contentJSON(
        {
          error:
            "Материал используется в других записях. Удаление отменено; сначала уберите зависимости.",
        },
        409,
      );
    if (error.code === "P2025")
      return contentJSON({ error: "Материал не найден." }, 404);
  }
  console.error("content_operation_failed");
  return contentJSON(
    { error: "Не удалось выполнить действие. Попробуйте ещё раз." },
    503,
  );
}
