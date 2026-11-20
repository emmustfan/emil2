import { describe, expect, it } from "vitest";
import { parseGroupCsv } from "../../lib/groups/csv";
import { academicYear, normalizeJoinCode } from "../../lib/groups/input";
import { safeLoginReturn } from "../../lib/auth/return";
import { groupPermissions } from "../../lib/org/group-policy";
import type { StaffActor } from "../../lib/org/policy";

describe("group CSV", () => {
  it("handles UTF-8 BOM, semicolon, quotes, CRLF, blanks and duplicates", () => {
    const parsed = parseGroupCsv(
      "\uFEFFname;course;academicYear\r\n" +
        '\r\n"Группа; 101";1;2026/2027\r\n' +
        '"Группа; 101";2;2026/2027\r\n' +
        "102;7;2026/2027\r\n" +
        '"Группа ""А""";3;2026/2027\r\n',
    );
    expect(parsed.rows).toEqual([
      { name: "Группа; 101", course: 1, academicYear: "2026/2027" },
      { name: 'Группа "А"', course: 3, academicYear: "2026/2027" },
    ]);
    expect(parsed.duplicates).toBe(1);
    expect(parsed.errors.map((error) => error.line)).toEqual([5]);
  });

  it("accepts commas and reports malformed fields, invalid years and headers", () => {
    const parsed = parseGroupCsv(
      'name,course,academicYear\n101,2,2025/2026\n102,3,2025/2027\n"103,3,2025/2026\n104,4,2025/2026,extra',
    );
    expect(parsed.rows).toEqual([
      { name: "101", course: 2, academicYear: "2025/2026" },
    ]);
    expect(parsed.errors.map((error) => error.line)).toEqual([3, 4, 5]);
    expect(parseGroupCsv("\nName,course,academicYear").errors[0].line).toBe(2);
  });
});

it("normalizes group codes and narrowly allows invitation returns after sign-in", () => {
  expect(normalizeJoinCode(" aBCd2345 ")).toBe("ABCD2345");
  expect(normalizeJoinCode("ABCD2305")).toBeNull();
  expect(normalizeJoinCode("ABCDE2345")).toBeNull();
  expect(safeLoginReturn("/join/abcd2345")).toBe("/join/ABCD2345");
  expect(safeLoginReturn("/cabinet/groups")).toBe("/cabinet/groups");
  expect(safeLoginReturn("/pricing?subjectId=123")).toBe(
    "/pricing?subjectId=123",
  );
  for (const target of [
    "//other.example/join/ABCD2345",
    "/join/ABCD2345?next=https://other.example",
    "/join/../../admin",
  ])
    expect(safeLoginReturn(target)).toBe("/cabinet");
});

it("starts the preview academic year in September, Moscow time", () => {
  expect(academicYear(new Date("2026-08-31T20:59:59.000Z"))).toBe("2025/2026");
  expect(academicYear(new Date("2026-08-31T21:00:00.000Z"))).toBe("2026/2027");
});

it("scopes group metadata, roster, decisions and management to distinct rights", () => {
  const group = {
    facultyId: "f",
    archivedAt: null,
    faculty: { archivedAt: null },
  };
  const teacher: StaffActor = { id: "t", role: "EDITOR", assignments: [] };
  const facultyAdmin: StaffActor = {
    ...teacher,
    assignments: [
      {
        role: "FACULTY_ADMIN",
        facultyId: "f",
        departmentId: null,
        subjectId: null,
      },
    ],
  };
  const head: StaffActor = {
    ...teacher,
    assignments: [
      {
        role: "DEPARTMENT_HEAD",
        departmentId: "a",
        facultyId: null,
        subjectId: null,
      },
    ],
  };
  expect(groupPermissions({ ...teacher, role: "ADMIN" }, group, false)).toEqual(
    { read: true, roster: true, manage: true, members: true },
  );
  expect(groupPermissions(facultyAdmin, group, false)).toEqual({
    read: true,
    roster: true,
    manage: true,
    members: true,
  });
  expect(
    groupPermissions(facultyAdmin, { ...group, facultyId: "other" }, false),
  ).toEqual({ read: false, roster: false, manage: false, members: false });
  expect(groupPermissions(teacher, group, true)).toEqual({
    read: true,
    roster: true,
    manage: false,
    members: true,
  });
  expect(groupPermissions({ ...teacher, readOnly: true }, group, true)).toEqual(
    { read: true, roster: true, manage: false, members: false },
  );
  expect(groupPermissions(head, group, false)).toEqual({
    read: true,
    roster: false,
    manage: false,
    members: false,
  });
  expect(
    groupPermissions(teacher, { ...group, archivedAt: new Date() }, true),
  ).toEqual({ read: false, roster: false, manage: false, members: false });
});
