import { z } from 'zod';

export const LinkStartInputSchema = z.object({
  handle: z
    .string()
    .trim()
    .min(1, 'Handle is required')
    .max(32, 'Handle is too long')
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Handle contains invalid characters'),
});

export type LinkStartInput = z.infer<typeof LinkStartInputSchema>;

export const LinkStartResponseSchema = z.object({
  verificationId: z.string().uuid(),
  handle: z.string(),
  problem: z.object({
    contestId: z.number().int(),
    index: z.string(),
    url: z.string().url(),
  }),
  instructions: z.string(),
  startedAt: z.string(),
  expiresAt: z.string(),
});

export type LinkStartResponse = z.infer<typeof LinkStartResponseSchema>;

export const LinkVerifyResponseSchema = z.object({
  ok: z.literal(true),
  handle: z.string(),
  rating: z.number().int(),
});

export type LinkVerifyResponse = z.infer<typeof LinkVerifyResponseSchema>;

export const MyHandleResponseSchema = z.object({
  handle: z
    .object({
      handle: z.string(),
      verifiedAt: z.string(),
      rating: z.number().int(),
      matchesPlayed: z.number().int(),
      peakRating: z.number().int(),
    })
    .nullable(),
  pendingVerification: z
    .object({
      id: z.string().uuid(),
      handle: z.string(),
      problemContestId: z.number().int(),
      problemIndex: z.string(),
      problemUrl: z.string().url(),
      startedAt: z.string(),
      expiresAt: z.string(),
    })
    .nullable(),
});

export type MyHandleResponse = z.infer<typeof MyHandleResponseSchema>;
