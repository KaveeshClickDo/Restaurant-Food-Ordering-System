import { z } from "zod";
import { Email, Password, OptionalPhone, NonEmptyString, Pin } from "./primitives";

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

// Staff PIN-based logins
export const StaffPinLoginSchema = z.object({
  staffId: NonEmptyString,
  pin:     Pin,
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
