-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('Active', 'Inactive', 'Banned');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "Status" "UserStatus" NOT NULL DEFAULT 'Active';
