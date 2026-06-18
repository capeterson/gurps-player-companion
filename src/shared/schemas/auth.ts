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

export const forgotPasswordRequest = z.object({ email });

export const resetPasswordRequest = z.object({
  token: z.string().min(1),
  newPassword: password,
});

export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequest>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequest>;

const passkeyCredentialDescriptor = z.object({
  type: z.literal('public-key'),
  id: z.string().min(1),
});

export const passkeyInfo = z.object({
  id: uuid,
  name: z.string().min(1).max(80),
  createdAt: isoTimestamp,
  lastUsedAt: isoTimestamp.nullable(),
});

export const passkeyRegistrationOptions = z.object({
  challenge: z.string().min(1),
  rp: z.object({ name: z.string(), id: z.string() }),
  user: z.object({ id: z.string(), name: email, displayName }),
  pubKeyCredParams: z.array(z.object({ type: z.literal('public-key'), alg: z.number() })),
  timeout: z.number().int().positive(),
  attestation: z.literal('none'),
  authenticatorSelection: z.object({ userVerification: z.literal('required') }),
  excludeCredentials: z.array(passkeyCredentialDescriptor),
});

export const passkeyRegistrationRequest = z.object({
  name: z.string().min(1).max(80).optional(),
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: z.string().min(1),
    attestationObject: z.string().min(1),
  }),
});

export const passkeyLoginOptionsRequest = z.object({ email: email.optional() });

export const passkeyLoginOptions = z.object({
  challenge: z.string().min(1),
  timeout: z.number().int().positive(),
  rpId: z.string().min(1),
  userVerification: z.literal('required'),
  allowCredentials: z.array(passkeyCredentialDescriptor),
});

export const passkeyLoginRequest = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: z.string().min(1),
    authenticatorData: z.string().min(1),
    signature: z.string().min(1),
    userHandle: z.string().nullable().optional(),
  }),
});

export type PasskeyInfo = z.infer<typeof passkeyInfo>;
export type PasskeyRegistrationOptions = z.infer<typeof passkeyRegistrationOptions>;
export type PasskeyRegistrationRequest = z.infer<typeof passkeyRegistrationRequest>;
export type PasskeyLoginOptionsRequest = z.infer<typeof passkeyLoginOptionsRequest>;
export type PasskeyLoginOptions = z.infer<typeof passkeyLoginOptions>;
export type PasskeyLoginRequest = z.infer<typeof passkeyLoginRequest>;
