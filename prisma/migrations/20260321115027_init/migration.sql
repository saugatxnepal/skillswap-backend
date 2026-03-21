/*
  Warnings:

  - You are about to drop the column `IsAdminMonitor` on the `SessionParticipant` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[SessionID,UserID]` on the table `SessionParticipant` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[Name]` on the table `SkillCategory` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `UpdatedAt` to the `Availability` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `Type` on the `Notification` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `UpdatedAt` to the `Review` table without a default value. This is not possible if the table is not empty.
  - Added the required column `Action` to the `SessionMonitoringLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `Role` to the `SessionParticipant` table without a default value. This is not possible if the table is not empty.
  - Added the required column `UpdatedAt` to the `UserSkill` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('VIDEO', 'CHAT', 'HYBRID');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SESSION_SCHEDULED', 'SESSION_REMINDER', 'NEW_MESSAGE', 'MATCH_FOUND', 'SESSION_CANCELLED', 'SESSION_COMPLETED', 'REVIEW_RECEIVED', 'REPORT_RESOLVED', 'MENTOR_REQUEST', 'LEARNER_REQUEST');

-- AlterTable
ALTER TABLE "AdminAction" ADD COLUMN     "Metadata" JSONB;

-- AlterTable
ALTER TABLE "Availability" ADD COLUMN     "IsActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "UpdatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "EditedAt" TIMESTAMP(3),
ADD COLUMN     "FileName" TEXT,
ADD COLUMN     "FileSize" INTEGER,
ADD COLUMN     "IsEdited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ReplyToID" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "EmailSentAt" TIMESTAMP(3),
ADD COLUMN     "IsEmailSent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ReadAt" TIMESTAMP(3),
DROP COLUMN "Type",
ADD COLUMN     "Type" "NotificationType" NOT NULL;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "Evidence" JSONB,
ADD COLUMN     "ResolvedBy" TEXT;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "IsPublic" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "Tags" TEXT[],
ADD COLUMN     "UpdatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "Duration" INTEGER,
ADD COLUMN     "MeetingRoomId" TEXT,
ADD COLUMN     "RecordingUrl" TEXT,
ADD COLUMN     "SessionType" "SessionType" NOT NULL DEFAULT 'VIDEO';

-- AlterTable
ALTER TABLE "SessionMonitoringLog" ADD COLUMN     "Action" TEXT NOT NULL,
ADD COLUMN     "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "Metadata" JSONB;

-- AlterTable
ALTER TABLE "SessionParticipant" DROP COLUMN "IsAdminMonitor",
ADD COLUMN     "ConnectionQuality" TEXT,
ADD COLUMN     "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "IsActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "Role" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SessionSkill" ADD COLUMN     "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "SkillCategory" ADD COLUMN     "DisplayOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "Icon" TEXT;

-- AlterTable
ALTER TABLE "TimeSlot" ADD COLUMN     "SelectedBy" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "NotificationPreferences" JSONB DEFAULT '{"email": true, "inApp": true}',
ADD COLUMN     "Timezone" TEXT DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "UserSkill" ADD COLUMN     "TeachingStyle" TEXT,
ADD COLUMN     "UpdatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "SessionInvite" (
    "InviteID" TEXT NOT NULL,
    "SessionID" TEXT NOT NULL,
    "InviterID" TEXT NOT NULL,
    "InviteeID" TEXT NOT NULL,
    "Status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "Message" TEXT,
    "ExpiresAt" TIMESTAMP(3) NOT NULL,
    "RespondedAt" TIMESTAMP(3),
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionInvite_pkey" PRIMARY KEY ("InviteID")
);

-- CreateTable
CREATE TABLE "SessionQuestion" (
    "QuestionID" TEXT NOT NULL,
    "SessionID" TEXT NOT NULL,
    "UserID" TEXT NOT NULL,
    "Question" TEXT NOT NULL,
    "Answer" TEXT,
    "IsAnswered" BOOLEAN NOT NULL DEFAULT false,
    "AnsweredBy" TEXT,
    "AnsweredAt" TIMESTAMP(3),
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionQuestion_pkey" PRIMARY KEY ("QuestionID")
);

-- CreateTable
CREATE TABLE "MeetingRecording" (
    "RecordingID" TEXT NOT NULL,
    "SessionID" TEXT NOT NULL,
    "UserID" TEXT NOT NULL,
    "RecordingUrl" TEXT NOT NULL,
    "Duration" INTEGER,
    "FileSize" BIGINT,
    "Status" TEXT NOT NULL DEFAULT 'processing',
    "IsArchived" BOOLEAN NOT NULL DEFAULT false,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingRecording_pkey" PRIMARY KEY ("RecordingID")
);

-- CreateIndex
CREATE INDEX "SessionInvite_InviteeID_Status_idx" ON "SessionInvite"("InviteeID", "Status");

-- CreateIndex
CREATE INDEX "SessionInvite_ExpiresAt_idx" ON "SessionInvite"("ExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionInvite_SessionID_InviteeID_key" ON "SessionInvite"("SessionID", "InviteeID");

-- CreateIndex
CREATE INDEX "SessionQuestion_SessionID_IsAnswered_idx" ON "SessionQuestion"("SessionID", "IsAnswered");

-- CreateIndex
CREATE INDEX "MeetingRecording_SessionID_idx" ON "MeetingRecording"("SessionID");

-- CreateIndex
CREATE INDEX "AdminAction_AdminID_idx" ON "AdminAction"("AdminID");

-- CreateIndex
CREATE INDEX "AdminAction_TargetUserID_idx" ON "AdminAction"("TargetUserID");

-- CreateIndex
CREATE INDEX "Availability_UserID_IsRecurring_idx" ON "Availability"("UserID", "IsRecurring");

-- CreateIndex
CREATE INDEX "Availability_SpecificDate_idx" ON "Availability"("SpecificDate");

-- CreateIndex
CREATE INDEX "Message_SenderID_idx" ON "Message"("SenderID");

-- CreateIndex
CREATE INDEX "Notification_UserID_IsRead_idx" ON "Notification"("UserID", "IsRead");

-- CreateIndex
CREATE INDEX "Notification_CreatedAt_idx" ON "Notification"("CreatedAt");

-- CreateIndex
CREATE INDEX "Report_ReportedUserID_Status_idx" ON "Report"("ReportedUserID", "Status");

-- CreateIndex
CREATE INDEX "Report_Status_idx" ON "Report"("Status");

-- CreateIndex
CREATE INDEX "Review_RevieweeID_Rating_idx" ON "Review"("RevieweeID", "Rating");

-- CreateIndex
CREATE INDEX "Review_IsMentorReview_idx" ON "Review"("IsMentorReview");

-- CreateIndex
CREATE INDEX "Session_Status_idx" ON "Session"("Status");

-- CreateIndex
CREATE INDEX "Session_ScheduledStart_idx" ON "Session"("ScheduledStart");

-- CreateIndex
CREATE INDEX "Session_MentorID_Status_idx" ON "Session"("MentorID", "Status");

-- CreateIndex
CREATE INDEX "Session_LearnerID_Status_idx" ON "Session"("LearnerID", "Status");

-- CreateIndex
CREATE INDEX "SessionMonitoringLog_SessionID_idx" ON "SessionMonitoringLog"("SessionID");

-- CreateIndex
CREATE INDEX "SessionParticipant_UserID_idx" ON "SessionParticipant"("UserID");

-- CreateIndex
CREATE UNIQUE INDEX "SessionParticipant_SessionID_UserID_key" ON "SessionParticipant"("SessionID", "UserID");

-- CreateIndex
CREATE INDEX "SessionSkill_SkillID_idx" ON "SessionSkill"("SkillID");

-- CreateIndex
CREATE INDEX "Skill_IsAvailable_idx" ON "Skill"("IsAvailable");

-- CreateIndex
CREATE INDEX "Skill_SkillCategoryID_idx" ON "Skill"("SkillCategoryID");

-- CreateIndex
CREATE UNIQUE INDEX "SkillCategory_Name_key" ON "SkillCategory"("Name");

-- CreateIndex
CREATE INDEX "TimeSlot_SessionID_IsSelected_idx" ON "TimeSlot"("SessionID", "IsSelected");

-- CreateIndex
CREATE INDEX "TimeSlot_StartTime_idx" ON "TimeSlot"("StartTime");

-- CreateIndex
CREATE INDEX "UserSkill_UserID_IsMentor_idx" ON "UserSkill"("UserID", "IsMentor");

-- CreateIndex
CREATE INDEX "UserSkill_SkillID_IsMentor_idx" ON "UserSkill"("SkillID", "IsMentor");

-- CreateIndex
CREATE INDEX "WebRTCLog_SessionID_Timestamp_idx" ON "WebRTCLog"("SessionID", "Timestamp");

-- CreateIndex
CREATE INDEX "WebRTCLog_UserID_idx" ON "WebRTCLog"("UserID");

-- AddForeignKey
ALTER TABLE "SessionInvite" ADD CONSTRAINT "SessionInvite_SessionID_fkey" FOREIGN KEY ("SessionID") REFERENCES "Session"("SessionID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionInvite" ADD CONSTRAINT "SessionInvite_InviterID_fkey" FOREIGN KEY ("InviterID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionInvite" ADD CONSTRAINT "SessionInvite_InviteeID_fkey" FOREIGN KEY ("InviteeID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionQuestion" ADD CONSTRAINT "SessionQuestion_SessionID_fkey" FOREIGN KEY ("SessionID") REFERENCES "Session"("SessionID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionQuestion" ADD CONSTRAINT "SessionQuestion_UserID_fkey" FOREIGN KEY ("UserID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_SessionID_fkey" FOREIGN KEY ("SessionID") REFERENCES "Session"("SessionID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_UserID_fkey" FOREIGN KEY ("UserID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;
