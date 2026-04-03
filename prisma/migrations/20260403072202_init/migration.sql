-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_SessionID_fkey";

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "ConversationID" TEXT,
ADD COLUMN     "DeletedFor" TEXT[],
ADD COLUMN     "IsDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "IsRead" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ReceiverID" TEXT,
ALTER COLUMN "SessionID" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "IsOnline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "LastSeen" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "Conversation" (
    "ConversationID" TEXT NOT NULL,
    "Participant1ID" TEXT NOT NULL,
    "Participant2ID" TEXT NOT NULL,
    "LastMessage" TEXT,
    "LastMessageAt" TIMESTAMP(3),
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("ConversationID")
);

-- CreateIndex
CREATE INDEX "Conversation_Participant1ID_Participant2ID_idx" ON "Conversation"("Participant1ID", "Participant2ID");

-- CreateIndex
CREATE INDEX "Conversation_LastMessageAt_idx" ON "Conversation"("LastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_Participant1ID_Participant2ID_key" ON "Conversation"("Participant1ID", "Participant2ID");

-- CreateIndex
CREATE INDEX "Message_ConversationID_CreatedAt_idx" ON "Message"("ConversationID", "CreatedAt");

-- CreateIndex
CREATE INDEX "Message_ReceiverID_idx" ON "Message"("ReceiverID");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_SessionID_fkey" FOREIGN KEY ("SessionID") REFERENCES "Session"("SessionID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_ConversationID_fkey" FOREIGN KEY ("ConversationID") REFERENCES "Conversation"("ConversationID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_ReceiverID_fkey" FOREIGN KEY ("ReceiverID") REFERENCES "User"("UserID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_Participant1ID_fkey" FOREIGN KEY ("Participant1ID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_Participant2ID_fkey" FOREIGN KEY ("Participant2ID") REFERENCES "User"("UserID") ON DELETE RESTRICT ON UPDATE CASCADE;
