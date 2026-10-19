import { z } from 'zod';
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes').refine(value => [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(pattern => pattern.test(value)).length >= 3, 'Use at least three of lowercase, uppercase, numbers and symbols');
export const amountSchema = z.number().finite().min(0).max(1_000_000_000).transform(value => Math.round((value + Number.EPSILON) * 100) / 100);
export const shortText = (max: number) => z.string().trim().max(max);
export const trxSchema = z.string().regex(/^[A-Z0-9]{10}$/, 'Transaction ID must be 10 uppercase letters or digits');
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(256) }).strict();
export const registerSchema = z.object({ email: emailSchema, password: passwordSchema, shopName: shortText(100).min(1), owner: shortText(100), location: shortText(200), phone: shortText(30), bkash: shortText(30) }).strict();
