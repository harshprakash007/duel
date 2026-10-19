import { z } from 'zod';
import { LEADERBOARD_DEFAULTS } from '../constants';

export const LeaderboardScopeSchema = z.enum(['global', 'sheet']);
export type LeaderboardScope = z.infer<typeof LeaderboardScopeSchema>;

export const LeaderboardQuerySchema = z.object({
  scope: LeaderboardScopeSchema.default('global'),
  sheet: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LEADERBOARD_DEFAULTS.pageLimitMax)
    .default(LEADERBOARD_DEFAULTS.pageLimitDefault),
  offset: z.coerce.number().int().min(0).default(0),
});

export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

export interface LeaderboardEntryDto {
  rank: number;
  userId: string;
  handle: string;
  rating: number;
  wins: number;
  matchesPlayed: number;
}

export interface UserRankDto {
  rank: number;
  score: number;
}

export interface LeaderboardResponseDto {
  scope: LeaderboardScope;
  sheetSlug?: string;
  entries: LeaderboardEntryDto[];
  total: number;
  myRank?: UserRankDto | null;
}
