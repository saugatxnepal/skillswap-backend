-- AlterTable
ALTER TABLE "Skill" ADD COLUMN     "DetailedContent" TEXT,
ADD COLUMN     "IsAvailable" BOOLEAN NOT NULL DEFAULT true;
