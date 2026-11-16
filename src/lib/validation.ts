import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email().max(254).refine(
  (email) => {
    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
    return !allowedDomain || email.endsWith(`@${allowedDomain}`);
  },
  { message: "Use your registered JSAN employee email address." },
);

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1)
    .max(72)
    .refine((password) => Buffer.byteLength(password, "utf8") <= 72),
  rememberMe: z.boolean().optional().default(false),
});

export const inviteSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  roleKey: z.enum(["REQUESTOR", "ACCOUNTS_PAYABLE", "APPROVER"]),
});

export const createEmployeeSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  roleKey: z.enum(["REQUESTOR", "ACCOUNTS_PAYABLE", "APPROVER"]),
  password: z
    .string()
    .max(72)
    .refine((password) => passwordMeetsPolicy(password), {
      message: "Use at least 12 characters with uppercase, lowercase, a number, and a symbol.",
    }),
  permissions: z.array(z.string().min(1).max(80)).max(30).optional(),
});

export const activateSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(12).max(72),
});

export const resetRequestSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = activateSchema;

export const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  timeZone: z.string().trim().min(1).max(100).refine((value) => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
  }, { message: "Choose a valid IANA time zone." }),
});

export function passwordMeetsPolicy(password: string): boolean {
  return (
    password.length >= 12 &&
    Buffer.byteLength(password, "utf8") <= 72 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^a-zA-Z0-9]/.test(password)
  );
}
