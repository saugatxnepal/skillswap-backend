/*
  Warnings:

  - You are about to drop the column `Status` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `Skill` on the `UserSkill` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[UserID,SkillID]` on the table `UserSkill` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `SkillID` to the `UserSkill` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PENDING_MATCH', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REPORTED');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'FILE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'REVIEWED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('INAPPROPRIATE_BEHAVIOR', 'TECHNICAL_ISSUES', 'NO_SHOW', 'HARASSMENT', 'SPAM', 'OTHER');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'Mentor';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "Status";

-- AlterTable
ALTER TABLE "UserSkill" DROP COLUMN "Skill",
ADD COLUMN     "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "ExperienceLevel" INTEGER,
ADD COLUMN     "IsLearner" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "IsMentor" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "SkillID" TEXT NOT NULL;

-- DropEnum
DROP TYPE "UserStatus";

-- CreateTable
CREATE TABLE "Skill" (
    "SkillID" TEXT NOT NULL,
    "Name" TEXT NOT NULL,
    "Description" TEXT,
    "SkillCategoryID" TEXT NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("SkillID")
);

-- CreateTable
CREATE TABLE "SkillCategory" (
    "SkillCategoryID" TEXT NOT NULL,
    "Name" TEXT NOT NULL,
    "Description" TEXT,

    CONSTRAINT "SkillCategory_pkey" PRIMARY KEY ("SkillCategoryID")
);

-- CreateTable
CREATE TABLE "Session" (
    "SessionID" TEXT NOT NULL,
    "Title" TEXT NOT NULL,
    "Description" TEXT,
    "LearnerID" TEXT NOT NULL,
    "MentorID" TEXT,
    "Status" "SessionStatus" NOT NULL DEFAULT 'PENDING_MATCH',
    "ScheduledStart" TIMESTAMP(3),
    "ScheduledEnd" TIMESTAMP(3),
    "ActualStartTime" TIMESTAMP(3),
    "ActualEndTime" TIMESTAMP(3),
    "MeetingLink" TEXT,
    "MeetingProvider" TEXT,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("SessionID")
);

-- CreateTable
CREATE TABLE "SessionSkill" (
    "SessionSkillID" TEXT NOT NULL,
    "SessionID" TEXT NOT NULL,
    "SkillID" TEXT NOT NULL,

    CONSTRAINT "SessionSkill_pkey" PRIMARY KEY ("SessionSkillID")
);

-- CreateTable
CREATE TABLE "SessionParticipant" (
    "ParticipantID" TEXT NOT NULL,
    "SessionID" TEXT NOT NULL,
    "UserID" TEXT NOT NULL,
    "JoinedAt" TIMESTAMP(3),
    "LeftAt" TIMESTAMP(3),
    "IsAdminMonitor" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SessionParticipant_pkey" PRIMARY KEY ("ParticipantID")
);

-- CreateTable
CREATE TABLE "TimeSlot" (
    "TimeSlotID" TEXT NOT NULL,
    "SessionID" TEXT NOT NULL,
    "UserID" TEXT NOT NULL,
    "StartTime" TIMESTAMP(3) NOT NULL,
    "EndTime" TIMESTAMP(3) NOT NULL,
    "IsAvailable" BOOLEAN NOT NULL DEFAULT true,
    "IsSelected" BOOLEAN NOT NULL DEFAULT false,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeSlot_pkey" PRIMARY KEY ("TimeSlotID")
);

-- CreateTable
CREATE TABLE "Availability" (
    "AvailabilityID" TEXT NOT NULL,
    "UserID" TEXT NOT NULL,
    "DayOfWeek" INTEGER NOT NULL,
    "StartTime" TEXT NOT NULL,
    "EndTime" TEXT NOT NULL,
    "IsRecurring" BOOLEAN NOT NULL DEFAULT true,
    "SpecificDate" TIMESTAMP(3),
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("AvailabilityID")
);

-- CreateTable
CREATE TABLE "Message" (
    "MessageID" TEXT NOT NULL,
    "SessionID" TEXT NOT NULL,
    "SenderID" TEXT NOT NULL,
    "Content" TEXT NOT NULL,
    "MessageType" "MessageType" NOT NULL DEFAULT 'TEXT',
    "FileURL" TEXT,
    "ReadAt" TIMESTAMP(3),
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("MessageID")
);

-- CreateTable
CREATE TABLE "Review" (
    "ReviewID" TEXT NOT NULL,
    "SessionID" TEXT NOT NULL,
    "ReviewerID" TEXT NOT NULL,
    "RevieweeID" TEXT NOT NULL,
    "Rating" INTEGER NOT NULL,
    "Comment" TEXT,
    "IsMentorReview" BOOLEAN NOT NULL,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("ReviewID")
);

-- CreateTable
CREATE TABLE "Report" (
    "ReportID" TEXT NOT NULL,
    "SessionID" TEXT,
    "ReporterID" TEXT NOT NULL,
    "ReportedUserID" TEXT NOT NULL,
    "Reason" "ReportReason" NOT NULL,
    "Description" TEXT NOT NULL,
    "Status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "AdminNotes" TEXT,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ResolvedAt" TIMESTAMP(3),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("ReportID")
);

-- CreateTable
CREATE TABLE "AdminAction" (
    "ActionID" TEXT NOT NULL,
    "AdminID" TEXT NOT NULL,
    "ActionType" TEXT NOT NULL,
    "TargetUserID" TEXT,
    "SessionID" TEXT,
    "Description" TEXT NOT NULL,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("ActionID")
);

-- CreateTable
CREATE TABLE "Notification" (
    "NotificationID" TEXT NOT NULL,
    "UserID" TEXT NOT NULL,
    "Type" TEXT NOT NULL,
    "Title" TEXT NOT NULL,
    "Content" TEXT NOT NULL,
    "IsRead" BOOLEAN NOT NULL DEFAULT false,
    "Data" JSONB,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("NotificationID")
);

-- CreateTable
CREATE TABLE "WebRTCLog" (
    "LogID" TEXT NOT NULL,
    "SessionID" TEXT NOT NULL,
    "UserID" TEXT NOT NULL,
    "EventType" TEXT NOT NULL,
    "Data" JSONB,
    "Timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebRTCLog_pkey" PRIMARY KEY ("LogID")
);

-- CreateTable
CREATE TABLE "SessionMonitoringLog" (
    "LogID" TEXT NOT NULL,
    "SessionID" TEXT NOT NULL,
    "AdminID" TEXT NOT NULL,
    "JoinedAt" TIMESTAMP(3) NOT NULL,
    "LeftAt" TIMESTAMP(3),
    "Notes" TEXT,

    CONSTRAINT "SessionMonitoringLog_pkey" PRIMARY KEY ("LogID")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionSkill_SessionID_SkillID_key" ON "SessionSkill"("SessionID", "SkillID");

-- CreateIndex
CREATE INDEX "Message_SessionID_CreatedAt_idx" ON "Message"("SessionID", "CreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_SessionID_ReviewerID_RevieweeID_key" ON "Review"("SessionID", "ReviewerID", "RevieweeID");

-- CreateIndex
CREATE UNIQUE INDEX "UserSkill_UserID_SkillID_key" ON "UserSkill"("UserID", "SkillID");

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_SkillCategoryID_fkey" FOREIGN KEY ("SkillCategoryID") REFERENCES "SkillCategory"("SkillCategoryID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_SkillID_fkey" FOREIGN KEY ("SkillID") REFERENCES "Skill"("SkillID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_LearnerID_fkey" FOREIGN KEY ("LearnerID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_MentorID_fkey" FOREIGN KEY ("MentorID") REFERENCES "User"("UserID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionSkill" ADD CONSTRAINT "SessionSkill_SessionID_fkey" FOREIGN KEY ("SessionID") REFERENCES "Session"("SessionID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionSkill" ADD CONSTRAINT "SessionSkill_SkillID_fkey" FOREIGN KEY ("SkillID") REFERENCES "Skill"("SkillID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_SessionID_fkey" FOREIGN KEY ("SessionID") REFERENCES "Session"("SessionID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_UserID_fkey" FOREIGN KEY ("UserID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_SessionID_fkey" FOREIGN KEY ("SessionID") REFERENCES "Session"("SessionID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_UserID_fkey" FOREIGN KEY ("UserID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_UserID_fkey" FOREIGN KEY ("UserID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_SessionID_fkey" FOREIGN KEY ("SessionID") REFERENCES "Session"("SessionID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_SenderID_fkey" FOREIGN KEY ("SenderID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_SessionID_fkey" FOREIGN KEY ("SessionID") REFERENCES "Session"("SessionID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_ReviewerID_fkey" FOREIGN KEY ("ReviewerID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_RevieweeID_fkey" FOREIGN KEY ("RevieweeID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_SessionID_fkey" FOREIGN KEY ("SessionID") REFERENCES "Session"("SessionID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_ReporterID_fkey" FOREIGN KEY ("ReporterID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_ReportedUserID_fkey" FOREIGN KEY ("ReportedUserID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_AdminID_fkey" FOREIGN KEY ("AdminID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_TargetUserID_fkey" FOREIGN KEY ("TargetUserID") REFERENCES "User"("UserID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_SessionID_fkey" FOREIGN KEY ("SessionID") REFERENCES "Session"("SessionID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_UserID_fkey" FOREIGN KEY ("UserID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebRTCLog" ADD CONSTRAINT "WebRTCLog_SessionID_fkey" FOREIGN KEY ("SessionID") REFERENCES "Session"("SessionID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebRTCLog" ADD CONSTRAINT "WebRTCLog_UserID_fkey" FOREIGN KEY ("UserID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionMonitoringLog" ADD CONSTRAINT "SessionMonitoringLog_SessionID_fkey" FOREIGN KEY ("SessionID") REFERENCES "Session"("SessionID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionMonitoringLog" ADD CONSTRAINT "SessionMonitoringLog_AdminID_fkey" FOREIGN KEY ("AdminID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;
