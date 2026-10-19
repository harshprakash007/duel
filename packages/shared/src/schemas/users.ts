import { z } from 'zod';

export const UserMatchesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type UserMatchesQuery = z.infer<typeof UserMatchesQuerySchema>;

export interface RatingPointDto {
  matchId: string;
  before: number;
  after: number;
  delta: number;
  createdAt: string;
}

export interface UserProfileDto {
  userId: string;
  handle: string;
  displayName: string;
  verifiedAt: string;
  cfRatingAtLink: number | null;
  rating: number;
  peakRating: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  globalRank: number | null;
  ratingHistory: RatingPointDto[];
}

export interface UserMatchSummaryDto {
  matchId: string;
  mode: string;
  sheetSlug: string;
  sheetName: string;
  createdAt: string;
  finishedAt: string | null;
  endReason: string | null;
  opponent: {
    userId: string;
    handle: string;
    rating: number;
  } | null;
  result: 'WIN' | 'LOSS' | 'DRAW' | null;
  score: number;
  opponentScore: number;
  ratingBefore: number;
  ratingAfter: number | null;
  delta: number | null;
  questionCount: number;
}

export interface UserMatchesResponseDto {
  matches: UserMatchSummaryDto[];
  total: number;
}

export interface MatchRecapPlayerDto {
  userId: string;
  handle: string;
  score: number;
  result: 'WIN' | 'LOSS' | 'DRAW' | null;
  ratingBefore: number;
  ratingAfter: number | null;
  delta: number | null;
}

export interface MatchRecapQuestionDto {
  idx: number;
  problem: {
    id: number;
    contestId: number;
    index: string;
    name: string;
    rating: number;
    tags: string[];
    url: string;
  };
  scores: Record<string, number>;
  firstSolveUserId?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface MatchRecapDto {
  matchId: string;
  status: string;
  mode: string;
  roomCode?: string | null;
  sheet: {
    id: string;
    slug: string;
    name: string;
  };
  questionCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  winnerUserId: string | null;
  endReason: string | null;
  players: MatchRecapPlayerDto[];
  questions: MatchRecapQuestionDto[];
}
