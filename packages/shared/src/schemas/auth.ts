import { z } from 'zod';

export const RegisterInputSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  displayName: z
    .string()
    .trim()
    .min(2, 'Display name must be at least 2 characters')
    .max(32, 'Display name must be at most 32 characters'),
});

export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof LoginInputSchema>;

export const UserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  role: z.enum(['USER', 'ADMIN']),
  createdAt: z.string(),
  handle: z
    .object({
      handle: z.string(),
      verifiedAt: z.string(),
      rating: z.number().int().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type UserDto = z.infer<typeof UserDtoSchema>;

export const AuthResponseSchema = z.object({
  user: UserDtoSchema,
});

export type AuthResponse = z.infer<typeof AuthResponseSchema>;
