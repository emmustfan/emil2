BEGIN;
CREATE TYPE "StaffRole" AS ENUM ('FACULTY_ADMIN', 'DEPARTMENT_HEAD', 'AUTHOR', 'REVIEWER');
CREATE TABLE "Faculty" (
  "id" TEXT PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3)
);
CREATE TABLE "Department" (
  "id" TEXT PRIMARY KEY,
  "facultyId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "requireSeparateReviewer" BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "Department_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Department_facultyId_slug_key" ON "Department"("facultyId", "slug");
INSERT INTO "Faculty" ("id","slug","title") VALUES ('org-stomatology','stomatology','Стоматологический факультет');
INSERT INTO "Department" ("id","facultyId","slug","title") VALUES ('org-unassigned','org-stomatology','unassigned','Нераспределённые предметы');
ALTER TABLE "Subject" ADD COLUMN "departmentId" TEXT NOT NULL DEFAULT 'org-unassigned',
  ADD CONSTRAINT "Subject_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Subject_departmentId_idx" ON "Subject"("departmentId");
CREATE TABLE "RoleAssignment" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "role" "StaffRole" NOT NULL,
  "facultyId" TEXT,
  "departmentId" TEXT,
  "subjectId" TEXT,
  "scopeKey" TEXT NOT NULL,
  "assignedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoleAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RoleAssignment_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoleAssignment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoleAssignment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoleAssignment_scope_check" CHECK (
    num_nonnulls("facultyId","departmentId","subjectId") = 1
    AND (("role" = 'FACULTY_ADMIN' AND "facultyId" IS NOT NULL)
      OR ("role" = 'DEPARTMENT_HEAD' AND "departmentId" IS NOT NULL)
      OR ("role" IN ('AUTHOR','REVIEWER') AND ("departmentId" IS NOT NULL OR "subjectId" IS NOT NULL)))
    AND "scopeKey" = COALESCE('faculty:' || "facultyId",'department:' || "departmentId",'subject:' || "subjectId")
  )
);
CREATE UNIQUE INDEX "RoleAssignment_userId_role_scopeKey_key" ON "RoleAssignment"("userId","role","scopeKey");
CREATE INDEX "RoleAssignment_departmentId_idx" ON "RoleAssignment"("departmentId");
CREATE INDEX "RoleAssignment_subjectId_idx" ON "RoleAssignment"("subjectId");
CREATE INDEX "RoleAssignment_facultyId_idx" ON "RoleAssignment"("facultyId");
INSERT INTO "RoleAssignment" ("id","userId","role","subjectId","scopeKey","assignedById","createdAt")
  SELECT 'legacy-author-' || md5(jsonb_build_array("teacherId","subjectId")::text),
    "teacherId",'AUTHOR',"subjectId",'subject:' || "subjectId","assignedById","createdAt"
  FROM "TeacherSubject";
DROP TABLE "TeacherSubject";
COMMIT;
