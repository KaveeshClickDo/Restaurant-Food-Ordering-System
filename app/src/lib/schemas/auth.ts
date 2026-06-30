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
