import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { mailerFromEnv, type Mailer } from './mailer';

/**
 * Settings a Super Admin can change from the admin panel. Environment variables give the
 * starting values; a value saved in the panel takes precedence and applies immediately.
 * Saved values (including the SMTP password) live only in the server database.
 */
export interface RuntimeSettings {
  requireEmailVerification: boolean;
  retentionDays: number;
}
export const smtpSchema = z
  .object({
    host: z.string().trim().min(1, 'Enter the SMTP server').max(253).regex(/^[A-Za-z0-9.-]+$/, 'Use a host name such as smtp.example.com'),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string().trim().max(254).default(''),
    password: z.string().max(512).optional(),
    from: z.string().trim().min(3, 'Enter the sender, such as GreenBiz <no-reply@example.com>').max(254),
  })
  .strict();
export type SmtpSettings = z.infer<typeof smtpSchema> & { password: string };

const read = (db: DatabaseSync, key: string) => (db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as { value: string } | undefined)?.value;
export const writeSetting = (db: DatabaseSync, key: string, value: string | null) =>
  value === null ? db.prepare('DELETE FROM app_settings WHERE key=?').run(key) : db.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);

export function savedSmtp(db: DatabaseSync): SmtpSettings | null {
  const raw = read(db, 'mail.smtp');
  return raw ? (JSON.parse(raw) as SmtpSettings) : null;
}
export function loadRuntimeSettings(db: DatabaseSync, defaults: RuntimeSettings): RuntimeSettings {
  const verification = read(db, 'auth.require_email_verification');
  const retention = Number(read(db, 'activity.retention_days'));
  return {
    requireEmailVerification: verification === undefined ? defaults.requireEmailVerification : verification === 'true',
    retentionDays: Number.isInteger(retention) && retention >= 30 && retention <= 3650 ? retention : defaults.retentionDays,
  };
}

/** A mailer whose delivery can be switched while the server runs. */
export function liveMailer(initial: Mailer) {
  let current = initial;
  const mailer: Mailer & { source: 'dashboard' | 'environment' | 'injected' } = {
    source: 'environment',
    get configured() {
      return current.configured;
    },
    get description() {
      return current.description;
    },
    send: (message) => current.send(message),
  };
  return {
    mailer,
    use(next: Mailer, source: 'dashboard' | 'environment' | 'injected') {
      current = next;
      mailer.source = source;
    },
  };
}
export function smtpMailer(settings: SmtpSettings, production: boolean): Mailer {
  return mailerFromEnv(
    {
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: settings.host,
      SMTP_PORT: String(settings.port),
      SMTP_SECURE: String(settings.secure),
      SMTP_USER: settings.user,
      SMTP_PASSWORD: settings.password,
      MAIL_FROM: settings.from,
    },
    production,
  );
}
