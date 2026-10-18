import { z } from 'zod';

export const LevelSheetDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  minRating: z.number().int(),
  maxRating: z.number().int(),
  includeTags: z.array(z.string()),
  excludeTags: z.array(z.string()),
  minSolvedCount: z.number().int(),
  questionCount: z.number().int(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  problemCount: z.number().int().optional(),
});

export type LevelSheetDto = z.infer<typeof LevelSheetDtoSchema>;

export const CreateSheetInputSchema = z.object({
  slug: z.string().min(2).max(64),
  name: z.string().min(2).max(128),
  description: z.string().default(''),
  minRating: z.number().int().min(800).max(3500),
  maxRating: z.number().int().min(800).max(3500),
  includeTags: z.array(z.string()).default([]),
  excludeTags: z.array(z.string()).default([]),
  minSolvedCount: z.number().int().default(300),
  questionCount: z.number().int().min(3).max(5).default(3),
  sortOrder: z.number().int().default(0),
});

export type CreateSheetInput = z.infer<typeof CreateSheetInputSchema>;

export const UpdateSheetInputSchema = CreateSheetInputSchema.partial();

export type UpdateSheetInput = z.infer<typeof UpdateSheetInputSchema>;
