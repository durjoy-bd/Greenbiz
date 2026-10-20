import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { businessDate } from '../shared/domain';
import type { AccessRole, AccountStatus } from '../shared/permissions';
import type { Session, User } from '../shared/types';
import { ApiError } from './errors';
import type { Mailer, MailMessage } from './mailer';
import type { RuntimeSettings } from './settings';

/** Everything the account, admin and business routes share about who is signed in. */
export interface AccountRow {
  id: string;
  email: string;
  role: User['role'];
  password_hash: string;
  full_name: string;
  phone: string;
  location: string;
  organization: string;
  access_role: AccessRole;
  status: AccountStatus;
  status_reason: string;
  status_changed_at: string | null;
  email_verified_at: string | null;
  must_verify: number;
  created_at: string;
  last_login_at: string | null;
  last_activity_at: string | null;
  password_changed_at: string | null;
  mfa_secret: string | null;
  mfa_enabled_at: string | null;
  mfa_last_step: number | null;
  /** 1 only for a demo account created with "create-super-admin --demo". */
  mfa_exempt: number;
  avatar_updated_at: string | null;
}
export type SignedIn = AccountRow & { session_hash: string; session_id: string };
export interface RequestInfo {
  device: string;
  network: string;
}
export type TokenPurpose = 'verify_email' | 'reset_password' | 'change_email' | 'mfa_challenge';
export interface TokenRow {
  token_hash: string;
  user_id: string;
  purpose: TokenPurpose;
  payload: string | null;
  attempts: number;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}
export interface ActivityInput {
  userId: string | null;
  actorId?: string | null;
  action: string;
  description: string;
  outcome?: 'success' | 'failure';
  recordType?: string;
  recordId?: string;
  shopId?: string;
  info?: RequestInfo;
}

export const ACCOUNT_COLUMNS =
  'id,email,role,password_hash,full_name,phone,location,organization,access_role,status,status_reason,status_changed_at,email_verified_at,must_verify,created_at,last_login_at,last_activity_at,password_changed_at,mfa_secret,mfa_enabled_at,mfa_last_step,mfa_exempt,avatar_updated_at';
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');
export const isNative = (request: FastifyRequest) => request.headers['x-greenbiz-client'] === 'native';
export const statusMessages: Record<Exclude<AccountStatus, 'active'>, string> = {
  suspended: 'This account is suspended. Contact the GreenBiz administrator.',
  deactivated: 'This account has been deactivated. Contact the GreenBiz administrator.',
};

/** Token lifetimes. Reset links are short; verification links allow for slow inboxes. */
export const TTL = {
  verifyEmail: 24 * 60 * 60_000,
  changeEmail: 24 * 60 * 60_000,
  resetPassword: 30 * 60_000,
  invitation: 72 * 60 * 60_000,
  mfaChallenge: 5 * 60_000,
};
const LOCK = { failures: 5, perEmailFailures: 50, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };
/** A session's last-seen time is written at most this often (and always on a new Dhaka day). */
const TOUCH_MS = 5 * 60_000;
/** Each kind of email can be requested this many times per account per hour. */
const EMAILS_PER_HOUR = 3;

/** "Chrome on Android": enough to recognise a device, nothing that fingerprints it. */
export function describeDevice(request: FastifyRequest): string {
  if (isNative(request)) return 'GreenBiz Android app';
  const ua = String(request.headers['user-agent'] ?? '');
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
/** The network, not the device: IPv4 to /24 and IPv6 to /48. */
export function coarseNetwork(ip: string | undefined): string {
  if (!ip) return '';
  const v4 = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
  if (ip.includes(':')) {
    const groups = ip.split('::')[0].split(':').filter(Boolean).slice(0, 3);
    return groups.length ? `${groups.join(':')}::/48` : '';
  }
  return '';
}
export const requestInfo = (request: FastifyRequest): RequestInfo => ({ device: describeDevice(request), network: coarseNetwork(request.ip) });

export function publicUser(row: Pick<AccountRow, 'id' | 'email' | 'role' | 'full_name' | 'access_role' | 'email_verified_at'>): User {
  return { id: row.id, email: row.email, role: row.role, name: row.full_name, accessRole: row.access_role, emailVerified: !!row.email_verified_at };
}

export interface AccountsContext {
  db: DatabaseSync;
  now: () => Date;
  ttl: number;
  secureCookies: boolean;
  nativeOrigins: Set<string>;
  mailer: Mailer;
  /** Read on every use, so changes saved in the admin panel apply at once. */
  settings: RuntimeSettings;
}

export function createAccounts(ctx: AccountsContext) {
  const { db, now } = ctx;
  const nowIso = () => now().toISOString();

  function account(id: string): AccountRow | undefined {
    return db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM users WHERE id=?`).get(id) as AccountRow | undefined;
  }
  function accountByEmail(email: string): AccountRow | undefined {
    return db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM users WHERE email=?`).get(email) as AccountRow | undefined;
  }

  function record(event: ActivityInput): void {
    db.prepare(
      'INSERT INTO activity_events(id,user_id,actor_id,action,outcome,description,record_type,record_id,shop_id,device,network,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      randomUUID(),
      event.userId,
      event.actorId === undefined ? event.userId : event.actorId,
      event.action,
      event.outcome ?? 'success',
      event.description.slice(0, 300),
      event.recordType ?? null,
      event.recordId ?? null,
      event.shopId ?? null,
      event.info?.device.slice(0, 80) ?? '',
      event.info?.network.slice(0, 60) ?? '',
      nowIso(),
    );
  }

  /** Counts one signed-in use towards "last activity" and today's active users. */
  function markActive(userId: string): void {
    const at = now();
    db.prepare('UPDATE users SET last_activity_at=? WHERE id=?').run(at.toISOString(), userId);
    db.prepare('INSERT OR IGNORE INTO user_activity_days(day,user_id) VALUES(?,?)').run(businessDate(at), userId);
  }
  function shouldTouch(lastSeen: number | null): boolean {
    const at = now();
    return !lastSeen || at.getTime() - lastSeen > TOUCH_MS || businessDate(new Date(lastSeen)) !== businessDate(at);
  }

  function authenticate(request: FastifyRequest, role?: User['role']): SignedIn {
    const authorization = request.headers.authorization;
    const raw = authorization ? /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1] : request.cookies.greenbiz_session;
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) throw new ApiError(401, 'Sign in to continue.');
    // Native webview origins are never permitted to authenticate using a web cookie.
    if (request.headers.origin && ctx.nativeOrigins.has(request.headers.origin) && !authorization) throw new ApiError(403, 'Native clients must use bearer authentication.');
    const sessionHash = tokenHash(raw);
    const row = db
      .prepare(`SELECT ${ACCOUNT_COLUMNS.split(',').map((c) => 'u.' + c).join(',')}, s.id AS session_id, s.last_seen_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`)
      .get(sessionHash, now().getTime()) as (AccountRow & { session_id: string; last_seen_at: number | null }) | undefined;
    if (!row) throw new ApiError(401, 'Sign in to continue.');
    if (row.status !== 'active') throw new ApiError(403, statusMessages[row.status], 'account_' + row.status);
    if (role && row.role !== role) throw new ApiError(403, 'This account cannot access this resource.', 'forbidden');
    if (shouldTouch(row.last_seen_at)) {
      db.prepare('UPDATE sessions SET last_seen_at=? WHERE token_hash=?').run(now().getTime(), sessionHash);
      markActive(row.id);
    }
    const { last_seen_at: _seen, ...account } = row;
    return { ...account, session_hash: sessionHash };
  }

  function issueSession(request: FastifyRequest, reply: FastifyReply, user: AccountRow): Session {
    const token = newToken();
    const at = now().getTime();
    const info = requestInfo(request);
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(at);
    db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,id,last_seen_at,device,network) VALUES(?,?,?,?,?,?,?,?)').run(
      tokenHash(token),
      user.id,
      at,
      at + ctx.ttl * 1000,
      randomBytes(16).toString('hex'),
      at,
      info.device,
      info.network,
    );
    markActive(user.id);
    const fresh = account(user.id) ?? user;
    if (isNative(request)) return { user: publicUser(fresh), token };
    reply.setCookie('greenbiz_session', token, { path: '/', httpOnly: true, sameSite: 'strict', secure: ctx.secureCookies, maxAge: ctx.ttl });
    return { user: publicUser(fresh) };
  }
  function clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie('greenbiz_session', { path: '/', httpOnly: true, sameSite: 'strict', secure: ctx.secureCookies });
  }
  /** Signs an account out everywhere: app sessions and admin panel sessions. */
  function revokeAll(userId: string): void {
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM staff_sessions WHERE user_id=?').run(userId);
  }

  function issueToken(userId: string, purpose: TokenPurpose, lifetimeMs: number, payload: string | null = null): string {
    const token = newToken();
    const at = now();
    db.prepare('INSERT INTO auth_tokens(token_hash,user_id,purpose,payload,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(
      tokenHash(token),
      userId,
      purpose,
      payload,
      at.toISOString(),
      new Date(at.getTime() + lifetimeMs).toISOString(),
    );
    return token;
  }
  /** Too many emails of one kind this hour: callers decide whether to say so or stay silent. */
  function emailQuotaReached(userId: string, purpose: TokenPurpose): boolean {
    const since = new Date(now().getTime() - 60 * 60_000).toISOString();
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM auth_tokens WHERE user_id=? AND purpose=? AND created_at>?').get(userId, purpose, since) as { count: number };
    return count >= EMAILS_PER_HOUR;
  }
  function findToken(token: unknown, purpose: TokenPurpose): TokenRow {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError(400, 'This link is not valid. Request a new one.', 'link_invalid');
    const row = db.prepare('SELECT * FROM auth_tokens WHERE token_hash=? AND purpose=?').get(tokenHash(token), purpose) as TokenRow | undefined;
    if (!row) throw new ApiError(400, 'This link is not valid. Request a new one.', 'link_invalid');
    if (row.used_at) throw new ApiError(410, 'This link has already been used, or a newer one was sent. Request a new one if you still need it.', 'link_used');
    if (row.expires_at <= nowIso()) throw new ApiError(410, 'This link has expired. Request a new one.', 'link_expired');
    return row;
  }
  /** Uses a token and retires every other unused token of the same kind for that account. */
  function consumeToken(row: TokenRow): void {
    db.prepare('UPDATE auth_tokens SET used_at=? WHERE user_id=? AND purpose=? AND used_at IS NULL').run(nowIso(), row.user_id, row.purpose);
  }

  /**
   * Wrong passwords are counted per email and client address, so a stranger guessing at
   * someone's email locks out only their own address, not the owner. A much higher limit
   * per email bounds guessing spread across many addresses. Both apply whether or not
   * the email has an account. Keys are hashes, so no typed email is stored.
   */
  const accountKey = (email: string) => tokenHash('login:' + email.toLowerCase());
  const keys = (email: string, ip: string) => [
    { key: `${accountKey(email)}:${tokenHash('ip:' + ip).slice(0, 16)}`, limit: LOCK.failures },
    { key: accountKey(email), limit: LOCK.perEmailFailures },
  ];
  function assertNotLocked(email: string, ip: string): void {
    for (const { key } of keys(email, ip)) {
      const row = db.prepare('SELECT locked_until FROM login_throttle WHERE key=?').get(key) as { locked_until: number | null } | undefined;
      if (row?.locked_until && row.locked_until > now().getTime()) {
        const minutes = Math.ceil((row.locked_until - now().getTime()) / 60_000);
        throw new ApiError(429, `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password.`, 'locked');
      }
    }
  }
  function loginFailed(email: string, ip: string): void {
    const at = now().getTime();
    for (const { key, limit } of keys(email, ip)) {
      const row = db.prepare('SELECT failures,window_started_at FROM login_throttle WHERE key=?').get(key) as { failures: number; window_started_at: number } | undefined;
      const fresh = !row || at - row.window_started_at > LOCK.windowMs;
      const failures = fresh ? 1 : row.failures + 1;
      db.prepare('INSERT INTO login_throttle(key,failures,window_started_at,locked_until) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,window_started_at=excluded.window_started_at,locked_until=excluded.locked_until').run(
        key,
        failures,
        fresh ? at : row.window_started_at,
        failures >= limit ? at + LOCK.lockMs : null,
      );
    }
  }
  /** A correct password or a completed reset clears every lock on that email. */
  function loginSucceeded(email: string): void {
    const key = accountKey(email);
    db.prepare("DELETE FROM login_throttle WHERE key=? OR key LIKE ? || ':%'").run(key, key);
  }

  /** Sends without making the caller wait or revealing whether the address has an account. */
  function deliverInBackground(message: MailMessage): void {
    if (!ctx.mailer.configured) return;
    void ctx.mailer.send(message).catch(() => process.stderr.write(`GreenBiz could not deliver an email ("${message.subject}"). Check the SMTP settings.\n`));
  }
  /** Sends and reports failure, for actions where the person needs to know it worked. */
  async function deliverNow(message: MailMessage): Promise<void> {
    if (!ctx.mailer.configured) throw new ApiError(503, 'Email delivery is not set up on this server, so no email was sent. Ask the server operator to configure SMTP.', 'email_unavailable');
    try {
      await ctx.mailer.send(message);
    } catch {
      throw new ApiError(502, 'The email could not be sent. Try again later, or ask the server operator to check the email settings.', 'email_failed');
    }
  }

  function activeSuperAdmins(): number {
    return (db.prepare("SELECT COUNT(*) AS count FROM users WHERE access_role='super_admin' AND status='active'").get() as { count: number }).count;
  }

  /** Removes data past its retention period. Safe to run at any time. */
  function prune(): void {
    const at = now();
    const cutoff = new Date(at.getTime() - ctx.settings.retentionDays * 86_400_000);
    db.prepare('DELETE FROM activity_events WHERE created_at<?').run(cutoff.toISOString());
    db.prepare('DELETE FROM user_activity_days WHERE day<?').run(businessDate(cutoff));
    // Expired links are kept a week so an old link still explains that it expired.
    db.prepare('DELETE FROM auth_tokens WHERE expires_at<?').run(new Date(at.getTime() - 7 * 86_400_000).toISOString());
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(at.getTime());
    db.prepare('DELETE FROM staff_sessions WHERE expires_at<=?').run(at.getTime());
    db.prepare('DELETE FROM login_throttle WHERE window_started_at<? AND (locked_until IS NULL OR locked_until<?)').run(at.getTime() - LOCK.windowMs, at.getTime());
  }

  return {
    account,
    accountByEmail,
    record,
    markActive,
    shouldTouch,
    authenticate,
    issueSession,
    clearSessionCookie,
    revokeAll,
    issueToken,
    emailQuotaReached,
    findToken,
    consumeToken,
    assertNotLocked,
    loginFailed,
    loginSucceeded,
    deliverInBackground,
    deliverNow,
    activeSuperAdmins,
    prune,
  };
}
export type Accounts = ReturnType<typeof createAccounts>;
