import { z } from 'zod';
export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes').refine(value => [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(pattern => pattern.test(value)).length >= 3, 'Use at least three of lowercase, uppercase, numbers and symbols');
export const amountSchema = z.number().finite().min(0).max(1_000_000_000).transform(value => Math.round((value + Number.EPSILON) * 100) / 100);
export const shortText = (max: number) => z.string().trim().max(max);
export const trxSchema = z.string().regex(/^[A-Z0-9]{10}$/, 'Transaction ID must be 10 uppercase letters or digits');
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password').max(256) }).strict();
export const fullNameSchema = shortText(100).min(1, 'Enter your full name');
export const phoneSchema = shortText(30).regex(/^[0-9+()\-\s]*$/, 'Use digits, spaces and + ( ) - only');
/** Optional on the wire (older apps do not send it); when sent it must match. */
const confirmation = <T extends { password: string; confirmPassword?: string }>(data: T, context: z.RefinementCtx) => {
  if (data.confirmPassword !== undefined && data.confirmPassword !== data.password) context.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword'], message: 'Passwords do not match' });
};
export const registerSchema = z.object({
  fullName: fullNameSchema.optional(),
  email: emailSchema,
  password: passwordSchema,
  confirmPassword: z.string().max(256).optional(),
  shopName: shortText(100).min(1, 'Enter your shop or business name'),
  location: shortText(200).default(''),
  phone: shortText(30).default(''),
  bkash: shortText(30).default(''),
  /** Older apps send the owner's name here. */
  owner: shortText(100).optional(),
  /** Hidden from people; automated sign-ups fill it in. */
  website: z.string().max(0, 'Leave this field empty').optional(),
}).strict().superRefine(confirmation);
export const newPasswordSchema = z.object({ current: z.string().min(1, 'Enter your current password').max(256), password: passwordSchema, confirmPassword: z.string().max(256).optional() }).strict().superRefine(confirmation);
export const resetSchema = z.object({ token: z.string().max(128), password: passwordSchema, confirmPassword: z.string().max(256).optional() }).strict().superRefine(confirmation);
export const profileSchema = z.object({ fullName: fullNameSchema, phone: phoneSchema.default(''), location: shortText(160).default(''), organization: shortText(120).default('') }).strict();
export const tokenSchema = z.object({ token: z.string().max(128) }).strict();
