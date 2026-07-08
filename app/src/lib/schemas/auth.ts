import { z } from "zod";
import { Email, Password, OptionalPhone, NonEmptyString } from "./primitives";

export const LoginSchema = z.object({
  email:    Email,
  password: z.string().min(1, "Password is required."),
});

export const RegisterSchema = z.object({
  id:        NonEmptyString,
  name:      NonEmptyString,
  email:     Email,
  phone:     OptionalPhone,
  password:  Password,
  createdAt: z.string().optional(),
  /** Marketing checkbox on the sign-up form (default ticked). false → the
   *  marketing contact is created unsubscribed. */
  marketingOptIn: z.boolean().optional().default(true),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword:     Password,
});

export const ResetPasswordRequestSchema = z.object({
  email: Email,
});

export const ResetPasswordConfirmSchema = z.object({
  email:    Email,
  token:    NonEmptyString,
  password: Password,
});

export const VerifyEmailSchema = z.object({
  email: Email,
  token: NonEmptyString,
});

export const ResendVerificationSchema = z.object({
  email: Email.optional(),
});

// Staff password-based logins
export const StaffPasswordLoginSchema = z.object({
  staffId:  NonEmptyString,
  password: Password,
});

// POS password login (B2): the Android tablet additionally sends a deviceId so
// the server issues a device refresh token for PIN-based re-login. The website
// omits deviceId and gets no token.
export const PosPasswordLoginSchema = StaffPasswordLoginSchema.extend({
  deviceId:    z.string().min(1).max(128).optional(),
  deviceLabel: z.string().max(64).optional(),
});

// POS device-token refresh (B2): exchange a stored device token for a fresh
// session cookie. The PIN is validated locally on the tablet, never here.
export const PosDeviceRefreshSchema = z.object({
  staffId:     NonEmptyString,
  deviceId:    z.string().min(1).max(128),
  deviceToken: z.string().min(1),
});

// Driver email/password login
export const DriverLoginSchema = z.object({
  email:    Email,
  password: z.string().min(1, "Password is required."),
});

// Admin password-only login
export const AdminLoginSchema = z.object({
  password: z.string().min(1, "Password is required."),
});

// Customer Display unlock. Password is optional: when no display password is
// set the screen auto-grants a session (the display stays open), so the login
// page POSTs with no body.
export const DisplayLoginSchema = z.object({
  password: z.string().optional(),
});

// Admin setting/changing the Customer Display password.
export const DisplayPasswordSchema = z.object({
  password: z.string().min(4, "Password must be at least 4 characters.").max(128),
});
