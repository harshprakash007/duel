-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('LOBBY', 'COUNTDOWN', 'ACTIVE', 'FINISHED', 'ABORTED');

-- CreateEnum
CREATE TYPE "MatchMode" AS ENUM ('RANKED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "MatchEndReason" AS ENUM ('COMPLETED', 'RESIGN', 'ABORT_NO_SHOW', 'ABORT_CF_OUTAGE', 'ABORT_NO_PROBLEMS', 'VOIDED');

-- CreateEnum
CREATE TYPE "MatchResult" AS ENUM ('WIN', 'LOSS', 'DRAW');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('PENDING', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfHandle" (
    "userId" UUID NOT NULL,
    "handle" TEXT NOT NULL,
    "handleNorm" TEXT NOT NULL,
    "cfRatingAtLink" INTEGER,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "solvedSyncedUpToId" BIGINT,
    "solvedSyncedAt" TIMESTAMP(3),

    CONSTRAINT "CfHandle_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "HandleVerification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "handle" TEXT NOT NULL,
    "handleNorm" TEXT NOT NULL,
    "problemContestId" INTEGER NOT NULL,
    "problemIndex" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "HandleVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSolved" (
    "userId" UUID NOT NULL,
    "contestId" INTEGER NOT NULL,
    "index" TEXT NOT NULL,

    CONSTRAINT "UserSolved_pkey" PRIMARY KEY ("userId","contestId","index")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" SERIAL NOT NULL,
    "contestId" INTEGER NOT NULL,
    "index" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "tags" TEXT[],
    "solvedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelSheet" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "minRating" INTEGER NOT NULL,
    "maxRating" INTEGER NOT NULL,
    "includeTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minSolvedCount" INTEGER NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LevelSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelSheetProblem" (
    "sheetId" UUID NOT NULL,
    "problemId" INTEGER NOT NULL,

    CONSTRAINT "LevelSheetProblem_pkey" PRIMARY KEY ("sheetId","problemId")
);

-- CreateTable
CREATE TABLE "PlayerRating" (
    "userId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "matchesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "peakRating" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerRating_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RatingHistory" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "before" INTEGER NOT NULL,
    "after" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" UUID NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'LOBBY',
    "mode" "MatchMode" NOT NULL,
    "roomCode" TEXT,
    "sheetId" UUID NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "winnerUserId" UUID,
    "endReason" "MatchEndReason",
    "pausedTotalMs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchPlayer" (
    "matchId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "handleNorm" TEXT NOT NULL,
    "ratingBefore" INTEGER NOT NULL,
    "ratingAfter" INTEGER,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "result" "MatchResult",

    CONSTRAINT "MatchPlayer_pkey" PRIMARY KEY ("matchId","userId")
);

-- CreateTable
CREATE TABLE "MatchQuestion" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "idx" INTEGER NOT NULL,
    "problemId" INTEGER NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "baselineSubmissionId" BIGINT,

    CONSTRAINT "MatchQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionResult" (
    "matchQuestionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "solvedAtMs" BIGINT,
    "timeToSolveMs" INTEGER,
    "wrongAttempts" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "firstSolve" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuestionResult_pkey" PRIMARY KEY ("matchQuestionId","userId")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" BIGINT NOT NULL,
    "matchQuestionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "verdict" TEXT,
    "creationTimeSec" INTEGER NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalAt" TIMESTAMP(3),

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CfHandle_handleNorm_key" ON "CfHandle"("handleNorm");

-- CreateIndex
CREATE INDEX "HandleVerification_userId_status_idx" ON "HandleVerification"("userId", "status");

-- CreateIndex
CREATE INDEX "Problem_isActive_rating_idx" ON "Problem"("isActive", "rating");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_contestId_index_key" ON "Problem"("contestId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "LevelSheet_slug_key" ON "LevelSheet"("slug");

-- CreateIndex
CREATE INDEX "PlayerRating_rating_idx" ON "PlayerRating"("rating" DESC);

-- CreateIndex
CREATE INDEX "RatingHistory_userId_createdAt_idx" ON "RatingHistory"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RatingHistory_matchId_idx" ON "RatingHistory"("matchId");

-- CreateIndex
CREATE INDEX "Match_createdAt_idx" ON "Match"("createdAt");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE INDEX "MatchPlayer_userId_matchId_idx" ON "MatchPlayer"("userId", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchQuestion_matchId_idx_key" ON "MatchQuestion"("matchId", "idx");

-- CreateIndex
CREATE INDEX "Submission_matchQuestionId_idx" ON "Submission"("matchQuestionId");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CfHandle" ADD CONSTRAINT "CfHandle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandleVerification" ADD CONSTRAINT "HandleVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSolved" ADD CONSTRAINT "UserSolved_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelSheetProblem" ADD CONSTRAINT "LevelSheetProblem_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "LevelSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelSheetProblem" ADD CONSTRAINT "LevelSheetProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerRating" ADD CONSTRAINT "PlayerRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingHistory" ADD CONSTRAINT "RatingHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingHistory" ADD CONSTRAINT "RatingHistory_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "LevelSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchQuestion" ADD CONSTRAINT "MatchQuestion_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchQuestion" ADD CONSTRAINT "MatchQuestion_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionResult" ADD CONSTRAINT "QuestionResult_matchQuestionId_fkey" FOREIGN KEY ("matchQuestionId") REFERENCES "MatchQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionResult" ADD CONSTRAINT "QuestionResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_matchQuestionId_fkey" FOREIGN KEY ("matchQuestionId") REFERENCES "MatchQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
