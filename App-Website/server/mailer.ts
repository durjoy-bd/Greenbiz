import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export interface Mailer {
  /** False when no delivery is set up: features that need email say so instead of pretending. */
  configured: boolean;
  /** Shown to Super Admins under System, never including credentials. */
  description: string;
  send(message: MailMessage): Promise<void>;
}

export const disabledMailer: Mailer = {
  configured: false,
  description: 'Not configured',
  send: async () => {
    throw new Error('Email delivery is not configured');
  },
};

/**
 * Chooses delivery from the environment:
 * - SMTP_HOST set: SMTP (any provider: Brevo, Mailgun, SES, Gmail, your own server).
 * - MAIL_TRANSPORT=outbox: each message is written as JSON to MAIL_OUTBOX_DIR. Development
 *   and tests only, because the files contain working sign-in links.
 * - otherwise: disabled.
 */
export function mailerFromEnv(env: NodeJS.ProcessEnv, production: boolean): Mailer {
  const transport = env.MAIL_TRANSPORT ?? (env.SMTP_HOST ? 'smtp' : production ? 'none' : 'outbox');
  const from = env.MAIL_FROM ?? '';
  if (transport === 'none') return disabledMailer;
  if (transport === 'outbox') {
    if (production) throw new Error('MAIL_TRANSPORT=outbox writes sign-in links to disk and is not allowed in production');
    const dir = resolve(env.MAIL_OUTBOX_DIR ?? './data/outbox');
    return {
      configured: true,
      description: `Development outbox (${dir})`,
      send: async (message) => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${Date.now()}-${randomUUID()}.json`), JSON.stringify({ from: from || 'GreenBiz <no-reply@localhost>', ...message }, null, 2), { mode: 0o600 });
      },
    };
  }
  if (transport !== 'smtp') throw new Error('MAIL_TRANSPORT must be smtp, outbox or none');
  if (!env.SMTP_HOST || !from) throw new Error('SMTP delivery needs SMTP_HOST and MAIL_FROM');
  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT must be a valid port');
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465;
  const smtp = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure,
    // Port 587 must upgrade to TLS; never send credentials in clear text.
    requireTLS: !secure,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    configured: true,
    description: `SMTP ${env.SMTP_HOST}:${port}${secure ? ' (TLS)' : ' (STARTTLS)'} from ${from}`,
    send: async (message) => {
      await smtp.sendMail({ from, to: message.to, subject: message.subject, text: message.text, html: message.html });
    },
  };
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A plain branded message with an optional single button. */
function compose(to: string, subject: string, lines: string[], action?: { label: string; url: string }, footer?: string): MailMessage {
  const text = [...lines, ...(action ? ['', `${action.label}: ${action.url}`] : []), ...(footer ? ['', footer] : []), '', '— GreenBiz'].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6f2;font-family:Arial,Helvetica,sans-serif;color:#0f1f19">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dce3de">
<tr><td style="background:#0e5a43;color:#ffffff;padding:18px 24px;font-size:20px;font-weight:bold">GreenBiz</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">
${lines.map((line) => `<p style="margin:0 0 12px">${escape(line)}</p>`).join('\n')}
${action ? `<p style="margin:20px 0"><a href="${escape(action.url)}" style="display:inline-block;background:#0e5a43;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">${escape(action.label)}</a></p>
<p style="margin:0 0 12px;font-size:13px;color:#63726b">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${escape(action.url)}</span></p>` : ''}
${footer ? `<p style="margin:16px 0 0;font-size:13px;color:#63726b">${escape(footer)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
  return { to, subject, text, html };
}

const ignore = 'If you did not ask for this, you can ignore this email. Your account has not changed.';

export const mail = {
  verify: (to: string, name: string, url: string) =>
    compose(to, 'Confirm your GreenBiz email address', [`Hello${name ? ' ' + name : ''},`, 'Confirm this email address to finish setting up your GreenBiz account. The link works for 24 hours.'], { label: 'Confirm email address', url }, ignore),
  reset: (to: string, url: string, minutes: number) =>
    compose(to, 'Reset your GreenBiz password', ['Someone asked to reset the password for your GreenBiz account.', `This link works once, for ${minutes} minutes. Using it signs you out on every device.`], { label: 'Choose a new password', url }, ignore),
  invite: (to: string, name: string, url: string, hours: number) =>
    compose(to, 'Your GreenBiz bank account is ready', [`Hello${name ? ' ' + name : ''},`, 'A GreenBiz administrator created a bank account for you on this server. Choose your password to start using the lending desk.', `This link works once, for ${hours} hours.`], { label: 'Choose your password', url }),
  alreadyRegistered: (to: string, signIn: string) =>
    compose(to, 'You already have a GreenBiz account', ['Someone tried to create a GreenBiz account with this email address, but you already have one.', 'You can sign in, or reset your password from the sign-in page if you have forgotten it.'], { label: 'Sign in to GreenBiz', url: signIn }, 'If this was not you, no action is needed.'),
  changeEmail: (to: string, url: string) =>
    compose(to, 'Confirm your new GreenBiz email address', ['Confirm that you want to use this address for your GreenBiz account. The link works for 24 hours.', 'After you confirm, you will need to sign in again with this address.'], { label: 'Confirm new email address', url }, ignore),
  emailChangeRequested: (to: string, newEmail: string) =>
    compose(to, 'Your GreenBiz email address is being changed', [`A request was made to change your GreenBiz sign-in email to ${newEmail}. It only takes effect once the new address is confirmed.`, 'If this was not you, sign in and change your password now, and contact your GreenBiz administrator.']),
  test: (to: string) => compose(to, 'GreenBiz test email', ['Email delivery from your GreenBiz server works.', 'Confirmation links, password resets and invitations will be sent this way.']),
  passwordChanged: (to: string) =>
    compose(to, 'Your GreenBiz password was changed', ['The password for your GreenBiz account was just changed, and other devices were signed out.', 'If this was not you, reset your password from the sign-in page now and contact your GreenBiz administrator.']),
};
