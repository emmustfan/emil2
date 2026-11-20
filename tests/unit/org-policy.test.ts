import { describe, expect, it } from "vitest";
import {
  decide,
  type Action,
  type Area,
  type Assignment,
} from "../../lib/org/policy";
import type { StaffRole } from "../../lib/generated/prisma/client";

const actions: Action[] = [
  "content.read",
  "content.edit",
  "content.publish",
  "content.unpublish",
  "subject.create",
  "subject.manage",
  "department.staff",
  "faculty.manage",
  "group.manage",
  "group.members",
  "progress.view",
];
const expected: Record<StaffRole, number[]> = {
  FACULTY_ADMIN: [0, 3, 6, 7],
  DEPARTMENT_HEAD: [0, 1, 2, 3, 4, 5, 6],
  AUTHOR: [0, 1, 2],
  REVIEWER: [0, 2],
};
const own: Area = {
  facultyId: "f",
  departmentId: "a",
  subjectId: "s",
  archived: false,
};
const neighbor = { ...own, departmentId: "b", subjectId: "other" };
const outside = { ...neighbor, facultyId: "another" };
const scoped = (role: StaffRole, subject = false): Assignment => ({
  role,
  facultyId: role === "FACULTY_ADMIN" ? "f" : null,
  departmentId: role !== "FACULTY_ADMIN" && !subject ? "a" : null,
  subjectId: subject ? "s" : null,
});

describe("university permission matrix", () => {
  for (const [role, allowed] of Object.entries(expected) as [
    StaffRole,
    number[],
  ][]) {
    it(`applies every action to the ${role} area, neighboring department and another faculty`, () => {
      const actor = { id: "u", role: "EDITOR", assignments: [scoped(role)] };
      for (const [index, action] of actions.entries()) {
        const ownStatus = allowed.includes(index) ? 200 : 403;
        expect(decide(actor, action, own)).toBe(ownStatus);
        expect(decide(actor, action, neighbor)).toBe(
          role === "FACULTY_ADMIN" ? ownStatus : 404,
        );
        expect(decide(actor, action, outside)).toBe(404);
        expect(decide({ ...actor, role: "ADMIN" }, action, outside)).toBe(200);
      }
    });
  }
  it("limits subject-scoped grants to the subject and does not extend rights from a different assignment", () => {
    const actor = {
      id: "u",
      role: "EDITOR",
      assignments: [
        scoped("AUTHOR", true),
        {
          role: "REVIEWER" as const,
          facultyId: null,
          departmentId: "b",
          subjectId: null,
        },
      ],
    };
    expect(decide(actor, "content.edit", own)).toBe(200);
    expect(decide(actor, "content.edit", { ...own, subjectId: "s2" })).toBe(
      404,
    );
    expect(decide(actor, "content.edit", neighbor)).toBe(403);
    expect(decide(actor, "content.publish", neighbor)).toBe(200);
    expect(
      decide(actor, "department.staff", { ...own, subjectId: undefined }),
    ).toBe(404);
  });
  it("requires a different reviewer or head when separate review is on, and respects archives and viewing mode", () => {
    const area = {
      ...own,
      requireSeparateReviewer: true,
      draftUpdatedById: "u",
    };
    for (const role of ["AUTHOR", "REVIEWER", "DEPARTMENT_HEAD"] as const) {
      const actor = { id: "u", role: "EDITOR", assignments: [scoped(role)] };
      expect(decide(actor, "content.publish", area)).toBe(403);
      expect(
        decide({ ...actor, id: "different" }, "content.publish", area),
      ).toBe(role === "AUTHOR" ? 403 : 200);
      expect(decide(actor, "content.read", { ...own, archived: true })).toBe(
        404,
      );
      expect(decide({ ...actor, readOnly: true }, "content.publish", own)).toBe(
        403,
      );
      expect(decide({ ...actor, readOnly: true }, "content.read", own)).toBe(
        200,
      );
    }
  });
});
