ALTER TABLE "User" ADD COLUMN "roleRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "TeacherSubject" (
  "teacherId" TEXT NOT NULL,"subjectId" TEXT NOT NULL,"assignedById" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeacherSubject_pkey" PRIMARY KEY ("teacherId","subjectId"),
  CONSTRAINT "TeacherSubject_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherSubject_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "TeacherSubject_subjectId_idx" ON "TeacherSubject"("subjectId");
CREATE TABLE "SecurityAudit" (
  id TEXT NOT NULL,"actorId" TEXT,"targetId" TEXT,action TEXT NOT NULL,changes JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityAudit_pkey" PRIMARY KEY(id),
  CONSTRAINT "SecurityAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SecurityAudit_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SecurityAudit_targetId_createdAt_idx" ON "SecurityAudit"("targetId","createdAt");
INSERT INTO "AppSetting" (key,value,"updatedAt") VALUES ('admin.usersPageSize','20',now()),('admin.maxTeacherSubjects','200',now()) ON CONFLICT(key) DO NOTHING;
