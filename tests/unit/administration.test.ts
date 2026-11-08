import { describe, it, expect } from "vitest";
import {
  validSetting,
  grantInput,
  legalInput,
  planInput,
  reportRange,
  reportInput,
  conversion,
  deletionError,
} from "../../lib/admin/policy";
import { renewalInput } from "../../lib/billing/manage";
describe("administration policy", () => {
  it("accepts bounded configuration and refuses unsafe billing timers and ambiguous retries", () => {
    expect(validSetting("billing.renewalLeadHours", 24)).toBe(true);
    expect(validSetting("billing.renewalLeadHours", 25)).toBe(false);
    expect(validSetting("billing.retryHours", [24, 72])).toBe(true);
    for (const value of [[72, 24], [24], [-1, 72], [24, 24]])
      expect(validSetting("billing.retryHours", value)).toBe(false);
    expect(validSetting("auth.maxSessions", 1.5)).toBe(false);
    expect(validSetting("tutor.maxQuestionChars", 1001)).toBe(false);
    expect(validSetting("exam.passThreshold", 0.8)).toBe(false);
  });
  it("validates a manual grant without billing fields or indefinite lifetime", () => {
    const data = {
      requestId: "10000000-0000-4000-8000-000000000001",
      subjectId: null,
      days: 30,
      reason: "Проверка доступа",
    };
    expect(grantInput.parse(data)).toEqual(data);
    expect(grantInput.safeParse({ ...data, days: 0 }).success).toBe(false);
    expect(grantInput.safeParse({ ...data, autoRenew: true }).success).toBe(
      false,
    );
  });
  it("requires an explicit legal publication and a valid separate version", () => {
    const data = {
      kind: "consent",
      version: "2.0",
      contentMd: "Тестовый юридический документ.",
      previousId: null,
      confirm: true,
    };
    expect(legalInput.safeParse(data).success).toBe(true);
    expect(legalInput.safeParse({ ...data, confirm: false }).success).toBe(
      false,
    );
    expect(legalInput.safeParse({ ...data, version: "<script>" }).success).toBe(
      false,
    );
  });
  it("validates plan edits without changing stable scope or billing period", () => {
    const data = {
      revision: 0,
      title: "Тариф",
      priceKopecks: 59900,
      tutorDailyLimit: 150,
      features: ["Доступ"],
      order: 1,
      isActive: true,
    };
    expect(planInput.safeParse(data).success).toBe(true);
    expect(planInput.safeParse({ ...data, kind: "ALL_SUBJECTS" }).success).toBe(
      false,
    );
    expect(planInput.safeParse({ ...data, periodMonths: 12 }).success).toBe(
      false,
    );
  });
  it("uses inclusive UTC dates and refuses impossible, reversed and unbounded reports", () => {
    const range = reportRange(
      reportInput.parse({ from: "2026-11-01", to: "2026-11-08" }),
    );
    expect(range.start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    for (const [from, to] of [
      ["2026-02-30", "2026-03-01"],
      ["2026-11-08", "2026-11-01"],
      ["2020-01-01", "2026-11-08"],
    ])
      expect(() => reportRange(reportInput.parse({ from, to }))).toThrow();
    expect(conversion(1, 0)).toBeNull();
    expect(conversion(1, 3)).toBe(33.3);
  });
  it("requires explicit renewed consent and protects ownership during deletion", () => {
    expect(
      renewalInput.safeParse({
        confirm: true,
        renewalConsent: true,
        renewalConsentVersion: "1",
        offerVersion: "0.1",
      }).success,
    ).toBe(true);
    expect(
      renewalInput.safeParse({
        confirm: true,
        renewalConsent: false,
        renewalConsentVersion: "1",
        offerVersion: "0.1",
      }).success,
    ).toBe(false);
    expect(deletionError(true, false)).toContain("владение");
    expect(deletionError(false, true)).toContain("администратора");
    expect(deletionError(false, false)).toBeNull();
  });
});
