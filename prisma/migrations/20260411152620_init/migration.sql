/*
  Warnings:

  - You are about to drop the `SessionMonitoringLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SessionQuestion` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WebRTCLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SessionMonitoringLog" DROP CONSTRAINT "SessionMonitoringLog_AdminID_fkey";

-- DropForeignKey
ALTER TABLE "SessionMonitoringLog" DROP CONSTRAINT "SessionMonitoringLog_SessionID_fkey";

-- DropForeignKey
ALTER TABLE "SessionQuestion" DROP CONSTRAINT "SessionQuestion_SessionID_fkey";

-- DropForeignKey
ALTER TABLE "SessionQuestion" DROP CONSTRAINT "SessionQuestion_UserID_fkey";

-- DropForeignKey
ALTER TABLE "WebRTCLog" DROP CONSTRAINT "WebRTCLog_SessionID_fkey";

-- DropForeignKey
ALTER TABLE "WebRTCLog" DROP CONSTRAINT "WebRTCLog_UserID_fkey";

-- DropTable
DROP TABLE "SessionMonitoringLog";

-- DropTable
DROP TABLE "SessionQuestion";

-- DropTable
DROP TABLE "WebRTCLog";
