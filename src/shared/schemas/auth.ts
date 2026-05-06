import { z } from 'zod';
import { isoTimestamp, uuid } from './common.ts';

export const email = z.string().email().max(255).toLowerCase().trim();

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(256, 'Password too long');

export const displayName = z.string().min(1).max(80).trim();

export const userOut = z.object({
  id: uuid,
  email,
  displayName,
  createdAt: isoTimestamp,
  suspendedAt: isoTimestamp.nullable(),
  /** True for instance admins; gates the Admin nav link client-side. */
  isSuperuser: z.boolean(),
});

export const registerRequest = z.object({
  email,
  password,
  displayName,
});

export const loginRequest = z.object({
  email,
  password,
});

export const tokenPair = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** Seconds until access token expires. */
  accessTokenExpiresIn: z.number().int().positive(),
});

export const refreshRequest = z.object({
  refreshToken: z.string().min(1),
});

export const logoutRequest = z.object({
  refreshToken: z.string().min(1),
});

export const changePasswordRequest = z
  .object({
    currentPassword: password,
    newPassword: password,
  })
  .refine((body) => body.currentPassword !== body.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from current password',
  });

export type UserOut = z.infer<typeof userOut>;
export type RegisterRequest = z.infer<typeof registerRequest>;
export type LoginRequest = z.infer<typeof loginRequest>;
export type TokenPair = z.infer<typeof tokenPair>;
export type RefreshRequest = z.infer<typeof refreshRequest>;
export type LogoutRequest = z.infer<typeof logoutRequest>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequest>;
