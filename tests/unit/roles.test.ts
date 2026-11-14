import { describe, expect, it } from "vitest";
import {
  isStaff,
  workspaceHref,
  canEditSubject,
  protectedOwner,
  accessChangeError,
  type AppRole,
} from "../../lib/auth/roles";
import { accessInput, userFilters } from "../../lib/admin/users";
import { auditAccess } from "../../lib/admin/audit";
import { decodeSetting } from "../../lib/settings/defaults";
const base = {
  actorId: "admin",
  targetId: "target",
  currentRole: "USER" as AppRole,
  nextRole: "EDITOR" as AppRole,
  blocked: false,
  owner: false,
  otherAdmins: 1,
  verified: true,
};
describe("separate workspaces and capabilities", () => {
  it.each([
    ["USER", "/cabinet", false],
    ["EDITOR", "/teacher", true],
    ["ADMIN", "/admin", true],
  ] as const)("routes %s to its workspace", (role, path, staff) => {
    expect(workspaceHref(role)).toBe(path);
    expect(isStaff(role)).toBe(staff);
  });
  it("limits teachers to assigned subjects and keeps student roles out of the editor", () => {
    expect(canEditSubject("EDITOR", false)).toBe(false);
    expect(canEditSubject("EDITOR", true)).toBe(true);
    for (const assigned of [false, true]) {
      expect(canEditSubject("USER", assigned)).toBe(false);
      expect(canEditSubject("ADMIN", assigned)).toBe(true);
    }
  });
  it("normalizes the bootstrap owner list without treating an absent email as an owner", () => {
    expect(
      protectedOwner(
        "Owner@Example.test",
        "other@example.test, owner@example.test ",
      ),
    ).toBe(true);
    expect(protectedOwner(null, "owner@example.test")).toBe(false);
    expect(protectedOwner("student@example.test", "owner@example.test")).toBe(
      false,
    );
  });
});
describe("access changes", () => {
  it("permits a verified account to become a teacher and permits a student account without a verified method", () => {
    expect(accessChangeError(base)).toBeNull();
    expect(
      accessChangeError({ ...base, nextRole: "USER", verified: false }),
    ).toBeNull();
  });
  it("requires a verified method before granting staff permissions", () => {
    for (const nextRole of ["EDITOR", "ADMIN"] as const)
      expect(
        accessChangeError({ ...base, nextRole, verified: false }),
      ).toContain("Подтвердите");
  });
  it("protects the bootstrap owner against a demotion and block", () => {
    for (const change of [
      { nextRole: "USER" as const },
      { nextRole: "ADMIN" as const, blocked: true },
    ])
      expect(
        accessChangeError({
          ...base,
          currentRole: "ADMIN",
          owner: true,
          ...change,
        }),
      ).toContain("владельцев");
  });
  it("prevents disabling one's own account or removing the last active administrator", () => {
    expect(
      accessChangeError({
        ...base,
        actorId: "target",
        currentRole: "ADMIN",
        nextRole: "USER",
      }),
    ).toContain("собственную");
    expect(
      accessChangeError({
        ...base,
        currentRole: "ADMIN",
        nextRole: "USER",
        otherAdmins: 0,
      }),
    ).toContain("последнего");
    expect(
      accessChangeError({
        ...base,
        actorId: "target",
        currentRole: "ADMIN",
        nextRole: "ADMIN",
      }),
    ).toBeNull();
  });
  it("rejects forged fields, stale-shaped revisions, duplicate subjects and assignments for a student", () => {
    const body = {
      revision: 0,
      role: "EDITOR",
      blocked: false,
      subjectIds: ["subject"],
    };
    expect(accessInput.safeParse(body).success).toBe(true);
    for (const v of [
      { ...body, actorId: "forged" },
      { ...body, revision: -1 },
      { ...body, role: "USER" },
      { ...body, subjectIds: ["subject", "subject"] },
      { ...body, role: "ROOT" },
    ])
      expect(accessInput.safeParse(v).success).toBe(false);
  });
  it("bounds filters and settings before large queries", () => {
    expect(userFilters.parse({})).toMatchObject({
      page: 1,
      role: "ALL",
      state: "ALL",
    });
    expect(userFilters.safeParse({ role: "ROOT" }).success).toBe(false);
    expect(userFilters.safeParse({ q: "x".repeat(201) }).success).toBe(false);
    expect(decodeSetting("admin.usersPageSize", 101)).toBe(20);
    expect(decodeSetting("admin.maxTeacherSubjects", 1001)).toBe(200);
  });
  it("reads access audit data without accepting invalid roles", () => {
    expect(
      auditAccess.safeParse({
        before: { role: "USER", blocked: false, subjectIds: [] },
        after: { role: "EDITOR", blocked: false, subjectIds: ["s"] },
      }).success,
    ).toBe(true);
    expect(
      auditAccess.safeParse({
        before: { role: "ROOT", blocked: false, subjectIds: [] },
        after: { role: "USER", blocked: false, subjectIds: [] },
      }).success,
    ).toBe(false);
  });
});
