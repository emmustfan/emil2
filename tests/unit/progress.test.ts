import { expect, it } from "vitest";
import {
  isLagging,
  progressFilters,
  isStudentProgressPath,
} from "../../lib/progress/policy";
import {
  studentProfiles,
  demoCorrectCount,
  studentPlan,
  assertStudentPreview,
} from "../../scripts/preview/student-profiles";
import { decodeSetting } from "../../lib/settings/defaults";
const now = new Date("2026-11-15T12:00:00Z"),
  settings = { minCompletionPercent: 50, inactiveDays: 7 };
it("flags low completion OR inactivity, with strict threshold boundaries and a creation-date fallback", () => {
  const recent = new Date(+now - 86400000),
    boundary = new Date(+now - 7 * 86400000);
  expect(isLagging(1, 4, recent, recent, now, settings)).toBe(true);
  expect(isLagging(2, 4, boundary, recent, now, settings)).toBe(false);
  expect(isLagging(4, 4, new Date(+boundary - 1), recent, now, settings)).toBe(
    true,
  );
  expect(
    isLagging(0, 0, null, recent, now, {
      ...settings,
      minCompletionPercent: 0,
    }),
  ).toBe(false);
  expect(
    isLagging(0, 0, null, new Date(+boundary - 1), now, {
      ...settings,
      minCompletionPercent: 0,
    }),
  ).toBe(true);
});
it("validates configurable thresholds, sorting and progress route matching", () => {
  expect(decodeSetting("progress.minCompletionPercent", 0)).toBe(0);
  expect(decodeSetting("progress.minCompletionPercent", 101)).toBe(50);
  expect(decodeSetting("progress.pageSize", 10000)).toBe(20);
  expect(decodeSetting("progress.inactiveDays", 1.5)).toBe(7);
  expect(progressFilters.safeParse({ sort: "name;DROP TABLE" }).success).toBe(
    false,
  );
  expect(isStudentProgressPath("/admin/users/person/progress")).toBe(true);
  expect(isStudentProgressPath("/admin/users/person")).toBe(false);
});
it("generates twelve explicitly fictional, reproducible profiles with the required distribution", () => {
  const profiles = studentProfiles(42);
  expect(profiles).toEqual(studentProfiles(42));
  expect(profiles).not.toEqual(studentProfiles(43));
  expect(
    profiles.reduce(
      (counts, p) => ({ ...counts, [p.kind]: (counts[p.kind] ?? 0) + 1 }),
      {} as Record<string, number>,
    ),
  ).toEqual({
    excellent: 2,
    average: 4,
    lagging: 2,
    dropout: 2,
    new: 1,
    repeated: 1,
  });
  expect(new Set(profiles.map((p) => p.email)).size).toBe(12);
  for (const profile of profiles) {
    expect(profile.name).toMatch(/^Демо .*\(демо\)$/);
    expect(profile.email).toMatch(/^demo-student-(0[1-9]|1[0-2])@example.ru$/);
    const plan = studentPlan(profile, 7);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((p) => p.daysAgo >= 0 && p.daysAgo <= 29)).toBe(true);
  }
  expect(studentPlan(profiles[0], 7)).toHaveLength(7);
  expect(studentPlan(profiles[10], 7)).toHaveLength(1);
  expect(studentPlan(profiles[11], 7)[0].practiceRounds).toBe(6);
});
it("refuses non-preview and production targets before any database access", () => {
  expect(() =>
    assertStudentPreview("postgresql://app:app@localhost/app", "test"),
  ).toThrow();
  expect(() =>
    assertStudentPreview(
      "postgresql://app:app@localhost/dental_preview_a12000000001",
      "production",
    ),
  ).toThrow();
  expect(() =>
    assertStudentPreview(
      "postgresql://app:app@localhost/dental_preview_a12000000001",
      "test",
    ),
  ).not.toThrow();
});

it("keeps actual quiz scores in the profile band when the question count is not divisible by five", () => {
  for (const profile of studentProfiles().filter((p) => p.kind === "average"))
    for (const questions of [5, 6, 7, 9, 15]) {
      const score = demoCorrectCount(profile, questions) / questions;
      expect(score).toBeGreaterThanOrEqual(0.6);
      expect(score).toBeLessThanOrEqual(0.8);
    }
});
