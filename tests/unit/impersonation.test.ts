import { it, expect, vi } from "vitest";
import { metrikaGoal } from "../../components/landing/consent";
import {
  canImpersonate,
  impersonationInput,
  shouldAuditBlockedWrite,
  isImpersonationWrite,
  type ImpersonationUser,
} from "../../lib/auth/impersonation-policy";
import { actorIdentity, assertWritableActor } from "../../lib/lessons/identity";
import { decodeSetting } from "../../lib/settings/defaults";
const admin: ImpersonationUser = {
  id: "admin",
  role: "ADMIN",
  blockedAt: null,
  deletedAt: null,
  anonymizedAt: null,
  email: "admin@example.test",
  emailVerifiedAt: new Date(),
  telegramId: null,
};
const target: ImpersonationUser = { ...admin, id: "student", role: "USER" };
it("allows a verified administrator to view users and editors, including blocked targets", () => {
  expect(canImpersonate(admin, target)).toBe(true);
  expect(
    canImpersonate(admin, { ...target, role: "EDITOR", blockedAt: new Date() }),
  ).toBe(true);
  expect(
    canImpersonate(
      { ...admin, email: null, emailVerifiedAt: null, telegramId: 123n },
      target,
    ),
  ).toBe(true);
});
it("rejects unverified or inactive administrators, staff/student callers, self, admins and deleted/anonymized targets", () => {
  for (const change of [
    { role: "USER" as const },
    { role: "EDITOR" as const },
    { blockedAt: new Date() },
    { deletedAt: new Date() },
    { anonymizedAt: new Date() },
    { emailVerifiedAt: null },
  ])
    expect(canImpersonate({ ...admin, ...change }, target)).toBe(false);
  for (const change of [
    { role: "ADMIN" as const },
    { id: admin.id },
    { deletedAt: new Date() },
    { anonymizedAt: new Date() },
  ])
    expect(canImpersonate(admin, { ...target, ...change })).toBe(false);
});
it("requires a trimmed 5–500 character reason and bounds the database-configured lifetime", () => {
  expect(
    impersonationInput.parse({
      targetUserId: "user",
      reason: "  Проверка жалобы  ",
    }).reason,
  ).toBe("Проверка жалобы");
  for (const reason of [undefined, "", "    ", "1234", "x".repeat(501)])
    expect(
      impersonationInput.safeParse({ targetUserId: "user", reason }).success,
    ).toBe(false);
  expect(decodeSetting("admin.impersonationMinutes", 15)).toBe(15);
  expect(decodeSetting("admin.impersonationHistoryLimit", 10)).toBe(10);
  expect(decodeSetting("admin.impersonationHistoryLimit", 101)).toBe(50);
  for (const value of [0, -1, 0.5, 1441, "30"])
    expect(decodeSetting("admin.impersonationMinutes", value)).toBe(30);
});
it("audits a blocked path at most once per minute including the exact boundary", () => {
  const now = new Date("2026-11-15T00:00:00Z");
  expect(shouldAuditBlockedWrite(null, now)).toBe(true);
  expect(shouldAuditBlockedWrite(new Date(+now - 59999), now)).toBe(false);
  expect(shouldAuditBlockedWrite(new Date(+now - 60000), now)).toBe(true);
  expect(shouldAuditBlockedWrite(new Date(+now + 1), now)).toBe(false);
});
it("permits only safe methods and the exact POST stop route during viewing", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"])
    expect(isImpersonationWrite(method, "/api/profile")).toBe(false);
  for (const method of ["POST", "PATCH", "PUT", "DELETE"])
    expect(isImpersonationWrite(method, "/api/profile")).toBe(true);
  expect(isImpersonationWrite("POST", "/api/admin/impersonation/stop")).toBe(
    false,
  );
  expect(isImpersonationWrite("DELETE", "/api/admin/impersonation/stop")).toBe(
    true,
  );
  expect(isImpersonationWrite("POST", "/api/admin/impersonation")).toBe(true);
});
it("keeps readOnly out of database actor identities and rejects learning writes", () => {
  expect(actorIdentity({ userId: "student", readOnly: true })).toEqual({
    userId: "student",
  });
  expect(actorIdentity({ demoSessionId: "guest", readOnly: true })).toEqual({
    demoSessionId: "guest",
  });
  expect(() =>
    assertWritableActor({ userId: "student", readOnly: true }),
  ).toThrow("Режим просмотра");
  expect(() => assertWritableActor({ userId: "student" })).not.toThrow();
});

it("suppresses both queued and direct analytics goals while viewing, preserving ordinary analytics outside the mode", () => {
  const queue = vi.fn(),
    ym = vi.fn();
  vi.stubGlobal("document", { body: { dataset: { impersonation: "true" } } });
  vi.stubGlobal("window", { ym });
  vi.stubGlobal("localStorage", { getItem: () => "yes" });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: queue });
  try {
    metrikaGoal("payment_succeeded");
    expect(queue).not.toHaveBeenCalled();
    window.dentalMetrikaId = 123;
    metrikaGoal("payment_succeeded");
    expect(ym).not.toHaveBeenCalled();
    delete document.body.dataset.impersonation;
    metrikaGoal("payment_succeeded");
    expect(ym).toHaveBeenCalledExactlyOnceWith(
      123,
      "reachGoal",
      "payment_succeeded",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
