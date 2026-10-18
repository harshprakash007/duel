import { z } from 'zod';

export const CF_VERDICTS = [
  'FAILED',
  'OK',
  'PARTIAL',
  'COMPILATION_ERROR',
  'RUNTIME_ERROR',
  'WRONG_ANSWER',
  'TIME_LIMIT_EXCEEDED',
  'MEMORY_LIMIT_EXCEEDED',
  'IDLENESS_LIMIT_EXCEEDED',
  'SECURITY_VIOLATED',
  'CRASHED',
  'INPUT_PREPARATION_CRASHED',
  'CHALLENGED',
  'SKIPPED',
  'TESTING',
  'REJECTED',
  'SUBMITTED',
] as const;

export type CfVerdict = (typeof CF_VERDICTS)[number];

export const CfVerdictSchema = z.enum(CF_VERDICTS);

export const CfProblemSchema = z
  .object({
    contestId: z.number().int().optional(),
    problemsetName: z.string().optional(),
    index: z.string(),
    name: z.string(),
    type: z.string().optional(),
    points: z.number().optional(),
    rating: z.number().int().optional(),
    tags: z.array(z.string()).default([]),
  })
  .passthrough();

export type CfProblem = z.infer<typeof CfProblemSchema>;

export const CfProblemStatisticsSchema = z
  .object({
    contestId: z.number().int().optional(),
    index: z.string(),
    solvedCount: z.number().int(),
  })
  .passthrough();

export type CfProblemStatistics = z.infer<typeof CfProblemStatisticsSchema>;

export const CfPartyMemberSchema = z
  .object({
    handle: z.string(),
    name: z.string().optional(),
  })
  .passthrough();

export const CfPartySchema = z
  .object({
    contestId: z.number().int().optional(),
    members: z.array(CfPartyMemberSchema),
    participantType: z.string().optional(),
    isGhost: z.boolean().optional(),
    room: z.number().int().optional(),
    startTimeSeconds: z.number().int().optional(),
  })
  .passthrough();

export const CfSubmissionSchema = z
  .object({
    id: z.union([z.number().int(), z.string(), z.bigint()]).transform((val) => BigInt(val)),
    contestId: z.number().int().optional(),
    creationTimeSeconds: z.number().int(),
    relativeTimeSeconds: z.number().int().optional(),
    problem: CfProblemSchema,
    author: CfPartySchema,
    programmingLanguage: z.string().optional(),
    verdict: z.string().optional(),
    testset: z.string().optional(),
    passedTestCount: z.number().int().optional(),
    timeConsumedMillis: z.number().int().optional(),
    memoryConsumedBytes: z.number().int().optional(),
    points: z.number().optional(),
  })
  .passthrough();

export type CfSubmission = z.infer<typeof CfSubmissionSchema>;

export const CfUserSchema = z
  .object({
    handle: z.string(),
    email: z.string().optional(),
    vkId: z.string().optional(),
    openId: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    country: z.string().optional(),
    city: z.string().optional(),
    organization: z.string().optional(),
    contribution: z.number().int().optional(),
    rank: z.string().optional(),
    rating: z.number().int().optional(),
    maxRank: z.string().optional(),
    maxRating: z.number().int().optional(),
    lastOnlineTimeSeconds: z.number().int().optional(),
    registrationTimeSeconds: z.number().int().optional(),
    friendOfCount: z.number().int().optional(),
    avatar: z.string().optional(),
    titlePhoto: z.string().optional(),
  })
  .passthrough();

export type CfUser = z.infer<typeof CfUserSchema>;

export const CfProblemsetProblemsResultSchema = z
  .object({
    problems: z.array(CfProblemSchema),
    problemStatistics: z.array(CfProblemStatisticsSchema),
  })
  .passthrough();

export type CfProblemsetProblemsResult = z.infer<typeof CfProblemsetProblemsResultSchema>;

export function cfResponseSchema<T extends z.ZodTypeAny>(resultSchema: T) {
  return z
    .object({
      status: z.enum(['OK', 'FAILED']),
      comment: z.string().optional(),
      result: resultSchema.optional(),
    })
    .passthrough();
}

export type PriorityLane = 'high' | 'normal' | 'low';
