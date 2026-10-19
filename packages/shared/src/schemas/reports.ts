import { z } from 'zod';

export const CreateReportInputSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Reason cannot exceed 500 characters'),
});
export type CreateReportInput = z.infer<typeof CreateReportInputSchema>;

export const UpdateReportInputSchema = z.object({
  status: z.enum(['RESOLVED', 'DISMISSED']),
});
export type UpdateReportInput = z.infer<typeof UpdateReportInputSchema>;

export const ReportDtoSchema = z.object({
  id: z.string().uuid(),
  matchId: z.string().uuid(),
  reporterId: z.string().uuid(),
  reporterDisplayName: z.string(),
  reason: z.string(),
  status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']),
  createdAt: z.string(),
  matchSummary: z
    .object({
      mode: z.enum(['RANKED', 'PRIVATE']),
      status: z.string(),
      endReason: z.string().nullable(),
      createdAt: z.string(),
      players: z.array(
        z.object({
          userId: z.string(),
          handleNorm: z.string(),
          score: z.number(),
        }),
      ),
    })
    .optional(),
});
export type ReportDto = z.infer<typeof ReportDtoSchema>;
