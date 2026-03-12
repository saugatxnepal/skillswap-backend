-- CreateEnum
CREATE TYPE "Role" AS ENUM ('Admin', 'Learner');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('Active', 'Inactive', 'Banned');

-- CreateTable
CREATE TABLE "User" (
    "UserID" TEXT NOT NULL,
    "FullName" TEXT NOT NULL,
    "Email" TEXT NOT NULL,
    "PasswordHash" TEXT NOT NULL,
    "Role" "Role" NOT NULL DEFAULT 'Learner',
    "Bio" TEXT,
    "ProfileImageURL" TEXT,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Status" "UserStatus" NOT NULL DEFAULT 'Active',
    "PasswordResetToken" TEXT,
    "PasswordResetExpires" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("UserID")
);

-- CreateTable
CREATE TABLE "UserSkill" (
    "UserSkillID" TEXT NOT NULL,
    "UserID" TEXT NOT NULL,
    "Skill" TEXT NOT NULL,

    CONSTRAINT "UserSkill_pkey" PRIMARY KEY ("UserSkillID")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_Email_key" ON "User"("Email");

-- AddForeignKey
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_UserID_fkey" FOREIGN KEY ("UserID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;
