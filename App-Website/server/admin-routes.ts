import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { compare, hash } from 'bcryptjs';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import QRCode from 'qrcode';
import { z } from 'zod';
import { businessDate, creditScore, dashboard } from '../shared/domain';
import { creditProfile } from '../shared/credit-profile';
import { accessRoles, can, grantedPermissions, isStaff, roleLabels, statusLabels, type AccessRole, type AccountStatus, type Permission } from '../shared/permissions';
import type { Offer, Workspace } from '../shared/types';
import { ApiError } from './errors';
import { type Accounts, type AccountRow, ACCOUNT_COLUMNS, coarseNetwork, newToken, requestInfo, statusMessages, tokenHash, TTL } from './accounts';
import { mail, mailerFromEnv, type Mailer } from './mailer';
import { readWorkspace, transaction } from './store';
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp';
import { emailSchema, fullNameSchema, passwordSchema, phoneSchema, shortText } from './validation';
import { savedSmtp, smtpMailer, smtpSchema, writeSetting, type liveMailer, type RuntimeSettings } from './settings';

/**
 * The admin panel. Administrators are ordinary accounts with an Admin or Super Admin role.
 * The panel has its own cookie (scoped to /api/admin, SameSite=Strict, at most 12 hours),
 * opened only after the password and an authenticator code. Every permission is checked
 * here on the server, and every privileged change is written to the append-only audit trail.
 */
interface AdminContext {
  db: DatabaseSync;
  now: () => Date;
  accounts: Accounts;
  mailer: Mailer;
  secureCookies: boolean;
  ttl: number;
  dbPath: string;
  publicOrigin: string;
  aiConfigured: boolean;
  /** Live settings; edits here apply to every route at once. */
  settings: RuntimeSettings;
  /** The environment's values, shown so a Super Admin can return to them. */
  defaults: RuntimeSettings;
  mail: ReturnType<typeof liveMailer>;
  production: boolean;
}
type Staff = AccountRow & { session_hash: string };
interface AuditEntry {
  action: string;
  targetType: 'user' | 'shop' | 'system';
  target: string;
  detail: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  outcome?: 'success' | 'failure';
}
const COOKIE = 'greenbiz_admin';
const dummyHash = hash(randomBytes(32).toString('hex'), 12);
const idParam = z.object({ id: z.string().min(1).max(128) }).strict();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');
const page = { page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(5).max(100).default(25) };
const reasonSchema = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(500);
const loginLimit = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };
/** Dhaka has no daylight saving: a calendar day there is a fixed UTC window. */
const dayStart = (date: string) => new Date(`${date}T00:00:00+06:00`).toISOString();
const dayAfter = (date: string) => new Date(new Date(`${date}T00:00:00+06:00`).getTime() + 86_400_000).toISOString();
const addDays = (date: string, days: number) => businessDate(new Date(new Date(`${date}T12:00:00+06:00`).getTime() + days * 86_400_000));
const like = (text: string) => '%' + text.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
/** Events worth showing on the dashboard; routine sign-ins and record edits are left to the activity log. */
const significant = ['account.register', 'auth.email_verified', 'auth.password_reset', 'auth.email_changed', 'account.delete', 'account.status', 'account.role', 'shop.create', 'shop.delete', 'offer.create', 'offer.interest', 'auth.mfa_enabled'];

/** Ten one-time recovery codes such as K7QM-2XWP, for an administrator who loses their phone. */
function recoveryCodes(): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 10 }, () => Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + alphabet[randomInt(alphabet.length)]).join(''));
}
const normaliseRecovery = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Creates a Super Admin from the server's command line; used for the very first administrator. */
export async function createSuperAdmin(db: DatabaseSync, input: { email: string; password: string; name?: string; demo?: boolean }, createdAt: string) {
  const email = emailSchema.parse(input.email);
  // A demo account may use a short shared password, but never a trivially short one.
  const password = input.demo ? z.string().min(8, 'Use at least 8 characters').max(72).parse(input.password) : passwordSchema.parse(input.password);
  const passwordHash = await hash(password, 12);
  const id = randomUUID();
  return transaction(db, () => {
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new Error('An account with this email already exists. Use promote-super-admin instead.');
    // The operator typed this address on the server, so it counts as confirmed.
    db.prepare("INSERT INTO users(id,email,password_hash,role,created_at,full_name,access_role,status,must_verify,email_verified_at,password_changed_at,mfa_exempt) VALUES(?,?,?,'merchant',?,?,'super_admin','active',0,?,?,?)").run(
      id,
      email,
      passwordHash,
      createdAt,
      (input.name ?? '').trim().slice(0, 100),
      createdAt,
      createdAt,
      input.demo ? 1 : 0,
    );
    systemAudit(db, 'account.create_super_admin', id, `Created Super Admin ${email} from the server command line${input.demo ? ' as a DEMO account without two-step verification' : ''}`, createdAt);
    return { id, email };
  });
}
/** Grants Super Admin to an existing account from the command line (recovery when none is left). */
export function promoteSuperAdmin(db: DatabaseSync, address: string, at: string, force = false) {
  const email = emailSchema.parse(address);
  return transaction(db, () => {
    const user = db.prepare('SELECT id,access_role FROM users WHERE email=?').get(email) as { id: string; access_role: AccessRole } | undefined;
    if (!user) throw new Error('No account uses this email.');
    const active = (db.prepare("SELECT COUNT(*) AS count FROM users WHERE access_role='super_admin' AND status='active'").get() as { count: number }).count;
    if (active > 0 && !force) throw new Error('An active Super Admin already exists. Ask them to change the role in the admin panel, or pass --force.');
    db.prepare("UPDATE users SET access_role='super_admin',status='active',status_reason='',status_changed_at=? WHERE id=?").run(at, user.id);
    db.prepare("UPDATE migration_review SET resolved_at=? WHERE kind='administrator_not_merged' AND resolved_at IS NULL AND detail LIKE ?").run(at, `%${email}%`);
    systemAudit(db, 'account.role', user.id, `Granted Super Admin to ${email} from the server command line`, at, { accessRole: user.access_role }, { accessRole: 'super_admin' });
    return { id: user.id, email };
  });
}
/** Clears an administrator's authenticator so they enrol again at their next admin sign-in. */
export function resetAdminMfa(db: DatabaseSync, address: string, at: string) {
  const email = emailSchema.parse(address);
  return transaction(db, () => {
    const user = db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string } | undefined;
    if (!user) throw new Error('No account uses this email.');
    db.prepare('UPDATE users SET mfa_secret=NULL,mfa_enabled_at=NULL,mfa_last_step=NULL WHERE id=?').run(user.id);
    db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id=?').run(user.id);
    db.prepare('DELETE FROM staff_sessions WHERE user_id=?').run(user.id);
    systemAudit(db, 'account.mfa_reset', user.id, `Reset two-step verification for ${email} from the server command line`, at);
    return { id: user.id, email };
  });
}
function systemAudit(db: DatabaseSync, action: string, target: string, detail: string, at: string, before?: unknown, after?: unknown) {
  db.prepare('INSERT INTO admin_audit(id,admin_id,admin_email,action,target,detail,created_at,target_type,before_state,after_state,outcome) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    randomUUID(),
    'system',
    'server command line',
    action,
    target,
    detail,
    at,
    'user',
    before === undefined ? null : JSON.stringify(before),
    after === undefined ? null : JSON.stringify(after),
    'success',
  );
}

/** One shop's headline figures, computed from its workspace document. */
function shopSummary(w: Workspace, now: Date) {
  const d = dashboard(w, now);
  const score = creditScore(w, now);
  const lastActivity = w.activity[w.activity.length - 1]?.createdAt ?? w.shop.createdAt;
  return {
    name: w.shop.name,
    owner: w.shop.owner,
    location: w.shop.location,
    phone: w.shop.phone,
    createdAt: w.shop.createdAt,
    lastActivity,
    products: w.products.length,
    lowStock: d.lowProducts.length,
    stockValue: d.stockValue,
    salesCount: w.sales.length,
    totalSales: Math.round(w.sales.reduce((sum, sale) => sum + sale.total * 100, 0)) / 100,
    monthSales: d.monthSales,
    todaySales: d.todaySales,
    transactions: (w.transactions ?? []).length,
    paymentsToReview: d.reviewPayments.length,
    indicator: score.value,
    creditProfile: creditProfile(w, now).score,
    shareScore: w.shop.shareScore,
    version: w.version,
  };
}

export function registerAdmin(app: FastifyInstance, ctx: AdminContext) {
  const { db, now, accounts } = ctx;
  const started = Date.now();
  const nowIso = () => now().toISOString();
  const staffTtl = Math.min(ctx.ttl, 60 * 60 * 12);

  function authenticate(request: FastifyRequest, permission: Permission = 'admin.access'): Staff {
    const raw = request.cookies[COOKIE];
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) throw new ApiError(401, 'Sign in to the admin panel.', 'admin_signin');
    const sessionHash = tokenHash(raw);
    const row = db
      .prepare(`SELECT ${ACCOUNT_COLUMNS.split(',').map((c) => 'u.' + c).join(',')}, s.last_seen_at FROM staff_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`)
      .get(sessionHash, now().getTime()) as (AccountRow & { last_seen_at: number | null }) | undefined;
    if (!row) throw new ApiError(401, 'Sign in to the admin panel.', 'admin_signin');
    // A role or status change takes effect on the very next request.
    if (row.status !== 'active' || !isStaff(row.access_role)) {
      db.prepare('DELETE FROM staff_sessions WHERE token_hash=?').run(sessionHash);
      throw new ApiError(401, 'Sign in to the admin panel.', 'admin_signin');
    }
    if (!can(row.access_role, permission)) throw new ApiError(403, 'Your role does not allow this. Ask a Super Admin if you need access.', 'forbidden');
    if (accounts.shouldTouch(row.last_seen_at)) {
      db.prepare('UPDATE staff_sessions SET last_seen_at=? WHERE token_hash=?').run(now().getTime(), sessionHash);
      accounts.markActive(row.id);
    }
    const { last_seen_at: _seen, ...account } = row;
    return { ...account, session_hash: sessionHash };
  }
  function audit(admin: Pick<AccountRow, 'id' | 'email'>, entry: AuditEntry, request?: FastifyRequest) {
    db.prepare(
      'INSERT INTO admin_audit(id,admin_id,admin_email,action,target,detail,created_at,target_type,reason,before_state,after_state,outcome,network) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      randomUUID(),
      admin.id,
      admin.email,
      entry.action,
      entry.target,
      entry.detail.slice(0, 500),
      nowIso(),
      entry.targetType,
      (entry.reason ?? '').slice(0, 500),
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.outcome ?? 'success',
      request ? coarseNetwork(request.ip) : '',
    );
  }
  /** Runs a privileged change in one transaction; a refusal is still written to the audit trail. */
  function guarded<T>(admin: Staff, request: FastifyRequest, entry: AuditEntry, work: () => T): T {
    try {
      return transaction(db, work);
    } catch (error) {
      if (error instanceof ApiError) audit(admin, { ...entry, outcome: 'failure', detail: `${entry.detail} — refused: ${error.message}` }, request);
      throw error;
    }
  }
  function issue(request: FastifyRequest, reply: FastifyReply, userId: string) {
    const token = newToken();
    const at = now().getTime();
    const info = requestInfo(request);
    db.prepare('DELETE FROM staff_sessions WHERE expires_at<=?').run(at);
    db.prepare('INSERT INTO staff_sessions(token_hash,id,user_id,created_at,expires_at,last_seen_at,device,network) VALUES(?,?,?,?,?,?,?,?)').run(
      tokenHash(token),
      randomBytes(16).toString('hex'),
      userId,
      at,
      at + staffTtl * 1000,
      at,
      info.device,
      info.network,
    );
    accounts.markActive(userId);
    // Scoped to the admin API so it is never sent with shop-owner requests.
    reply.setCookie(COOKIE, token, { path: '/api/admin', httpOnly: true, sameSite: 'strict', secure: ctx.secureCookies, maxAge: staffTtl });
  }
  const me = (admin: AccountRow) => ({
    id: admin.id,
    email: admin.email,
    name: admin.full_name,
    accessRole: admin.access_role,
    permissions: grantedPermissions(admin.access_role),
    mfaEnabled: !!admin.mfa_enabled_at,
    mfaExempt: !!admin.mfa_exempt,
  });
  function target(id: string): AccountRow {
    const user = accounts.account(id);
    if (!user) throw new ApiError(404, 'Account not found.');
    return user;
  }
  /** Admins manage regular users; only a Super Admin may act on another administrator. */
  function assertMayManage(admin: Staff, user: AccountRow, permission: Permission) {
    if (!can(admin.access_role, permission)) throw new ApiError(403, 'Your role does not allow this. Ask a Super Admin if you need access.', 'forbidden');
    if (isStaff(user.access_role) && !can(admin.access_role, 'staff.manage')) throw new ApiError(403, 'Only a Super Admin can change an administrator account.', 'forbidden');
  }
  function assertNotSelf(admin: Staff, user: AccountRow) {
    if (admin.id === user.id) throw new ApiError(400, 'You cannot change your own role or status from the admin panel. Ask another Super Admin.', 'self');
  }
  function assertKeepsSuperAdmin(user: AccountRow) {
    if (user.access_role === 'super_admin' && user.status === 'active' && accounts.activeSuperAdmins() <= 1)
      throw new ApiError(409, 'This is the last active Super Admin. Make another account Super Admin first.', 'last_super_admin');
  }
  const userLabel = (user: Pick<AccountRow, 'email' | 'full_name'>) => (user.full_name ? `${user.full_name} (${user.email})` : user.email);
  function shopRows() {
    return db
      .prepare('SELECT s.id, s.owner_id, u.email, u.status, w.updated_at FROM shops s JOIN users u ON u.id=s.owner_id JOIN workspaces w ON w.user_id=s.id ORDER BY w.updated_at DESC, s.id')
      .all() as { id: string; owner_id: string; email: string; status: AccountStatus; updated_at: string }[];
  }
  function trackingStartedAt(): string | null {
    return (db.prepare("SELECT value FROM app_settings WHERE key='activity_tracking_started_at'").get() as { value: string } | undefined)?.value ?? null;
  }
  function range(query: unknown, defaultDays: number) {
    const parsed = z.object({ from: day.optional(), to: day.optional() }).passthrough().parse(query);
    const to = parsed.to ?? businessDate(now());
    const from = parsed.from ?? addDays(to, -(defaultDays - 1));
    if (from > to) throw new ApiError(400, 'The start date must be on or before the end date.');
    if (addDays(from, 366) <= to) throw new ApiError(400, 'Choose a range of at most one year.');
    return { from, to };
  }

  // ---- Sign-in with two-step verification -------------------------------------------------
  app.post('/api/admin/login', loginLimit, async (request, reply) => {
    const data = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password').max(256) }).strict().parse(request.body);
    accounts.assertNotLocked(data.email, request.ip);
    const user = accounts.accountByEmail(data.email);
    const valid = await compare(data.password, user?.password_hash ?? (await dummyHash));
    if (!user || !valid) {
      accounts.loginFailed(data.email, request.ip);
      if (user) accounts.record({ userId: user.id, action: 'admin.login', outcome: 'failure', description: 'Admin panel sign-in failed: incorrect password', info: requestInfo(request) });
      throw new ApiError(401, 'Invalid email or password.', 'invalid_credentials');
    }
    accounts.loginSucceeded(data.email);
    if (user.status !== 'active') throw new ApiError(403, statusMessages[user.status], 'account_' + user.status);
    if (!isStaff(user.access_role)) {
      accounts.record({ userId: user.id, action: 'admin.login', outcome: 'failure', description: 'Admin panel refused: account is not an administrator', info: requestInfo(request) });
      throw new ApiError(403, 'This account does not have access to the admin panel.', 'not_admin');
    }
    if (user.mfa_exempt) {
      // Only a demo account created on the server with --demo reaches this branch.
      transaction(db, () => {
        db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(nowIso(), user.id);
        accounts.record({ userId: user.id, action: 'admin.login', description: 'Signed in to the admin panel (demo account, no two-step verification)', info: requestInfo(request) });
        audit(user, { action: 'admin.login', targetType: 'user', target: user.id, detail: 'Signed in to the admin panel with a password only (demo account exempt from two-step verification)' }, request);
        issue(request, reply, user.id);
      });
      return { mfa: 'none', admin: me(user) };
    }
    if (user.mfa_enabled_at && user.mfa_secret) {
      const challenge = accounts.issueToken(user.id, 'mfa_challenge', TTL.mfaChallenge, JSON.stringify({ mode: 'verify' }));
      return { mfa: 'verify', challenge };
    }
    const secret = newTotpSecret();
    const url = otpauthUrl(secret, user.email);
    const challenge = accounts.issueToken(user.id, 'mfa_challenge', TTL.mfaChallenge * 2, JSON.stringify({ mode: 'setup', secret }));
    return { mfa: 'setup', challenge, secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
  });
  app.post('/api/admin/login/mfa', loginLimit, async (request, reply) => {
    const data = z.object({ challenge: z.string().max(128), code: z.string().trim().min(6, 'Enter the 6-digit code').max(20) }).strict().parse(request.body);
    const row = accounts.findToken(data.challenge, 'mfa_challenge');
    if (row.attempts >= 5) {
      accounts.consumeToken(row);
      throw new ApiError(429, 'Too many incorrect codes. Sign in again.', 'mfa_locked');
    }
    const user = accounts.account(row.user_id);
    if (!user || user.status !== 'active' || !isStaff(user.access_role)) throw new ApiError(403, 'This account does not have access to the admin panel.', 'not_admin');
    const challenge = JSON.parse(row.payload ?? '{}') as { mode: 'setup' | 'verify'; secret?: string };
    const failed = () => {
      db.prepare('UPDATE auth_tokens SET attempts=attempts+1 WHERE token_hash=?').run(row.token_hash);
      accounts.record({ userId: user.id, action: 'admin.login', outcome: 'failure', description: 'Admin panel sign-in failed: incorrect verification code', info: requestInfo(request) });
      return new ApiError(401, 'That code is not correct. Check the time on your phone and try the newest code.', 'mfa_invalid');
    };
    if (challenge.mode === 'setup') {
      const step = challenge.secret ? verifyTotp(challenge.secret, data.code, now(), null) : null;
      if (step === null) throw failed();
      const codes = recoveryCodes();
      transaction(db, () => {
        db.prepare('UPDATE users SET mfa_secret=?,mfa_enabled_at=?,mfa_last_step=?,last_login_at=? WHERE id=?').run(challenge.secret!, nowIso(), step, nowIso(), user.id);
        db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id=?').run(user.id);
        for (const code of codes) db.prepare('INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES(?,?)').run(user.id, tokenHash(normaliseRecovery(code)));
        accounts.consumeToken(row);
        accounts.record({ userId: user.id, action: 'auth.mfa_enabled', description: 'Turned on two-step verification for the admin panel', info: requestInfo(request) });
        audit(user, { action: 'admin.login', targetType: 'user', target: user.id, detail: 'Set up two-step verification and signed in to the admin panel' }, request);
        issue(request, reply, user.id);
      });
      return { admin: me(accounts.account(user.id)!), recoveryCodes: codes };
    }
    let method = 'authenticator code';
    const step = user.mfa_secret ? verifyTotp(user.mfa_secret, data.code, now(), user.mfa_last_step) : null;
    if (step === null) {
      const recovery = db.prepare('SELECT code_hash FROM mfa_recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL').get(user.id, tokenHash(normaliseRecovery(data.code))) as
        | { code_hash: string }
        | undefined;
      if (!recovery) throw failed();
      db.prepare('UPDATE mfa_recovery_codes SET used_at=? WHERE user_id=? AND code_hash=?').run(nowIso(), user.id, recovery.code_hash);
      const left = (db.prepare('SELECT COUNT(*) AS count FROM mfa_recovery_codes WHERE user_id=? AND used_at IS NULL').get(user.id) as { count: number }).count;
      method = `recovery code (${left} left)`;
    }
    transaction(db, () => {
      if (step !== null) db.prepare('UPDATE users SET mfa_last_step=? WHERE id=?').run(step, user.id);
      db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(nowIso(), user.id);
      accounts.consumeToken(row);
      accounts.record({ userId: user.id, action: 'admin.login', description: 'Signed in to the admin panel', info: requestInfo(request) });
      audit(user, { action: 'admin.login', targetType: 'user', target: user.id, detail: `Signed in to the admin panel with an ${method}` }, request);
      issue(request, reply, user.id);
    });
    return { admin: me(accounts.account(user.id)!) };
  });
  app.post('/api/admin/logout', async (request, reply) => {
    const admin = authenticate(request);
    db.prepare('DELETE FROM staff_sessions WHERE token_hash=?').run(admin.session_hash);
    accounts.record({ userId: admin.id, action: 'admin.logout', description: 'Signed out of the admin panel', info: requestInfo(request) });
    reply.clearCookie(COOKIE, { path: '/api/admin', httpOnly: true, sameSite: 'strict', secure: ctx.secureCookies });
    return { ok: true };
  });
  // Answers "who is signed in?" without an error status, so the panel stays quiet before sign-in.
  app.get('/api/admin/me', async (request) => {
    try {
      return { admin: me(authenticate(request)) };
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) return { admin: null };
      throw error;
    }
  });
  app.post('/api/admin/mfa/recovery-codes', loginLimit, async (request) => {
    const admin = authenticate(request);
    const { password } = z.object({ password: z.string().min(1).max(256) }).strict().parse(request.body);
    if (!(await compare(password, admin.password_hash))) throw new ApiError(401, 'Your password is not correct.', 'invalid_credentials');
    const codes = recoveryCodes();
    transaction(db, () => {
      db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id=?').run(admin.id);
      for (const code of codes) db.prepare('INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES(?,?)').run(admin.id, tokenHash(normaliseRecovery(code)));
      audit(admin, { action: 'admin.recovery_codes', targetType: 'user', target: admin.id, detail: 'Replaced own two-step recovery codes' }, request);
    });
    return { recoveryCodes: codes };
  });

  // ---- Dashboard -------------------------------------------------------------------------
  app.get('/api/admin/overview', async (request) => {
    authenticate(request);
    const { from, to } = range(request.query, 30);
    const start = dayStart(from);
    const end = dayAfter(to);
    const count = (sql: string, ...params: (string | number)[]) => (db.prepare(sql).get(...params) as { count: number }).count;
    const accountsSummary = db
      .prepare(
        `SELECT COUNT(*) AS total,
          SUM(email_verified_at IS NOT NULL) AS verified,
          SUM(status='active') AS active, SUM(status='suspended') AS suspended, SUM(status='deactivated') AS deactivated,
          SUM(access_role='user') AS users, SUM(access_role='admin') AS admins, SUM(access_role='super_admin') AS superAdmins,
          SUM(role='merchant') AS merchants, SUM(role='bank') AS banks,
          SUM(created_at>=? AND created_at<?) AS newInRange
        FROM users`,
      )
      .get(start, end) as Record<string, number | null>;
    const n = (key: string) => Number(accountsSummary[key] ?? 0);
    const days: string[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) days.push(date);
    const activeByDay = new Map((db.prepare('SELECT day, COUNT(*) AS count FROM user_activity_days WHERE day>=? AND day<=? GROUP BY day').all(from, to) as { day: string; count: number }[]).map((r) => [r.day, r.count]));
    const signupsByDay = new Map(
      (db.prepare("SELECT date(created_at,'+6 hours') AS day, COUNT(*) AS count FROM users WHERE created_at>=? AND created_at<? GROUP BY day").all(start, end) as { day: string; count: number }[]).map((r) => [r.day, r.count]),
    );
    const salesByDay = new Map(days.map((d) => [d, 0]));
    const business = { shops: 0, products: 0, stockValue: 0, salesCount: 0, salesInRange: 0, salesCountInRange: 0, paymentsToReview: 0, activeShops7d: 0 };
    const weekAgo = now().getTime() - 7 * 86_400_000;
    for (const row of shopRows()) {
      const w = readWorkspace(db, row.id);
      const s = shopSummary(w, now());
      business.shops++;
      business.products += s.products;
      business.stockValue += s.stockValue;
      business.salesCount += s.salesCount;
      business.paymentsToReview += s.paymentsToReview;
      if (Date.parse(s.lastActivity) >= weekAgo) business.activeShops7d++;
      for (const sale of w.sales) {
        const date = businessDate(sale.createdAt);
        if (salesByDay.has(date)) {
          salesByDay.set(date, salesByDay.get(date)! + sale.total);
          business.salesInRange += sale.total;
          business.salesCountInRange++;
        }
      }
    }
    business.stockValue = Math.round(business.stockValue * 100) / 100;
    business.salesInRange = Math.round(business.salesInRange * 100) / 100;
    const started = trackingStartedAt();
    return {
      generatedAt: nowIso(),
      timezone: 'Asia/Dhaka',
      range: { from, to },
      trackingStartedAt: started,
      accounts: {
        total: n('total'),
        newInRange: n('newInRange'),
        verified: n('verified'),
        unverified: n('total') - n('verified'),
        active: n('active'),
        suspended: n('suspended'),
        deactivated: n('deactivated'),
        byRole: { user: n('users'), admin: n('admins'), super_admin: n('superAdmins') },
        byType: { merchant: n('merchants'), bank: n('banks') },
      },
      engagement: {
        dau: activeByDay.get(to) ?? 0,
        mau: count('SELECT COUNT(DISTINCT user_id) AS count FROM user_activity_days WHERE day>? AND day<=?', addDays(to, -30), to),
        activeInRange: count('SELECT COUNT(DISTINCT user_id) AS count FROM user_activity_days WHERE day>=? AND day<=?', from, to),
        signedInNow: count('SELECT COUNT(DISTINCT user_id) AS count FROM sessions WHERE expires_at>?', now().getTime()),
        definition:
          'An account is active on a day (Dhaka time) when it makes at least one signed-in request to GreenBiz that day: opening the app, syncing, saving a record or using the admin panel. Daily active users counts the last day of the range; monthly active users counts distinct accounts active in the 30 days ending on that day.',
      },
      daily: days.map((date) => ({
        date,
        active: activeByDay.get(date) ?? 0,
        signups: signupsByDay.get(date) ?? 0,
        sales: Math.round((salesByDay.get(date) ?? 0) * 100) / 100,
        recorded: !started || date >= businessDate(started),
      })),
      recentRegistrations: (
        db
          .prepare('SELECT id,email,full_name,role,status,email_verified_at,created_at FROM users ORDER BY created_at DESC, id LIMIT 8')
          .all() as { id: string; email: string; full_name: string; role: string; status: string; email_verified_at: string | null; created_at: string }[]
      ).map((u) => ({ id: u.id, email: u.email, name: u.full_name, type: u.role, status: u.status, verified: !!u.email_verified_at, createdAt: u.created_at })),
      recentActivity: db
        .prepare(
          `SELECT e.id,e.user_id AS userId,e.action,e.outcome,e.description,e.created_at AS createdAt,u.email AS userEmail,u.full_name AS userName
          FROM activity_events e LEFT JOIN users u ON u.id=e.user_id
          WHERE e.action IN (${significant.map(() => '?').join(',')}) OR e.outcome='failure' ORDER BY e.created_at DESC, e.rowid DESC LIMIT 10`,
        )
        .all(...significant),
      business,
    };
  });

  // ---- Users -----------------------------------------------------------------------------
  const userQuery = z
    .object({
      q: z.string().trim().max(120).optional(),
      role: z.enum(['user', 'admin', 'super_admin']).optional(),
      type: z.enum(['merchant', 'bank']).optional(),
      status: z.enum(['active', 'suspended', 'deactivated']).optional(),
      verified: z.enum(['yes', 'no']).optional(),
      from: day.optional(),
      to: day.optional(),
      sort: z.enum(['name', 'email', 'created', 'lastLogin', 'lastActivity', 'status', 'role']).default('created'),
      dir: z.enum(['asc', 'desc']).default('desc'),
      ...page,
    })
    .strict();
  const sortColumns = { name: 'u.full_name COLLATE NOCASE', email: 'u.email', created: 'u.created_at', lastLogin: 'u.last_login_at', lastActivity: 'u.last_activity_at', status: 'u.status', role: 'u.access_role' };
  app.get('/api/admin/users', async (request) => {
    authenticate(request, 'users.view');
    const query = userQuery.parse(request.query);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.q) {
      where.push("(u.email LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\' OR u.organization LIKE ? ESCAPE '\\' OR u.id=? OR EXISTS (SELECT 1 FROM shops s WHERE s.owner_id=u.id AND s.name LIKE ? ESCAPE '\\'))");
      params.push(like(query.q), like(query.q), like(query.q), query.q, like(query.q));
    }
    if (query.role) {
      where.push('u.access_role=?');
      params.push(query.role);
    }
    if (query.type) {
      where.push('u.role=?');
      params.push(query.type);
    }
    if (query.status) {
      where.push('u.status=?');
      params.push(query.status);
    }
    if (query.verified) where.push(query.verified === 'yes' ? 'u.email_verified_at IS NOT NULL' : 'u.email_verified_at IS NULL');
    if (query.from) {
      where.push('u.created_at>=?');
      params.push(dayStart(query.from));
    }
    if (query.to) {
      where.push('u.created_at<?');
      params.push(dayAfter(query.to));
    }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM users u ${clause}`).get(...params) as { count: number }).count;
    const rows = db
      .prepare(
        `SELECT u.id,u.email,u.full_name,u.role,u.access_role,u.status,u.email_verified_at,u.created_at,u.last_login_at,u.last_activity_at,u.organization,u.avatar_updated_at,
          (SELECT group_concat(name, ' · ') FROM (SELECT name FROM shops WHERE owner_id=u.id ORDER BY created_at)) AS shop_names
        FROM users u ${clause} ORDER BY ${sortColumns[query.sort]} ${query.dir === 'asc' ? 'ASC' : 'DESC'}, u.id LIMIT ? OFFSET ?`,
      )
      .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as {
      id: string;
      email: string;
      full_name: string;
      role: string;
      access_role: AccessRole;
      status: AccountStatus;
      email_verified_at: string | null;
      created_at: string;
      last_login_at: string | null;
      last_activity_at: string | null;
      organization: string;
      avatar_updated_at: string | null;
      shop_names: string | null;
    }[];
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      users: rows.map((u) => ({
        id: u.id,
        name: u.full_name,
        email: u.email,
        organization: u.organization || u.shop_names || '',
        type: u.role,
        accessRole: u.access_role,
        verified: !!u.email_verified_at,
        status: u.status,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
        lastActivityAt: u.last_activity_at,
        avatarVersion: u.avatar_updated_at,
      })),
    };
  });
  app.get('/api/admin/users/:id', async (request) => {
    const admin = authenticate(request, 'users.view');
    const { id } = idParam.parse(request.params);
    const user = target(id);
    const at = now();
    const shops = (db.prepare('SELECT id FROM shops WHERE owner_id=? ORDER BY created_at,id').all(id) as { id: string }[]).map((shop) => ({ id: shop.id, ...shopSummary(readWorkspace(db, shop.id), at) }));
    const shopIds = shops.map((s) => s.id);
    const inShops = shopIds.map(() => '?').join(',');
    const invoices = shopIds.length
      ? (db.prepare(`SELECT COUNT(*) AS total, SUM(payment_id IS NOT NULL) AS claimed FROM orders WHERE user_id IN (${inShops})`).get(...shopIds) as { total: number; claimed: number | null })
      : { total: 0, claimed: 0 };
    const offersReceived = shopIds.length
      ? (db.prepare(`SELECT o.id,o.business_id,o.document,o.created_at FROM offers o WHERE o.business_id IN (${inShops}) ORDER BY o.created_at DESC LIMIT 50`).all(...shopIds) as {
          id: string;
          business_id: string;
          document: string;
          created_at: string;
        }[])
      : [];
    const offersSent = db
      .prepare('SELECT o.id,o.document,o.created_at,s.name AS business FROM offers o JOIN shops s ON s.id=o.business_id WHERE o.bank_id=? ORDER BY o.created_at DESC LIMIT 50')
      .all(id) as { id: string; document: string; created_at: string; business: string }[];
    const interests = shopIds.length ? (db.prepare(`SELECT COUNT(*) AS count FROM interests WHERE business_id IN (${inShops})`).get(...shopIds) as { count: number }).count : 0;
    const sessions = (kind: 'app' | 'admin', table: 'sessions' | 'staff_sessions') =>
      (db.prepare(`SELECT id,created_at,last_seen_at,device,network FROM ${table} WHERE user_id=? AND expires_at>? ORDER BY last_seen_at DESC`).all(id, at.getTime()) as {
        id: string;
        created_at: number;
        last_seen_at: number | null;
        device: string;
        network: string;
      }[]).map((s) => ({ id: s.id, kind, device: s.device || 'Device not recorded', network: s.network, createdAt: new Date(s.created_at).toISOString(), lastSeenAt: new Date(s.last_seen_at ?? s.created_at).toISOString() }));
    const pending = db
      .prepare("SELECT payload FROM auth_tokens WHERE user_id=? AND purpose='change_email' AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1")
      .get(id, nowIso()) as { payload: string } | undefined;
    const activity = db
      .prepare(
        'SELECT e.id,e.action,e.outcome,e.description,e.record_type AS recordType,e.record_id AS recordId,e.shop_id AS shopId,e.device,e.network,e.created_at AS createdAt,e.actor_id AS actorId,a.email AS actorEmail FROM activity_events e LEFT JOIN users a ON a.id=e.actor_id WHERE e.user_id=? ORDER BY e.created_at DESC, e.rowid DESC LIMIT 50',
      )
      .all(id);
    const activityTotal = (db.prepare('SELECT COUNT(*) AS count FROM activity_events WHERE user_id=?').get(id) as { count: number }).count;
    const history = (
      db
        .prepare('SELECT id,admin_id,admin_email,action,detail,reason,before_state,after_state,outcome,created_at FROM admin_audit WHERE target=? ORDER BY created_at DESC, rowid DESC LIMIT 100')
        .all(id) as {
        id: string;
        admin_id: string;
        admin_email: string;
        action: string;
        detail: string;
        reason: string;
        before_state: string | null;
        after_state: string | null;
        outcome: string;
        created_at: string;
      }[]
    ).map((h) => ({
      id: h.id,
      adminId: h.admin_id,
      adminEmail: h.admin_email,
      action: h.action,
      detail: h.detail,
      reason: h.reason,
      before: h.before_state ? JSON.parse(h.before_state) : null,
      after: h.after_state ? JSON.parse(h.after_state) : null,
      outcome: h.outcome,
      createdAt: h.created_at,
    }));
    audit(admin, { action: 'user.view', targetType: 'user', target: id, detail: `Viewed account ${userLabel(user)}` }, request);
    const manageable = !isStaff(user.access_role) || can(admin.access_role, 'staff.manage');
    const self = admin.id === user.id;
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        phone: user.phone,
        location: user.location,
        organization: user.organization,
        type: user.role,
        accessRole: user.access_role,
        status: user.status,
        statusReason: user.status_reason,
        statusChangedAt: user.status_changed_at,
        verified: !!user.email_verified_at,
        verifiedAt: user.email_verified_at,
        mustVerify: !!user.must_verify,
        pendingEmail: pending?.payload ?? null,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
        lastActivityAt: user.last_activity_at,
        passwordChangedAt: user.password_changed_at,
        mfaEnabled: !!user.mfa_enabled_at,
        mfaExempt: !!user.mfa_exempt,
        avatarVersion: user.avatar_updated_at,
      },
      shops,
      related: {
        invoices: invoices.total,
        invoicesWithClaims: Number(invoices.claimed ?? 0),
        interests,
        offersReceived: offersReceived.map((o) => ({ id: o.id, shopId: o.business_id, createdAt: o.created_at, ...pick(JSON.parse(o.document) as Offer) })),
        offersSent: offersSent.map((o) => ({ id: o.id, business: o.business, createdAt: o.created_at, ...pick(JSON.parse(o.document) as Offer) })),
      },
      sessions: [...sessions('app', 'sessions'), ...sessions('admin', 'staff_sessions')],
      activity: { events: activity, total: activityTotal, trackingStartedAt: trackingStartedAt(), retentionDays: ctx.settings.retentionDays },
      adminHistory: history,
      allowed: {
        edit: manageable && can(admin.access_role, 'users.edit'),
        status: manageable && !self && can(admin.access_role, 'users.status'),
        reactivateDeactivated: can(admin.access_role, 'staff.manage') && !self,
        email: manageable && can(admin.access_role, 'users.email'),
        role: !self && can(admin.access_role, 'staff.manage'),
        resetMfa: !self && isStaff(user.access_role) && can(admin.access_role, 'staff.manage'),
        delete: !self && can(admin.access_role, 'users.delete'),
        viewShops: can(admin.access_role, 'shops.view'),
      },
    };
  });
  const pick = (o: Offer) => ({ bank: o.bank, name: o.name, kind: o.kind, amount: o.amount, annualRate: o.annualRate, months: o.months });
  app.get('/api/admin/users/:id/avatar', async (request, reply) => {
    authenticate(request, 'users.view');
    const { id } = idParam.parse(request.params);
    const avatar = db.prepare('SELECT content_type,data FROM user_avatars WHERE user_id=?').get(id) as { content_type: string; data: Uint8Array } | undefined;
    if (!avatar) throw new ApiError(404, 'No profile photo.');
    reply.header('Content-Type', avatar.content_type);
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(Buffer.from(avatar.data));
  });

  app.post('/api/admin/users/:id/profile', async (request) => {
    const admin = authenticate(request, 'users.edit');
    const { id } = idParam.parse(request.params);
    const data = z.object({ fullName: fullNameSchema, phone: phoneSchema.default(''), location: shortText(160).default(''), organization: shortText(120).default(''), reason: z.string().trim().max(500).default('') }).strict().parse(request.body);
    const user = target(id);
    const fields = { name: [user.full_name, data.fullName], phone: [user.phone, data.phone], location: [user.location, data.location], organization: [user.organization, data.organization] } as const;
    const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter((key) => fields[key][0] !== fields[key][1]);
    const before = Object.fromEntries(changed.map((key) => [key, fields[key][0]]));
    const after = Object.fromEntries(changed.map((key) => [key, fields[key][1]]));
    const entry: AuditEntry = { action: 'account.profile', targetType: 'user', target: id, detail: `Edited the profile of ${userLabel(user)} (${changed.join(', ') || 'no changes'})`, reason: data.reason, before, after };
    return guarded(admin, request, entry, () => {
      assertMayManage(admin, user, 'users.edit');
      if (!changed.length) return { ok: true, changed };
      db.prepare('UPDATE users SET full_name=?,phone=?,location=?,organization=? WHERE id=?').run(data.fullName, data.phone, data.location, data.organization, id);
      audit(admin, entry, request);
      accounts.record({ userId: id, actorId: admin.id, action: 'profile.update', description: `An administrator updated the profile (${changed.join(', ')})` });
      return { ok: true, changed };
    });
  });
  app.post('/api/admin/users/:id/verification-email', async (request) => {
    const admin = authenticate(request, 'users.email');
    const { id } = idParam.parse(request.params);
    const user = target(id);
    const entry: AuditEntry = { action: 'account.verification_email', targetType: 'user', target: id, detail: `Sent an email confirmation link to ${user.email}` };
    const message = guarded(admin, request, entry, () => {
      assertMayManage(admin, user, 'users.email');
      if (user.email_verified_at) throw new ApiError(409, 'This email address is already confirmed.');
      if (!ctx.mailer.configured) throw new ApiError(503, 'Email delivery is not set up on this server, so no email was sent.', 'email_unavailable');
      const token = accounts.issueToken(id, 'verify_email', TTL.verifyEmail, user.email);
      return mail.verify(user.email, user.full_name, `${ctx.publicOrigin}/#/verify-email/${token}`);
    });
    try {
      await accounts.deliverNow(message);
    } catch (error) {
      audit(admin, { ...entry, outcome: 'failure', detail: entry.detail + ' — delivery failed' }, request);
      throw error;
    }
    audit(admin, entry, request);
    return { ok: true };
  });
  app.post('/api/admin/users/:id/password-reset-email', async (request) => {
    const admin = authenticate(request, 'users.email');
    const { id } = idParam.parse(request.params);
    const user = target(id);
    const entry: AuditEntry = { action: 'account.password_reset_email', targetType: 'user', target: id, detail: `Sent a password reset link to ${user.email} (the password itself was not viewed or changed)` };
    const message = guarded(admin, request, entry, () => {
      assertMayManage(admin, user, 'users.email');
      if (!ctx.mailer.configured) throw new ApiError(503, 'Email delivery is not set up on this server, so no email was sent.', 'email_unavailable');
      const token = accounts.issueToken(id, 'reset_password', TTL.resetPassword);
      return mail.reset(user.email, `${ctx.publicOrigin}/#/reset-password/${token}`, TTL.resetPassword / 60_000);
    });
    try {
      await accounts.deliverNow(message);
    } catch (error) {
      audit(admin, { ...entry, outcome: 'failure', detail: entry.detail + ' — delivery failed' }, request);
      throw error;
    }
    audit(admin, entry, request);
    accounts.record({ userId: id, actorId: admin.id, action: 'auth.password_reset_requested', description: 'An administrator sent a password reset link' });
    return { ok: true };
  });
  app.post('/api/admin/users/:id/status', async (request) => {
    const admin = authenticate(request, 'users.status');
    const { id } = idParam.parse(request.params);
    const data = z.object({ status: z.enum(['active', 'suspended', 'deactivated']), reason: reasonSchema }).strict().parse(request.body);
    const user = target(id);
    const verb = { active: 'Reactivated', suspended: 'Suspended', deactivated: 'Deactivated' }[data.status];
    const entry: AuditEntry = {
      action: 'account.status',
      targetType: 'user',
      target: id,
      detail: `${verb} ${userLabel(user)}`,
      reason: data.reason,
      before: { status: user.status },
      after: { status: data.status },
    };
    return guarded(admin, request, entry, () => {
      assertMayManage(admin, user, 'users.status');
      assertNotSelf(admin, user);
      if (user.status === data.status) throw new ApiError(409, `This account is already ${statusLabels[data.status].toLowerCase()}.`);
      if (user.status === 'deactivated' && !can(admin.access_role, 'staff.manage')) throw new ApiError(403, 'Only a Super Admin can reactivate a deactivated account.', 'forbidden');
      if (data.status !== 'active') assertKeepsSuperAdmin(user);
      db.prepare('UPDATE users SET status=?,status_reason=?,status_changed_at=? WHERE id=?').run(data.status, data.status === 'active' ? '' : data.reason, nowIso(), id);
      // Suspension and deactivation end every session at once, including the admin panel.
      if (data.status !== 'active') accounts.revokeAll(id);
      audit(admin, entry, request);
      accounts.record({ userId: id, actorId: admin.id, action: 'account.status', description: `Account ${verb.toLowerCase()} by an administrator` });
      return { ok: true };
    });
  });
  app.post('/api/admin/users/:id/role', async (request) => {
    const admin = authenticate(request, 'staff.manage');
    const { id } = idParam.parse(request.params);
    const data = z.object({ accessRole: z.enum(accessRoles as [AccessRole, ...AccessRole[]]), reason: reasonSchema }).strict().parse(request.body);
    const user = target(id);
    const entry: AuditEntry = {
      action: 'account.role',
      targetType: 'user',
      target: id,
      detail: `Changed the role of ${userLabel(user)} from ${roleLabels[user.access_role]} to ${roleLabels[data.accessRole]}`,
      reason: data.reason,
      before: { accessRole: user.access_role },
      after: { accessRole: data.accessRole },
    };
    return guarded(admin, request, entry, () => {
      assertNotSelf(admin, user);
      if (user.access_role === data.accessRole) throw new ApiError(409, `This account is already ${roleLabels[data.accessRole]}.`);
      if (user.access_role === 'super_admin') assertKeepsSuperAdmin(user);
      if (data.accessRole !== 'user' && user.status !== 'active') throw new ApiError(409, 'Reactivate the account before giving it an administrator role.');
      db.prepare('UPDATE users SET access_role=? WHERE id=?').run(data.accessRole, id);
      // Any open admin panel session ends; a new role starts with a fresh, MFA-checked sign-in.
      db.prepare('DELETE FROM staff_sessions WHERE user_id=?').run(id);
      audit(admin, entry, request);
      accounts.record({ userId: id, actorId: admin.id, action: 'account.role', description: `Role changed to ${roleLabels[data.accessRole]} by a Super Admin` });
      return { ok: true };
    });
  });
  app.post('/api/admin/users/:id/sign-out', async (request) => {
    const admin = authenticate(request, 'users.status');
    const { id } = idParam.parse(request.params);
    const { reason } = z.object({ reason: z.string().trim().max(500).default('') }).strict().parse(request.body ?? {});
    const user = target(id);
    const entry: AuditEntry = { action: 'account.sign_out', targetType: 'user', target: id, detail: `Signed ${userLabel(user)} out of every device`, reason };
    return guarded(admin, request, entry, () => {
      assertMayManage(admin, user, 'users.status');
      accounts.revokeAll(id);
      audit(admin, entry, request);
      accounts.record({ userId: id, actorId: admin.id, action: 'auth.session_revoked', description: 'Signed out of every device by an administrator' });
      return { ok: true };
    });
  });
  app.post('/api/admin/users/:id/reset-mfa', async (request) => {
    const admin = authenticate(request, 'staff.manage');
    const { id } = idParam.parse(request.params);
    const { reason } = z.object({ reason: reasonSchema }).strict().parse(request.body);
    const user = target(id);
    const entry: AuditEntry = { action: 'account.mfa_reset', targetType: 'user', target: id, detail: `Reset two-step verification for ${userLabel(user)}`, reason };
    return guarded(admin, request, entry, () => {
      assertNotSelf(admin, user);
      if (!user.mfa_enabled_at) throw new ApiError(409, 'Two-step verification is not set up for this account.');
      db.prepare('UPDATE users SET mfa_secret=NULL,mfa_enabled_at=NULL,mfa_last_step=NULL WHERE id=?').run(id);
      db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id=?').run(id);
      db.prepare('DELETE FROM staff_sessions WHERE user_id=?').run(id);
      audit(admin, entry, request);
      return { ok: true };
    });
  });
  app.delete('/api/admin/users/:id', async (request) => {
    const admin = authenticate(request, 'users.delete');
    const { id } = idParam.parse(request.params);
    const data = z.object({ email: emailSchema, reason: reasonSchema }).strict().parse(request.body);
    const user = target(id);
    const entry: AuditEntry = { action: 'account.delete', targetType: 'user', target: id, detail: `Deleted ${userLabel(user)} and every shop it owned`, reason: data.reason, before: { email: user.email, status: user.status, accessRole: user.access_role } };
    return guarded(admin, request, entry, () => {
      assertNotSelf(admin, user);
      if (user.email !== data.email) throw new ApiError(400, 'Type the account email exactly to confirm deletion.');
      assertKeepsSuperAdmin(user);
      accounts.record({ userId: id, actorId: admin.id, action: 'account.delete', description: 'Account deleted by a Super Admin' });
      db.prepare('DELETE FROM users WHERE id=?').run(id);
      audit(admin, entry, request);
      return { ok: true };
    });
  });
  app.post('/api/admin/banks', async (request) => {
    const admin = authenticate(request, 'banks.invite');
    const data = z.object({ email: emailSchema, fullName: shortText(100).default(''), organization: shortText(120).default('') }).strict().parse(request.body);
    if (!ctx.mailer.configured) throw new ApiError(503, 'Bank users choose their own password from an emailed invitation, but email delivery is not set up on this server.', 'email_unavailable');
    const id = randomUUID();
    // Unusable until the invited person chooses a password; nobody else ever knows it.
    const placeholder = await hash(randomBytes(32).toString('hex'), 12);
    const entry: AuditEntry = { action: 'account.invite_bank', targetType: 'user', target: id, detail: `Invited bank user ${data.email}${data.organization ? ' (' + data.organization + ')' : ''}` };
    const message = guarded(admin, request, entry, () => {
      if (db.prepare('SELECT id FROM users WHERE email=?').get(data.email)) throw new ApiError(409, 'An account with this email already exists.', 'email_taken');
      db.prepare("INSERT INTO users(id,email,password_hash,role,created_at,full_name,organization,access_role,status,must_verify) VALUES(?,?,?,'bank',?,?,?,'user','active',1)").run(
        id,
        data.email,
        placeholder,
        nowIso(),
        data.fullName,
        data.organization,
      );
      audit(admin, entry, request);
      accounts.record({ userId: id, actorId: admin.id, action: 'account.register', description: 'Bank account created by an administrator (invitation sent)' });
      const token = accounts.issueToken(id, 'reset_password', TTL.invitation);
      return mail.invite(data.email, data.fullName, `${ctx.publicOrigin}/#/reset-password/${token}`, TTL.invitation / 3_600_000);
    });
    try {
      await accounts.deliverNow(message);
    } catch {
      audit(admin, { ...entry, outcome: 'failure', detail: entry.detail + ' — invitation email failed' }, request);
      throw new ApiError(502, 'The bank account was created, but the invitation email could not be sent. Open the account and use "Send password reset email" to try again.', 'email_failed');
    }
    return { id, email: data.email };
  });

  // ---- Shops (existing GreenBiz business records) -----------------------------------------
  app.get('/api/admin/shops', async (request) => {
    authenticate(request, 'shops.view');
    const { q } = z.object({ q: z.string().trim().max(120).optional() }).strict().parse(request.query);
    const needle = q?.toLowerCase() ?? '';
    const today = now();
    const shops = shopRows()
      .map((row) => ({ id: row.id, ownerId: row.owner_id, ownerEmail: row.email, ownerSuspended: row.status !== 'active', updatedAt: row.updated_at, ...shopSummary(readWorkspace(db, row.id), today) }))
      .filter((shop) => !needle || [shop.name, shop.owner, shop.location, shop.ownerEmail, shop.phone].some((v) => v.toLowerCase().includes(needle)));
    return { shops };
  });
  app.get('/api/admin/shops/:id', async (request) => {
    const admin = authenticate(request, 'shops.view');
    const { id } = idParam.parse(request.params);
    const row = shopRows().find((shop) => shop.id === id);
    if (!row) throw new ApiError(404, 'Shop not found.');
    const workspace = readWorkspace(db, id);
    const today = now();
    const orders = (db.prepare('SELECT token,document,payment_id,created_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 200').all(id) as { token: string; document: string; payment_id: string | null; created_at: string }[]).map((order) => {
      const invoice = JSON.parse(order.document) as { customer: string; total: number };
      return { createdAt: order.created_at, customer: invoice.customer, total: invoice.total, paid: !!order.payment_id };
    });
    audit(admin, { action: 'shop.view', targetType: 'shop', target: id, detail: `Viewed the records of ${workspace.shop.name}` }, request);
    return {
      shop: { id, ownerId: row.owner_id, ownerEmail: row.email, ownerSuspended: row.status !== 'active', updatedAt: row.updated_at, ...shopSummary(workspace, today) },
      workspace,
      dashboard: dashboard(workspace, today),
      indicator: creditScore(workspace, today),
      creditProfile: creditProfile(workspace, today),
      orders,
    };
  });
  app.get('/api/admin/shops/:id/export', async (request, reply) => {
    const admin = authenticate(request, 'shops.view');
    const { id } = idParam.parse(request.params);
    if (!db.prepare('SELECT id FROM shops WHERE id=?').get(id)) throw new ApiError(404, 'Shop not found.');
    const workspace = readWorkspace(db, id);
    audit(admin, { action: 'shop.export', targetType: 'shop', target: id, detail: `Exported the records of ${workspace.shop.name}` }, request);
    reply.header('Content-Disposition', 'attachment; filename="greenbiz-shop-export.json"');
    return { application: 'GreenBiz', exportedAt: nowIso(), exportedBy: admin.email, shopId: id, workspace };
  });

  // ---- Activity log and audit trail --------------------------------------------------------
  app.get('/api/admin/activity', async (request) => {
    authenticate(request, 'activity.view');
    const query = z
      .object({ q: z.string().trim().max(120).optional(), user: z.string().trim().max(254).optional(), action: z.string().max(60).optional(), outcome: z.enum(['success', 'failure']).optional(), from: day.optional(), to: day.optional(), ...page })
      .strict()
      .parse(request.query);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.q) {
      where.push("(e.description LIKE ? ESCAPE '\\' OR e.action LIKE ? ESCAPE '\\' OR e.record_id=?)");
      params.push(like(query.q), like(query.q), query.q);
    }
    if (query.user) {
      where.push("(e.user_id=? OR e.actor_id=? OR u.email LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\')");
      params.push(query.user, query.user, like(query.user), like(query.user));
    }
    if (query.action) {
      where.push('e.action=?');
      params.push(query.action);
    }
    if (query.outcome) {
      where.push('e.outcome=?');
      params.push(query.outcome);
    }
    if (query.from) {
      where.push('e.created_at>=?');
      params.push(dayStart(query.from));
    }
    if (query.to) {
      where.push('e.created_at<?');
      params.push(dayAfter(query.to));
    }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const join = 'FROM activity_events e LEFT JOIN users u ON u.id=e.user_id LEFT JOIN users a ON a.id=e.actor_id';
    const total = (db.prepare(`SELECT COUNT(*) AS count ${join} ${clause}`).get(...params) as { count: number }).count;
    const events = db
      .prepare(
        `SELECT e.id,e.user_id AS userId,e.actor_id AS actorId,e.action,e.outcome,e.description,e.record_type AS recordType,e.record_id AS recordId,e.shop_id AS shopId,e.device,e.network,e.created_at AS createdAt,
          u.email AS userEmail,u.full_name AS userName,a.email AS actorEmail
        ${join} ${clause} ORDER BY e.created_at DESC, e.rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, query.pageSize, (query.page - 1) * query.pageSize);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      events,
      actions: (db.prepare('SELECT DISTINCT action FROM activity_events ORDER BY action').all() as { action: string }[]).map((r) => r.action),
      trackingStartedAt: trackingStartedAt(),
      retentionDays: ctx.settings.retentionDays,
    };
  });
  app.get('/api/admin/audit', async (request) => {
    authenticate(request, 'audit.view');
    const query = z
      .object({ q: z.string().trim().max(120).optional(), admin: z.string().trim().max(254).optional(), action: z.string().max(60).optional(), outcome: z.enum(['success', 'failure']).optional(), from: day.optional(), to: day.optional(), ...page })
      .strict()
      .parse(request.query);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.q) {
      where.push("(detail LIKE ? ESCAPE '\\' OR reason LIKE ? ESCAPE '\\' OR target=?)");
      params.push(like(query.q), like(query.q), query.q);
    }
    if (query.admin) {
      where.push("(admin_id=? OR admin_email LIKE ? ESCAPE '\\')");
      params.push(query.admin, like(query.admin));
    }
    if (query.action) {
      where.push('action=?');
      params.push(query.action);
    }
    if (query.outcome) {
      where.push('outcome=?');
      params.push(query.outcome);
    }
    if (query.from) {
      where.push('created_at>=?');
      params.push(dayStart(query.from));
    }
    if (query.to) {
      where.push('created_at<?');
      params.push(dayAfter(query.to));
    }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM admin_audit ${clause}`).get(...params) as { count: number }).count;
    const rows = db
      .prepare(`SELECT id,admin_id,admin_email,action,target,target_type,detail,reason,before_state,after_state,outcome,network,created_at FROM admin_audit ${clause} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as Record<string, string | null>[];
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      entries: rows.map((r) => ({
        id: r.id,
        adminId: r.admin_id,
        adminEmail: r.admin_email,
        action: r.action,
        target: r.target,
        targetType: r.target_type,
        detail: r.detail,
        reason: r.reason,
        before: r.before_state ? JSON.parse(r.before_state) : null,
        after: r.after_state ? JSON.parse(r.after_state) : null,
        outcome: r.outcome,
        network: r.network,
        createdAt: r.created_at,
      })),
      actions: (db.prepare('SELECT DISTINCT action FROM admin_audit ORDER BY action').all() as { action: string }[]).map((r) => r.action),
    };
  });

  // ---- Settings (Super Admin) -------------------------------------------------------------
  function emailSettings() {
    const smtp = savedSmtp(db);
    return {
      source: ctx.mail.mailer.source,
      configured: ctx.mailer.configured,
      description: ctx.mailer.description,
      saved: smtp ? { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user, from: smtp.from, passwordSet: !!smtp.password } : null,
    };
  }
  const settingsView = () => ({ email: emailSettings(), requireEmailVerification: ctx.settings.requireEmailVerification, retentionDays: ctx.settings.retentionDays, defaults: ctx.defaults });
  app.get('/api/admin/settings', async (request) => {
    authenticate(request, 'system.view');
    return settingsView();
  });
  app.post('/api/admin/settings', async (request) => {
    const admin = authenticate(request, 'system.view');
    const data = z.object({ requireEmailVerification: z.boolean(), retentionDays: z.number().int().min(30, 'Keep activity for at least 30 days').max(3650), reason: reasonSchema }).strict().parse(request.body);
    const before = { requireEmailVerification: ctx.settings.requireEmailVerification, retentionDays: ctx.settings.retentionDays };
    const after = { requireEmailVerification: data.requireEmailVerification, retentionDays: data.retentionDays };
    const entry: AuditEntry = { action: 'system.settings', targetType: 'system', target: 'settings', detail: 'Changed account and activity settings', reason: data.reason, before, after };
    guarded(admin, request, entry, () => {
      if (data.requireEmailVerification && !ctx.mailer.configured) throw new ApiError(409, 'Set up email delivery before requiring email confirmation, or nobody new could sign in.');
      writeSetting(db, 'auth.require_email_verification', String(data.requireEmailVerification));
      writeSetting(db, 'activity.retention_days', String(data.retentionDays));
      audit(admin, entry, request);
    });
    Object.assign(ctx.settings, after);
    return settingsView();
  });
  app.post('/api/admin/settings/email', async (request) => {
    const admin = authenticate(request, 'system.view');
    const data = smtpSchema.extend({ reason: reasonSchema }).strict().parse(request.body);
    const previous = savedSmtp(db);
    // A blank password keeps the saved one, so it never has to be shown again.
    const smtp = { host: data.host, port: data.port, secure: data.secure, user: data.user, from: data.from, password: data.password || previous?.password || '' };
    const view = (v: typeof smtp | null) => (v ? { host: v.host, port: v.port, secure: v.secure, user: v.user, from: v.from, password: v.password ? 'set' : 'none' } : { source: ctx.mail.mailer.source });
    const entry: AuditEntry = { action: 'system.email', targetType: 'system', target: 'email', detail: `Set email delivery to ${smtp.host}:${smtp.port}`, reason: data.reason, before: view(previous), after: view(smtp) };
    let next;
    try {
      next = smtpMailer(smtp, ctx.production);
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : 'These email settings are not valid.');
    }
    guarded(admin, request, entry, () => {
      writeSetting(db, 'mail.smtp', JSON.stringify(smtp));
      audit(admin, entry, request);
    });
    if (ctx.mail.mailer.source !== 'injected') ctx.mail.use(next, 'dashboard');
    return settingsView();
  });
  app.delete('/api/admin/settings/email', async (request) => {
    const admin = authenticate(request, 'system.view');
    const { reason } = z.object({ reason: reasonSchema }).strict().parse(request.body);
    const entry: AuditEntry = { action: 'system.email', targetType: 'system', target: 'email', detail: 'Removed the email settings saved in the admin panel (back to the server environment)', reason };
    guarded(admin, request, entry, () => {
      writeSetting(db, 'mail.smtp', null);
      audit(admin, entry, request);
    });
    if (ctx.mail.mailer.source === 'dashboard') ctx.mail.use(mailerFromEnvSafe(ctx.production), 'environment');
    return settingsView();
  });
  app.post('/api/admin/settings/email/test', loginLimit, async (request) => {
    const admin = authenticate(request, 'system.view');
    await accounts.deliverNow(mail.test(admin.email));
    audit(admin, { action: 'system.email_test', targetType: 'system', target: 'email', detail: `Sent a test email to ${admin.email}` }, request);
    return { ok: true, to: admin.email };
  });
  app.post('/api/admin/users/:id/mfa-exemption', async (request) => {
    const admin = authenticate(request, 'staff.manage');
    const { id } = idParam.parse(request.params);
    const { reason } = z.object({ reason: reasonSchema }).strict().parse(request.body);
    const user = target(id);
    const entry: AuditEntry = { action: 'account.mfa_required', targetType: 'user', target: id, detail: `Required two-step verification for ${userLabel(user)}`, reason, before: { mfaExempt: !!user.mfa_exempt }, after: { mfaExempt: false } };
    // Turning the exemption on is only possible from the server command line.
    return guarded(admin, request, entry, () => {
      if (!user.mfa_exempt) throw new ApiError(409, 'This account already requires two-step verification.');
      db.prepare('UPDATE users SET mfa_exempt=0 WHERE id=?').run(id);
      db.prepare('DELETE FROM staff_sessions WHERE user_id=?').run(id);
      audit(admin, entry, request);
      return { ok: true };
    });
  });

  // ---- System -----------------------------------------------------------------------------
  app.get('/api/admin/system', async (request) => {
    authenticate(request, 'system.view');
    const size = (path: string) => {
      try {
        return statSync(path).size;
      } catch {
        return 0;
      }
    };
    const memory = process.memoryUsage();
    return {
      version: process.env.GREENBIZ_VERSION ?? 'development',
      node: process.version,
      uptimeSeconds: Math.round((Date.now() - started) / 1000),
      memoryMb: Math.round(memory.rss / 1048576),
      databaseBytes: size(ctx.dbPath) + size(ctx.dbPath + '-wal'),
      publicOrigin: ctx.publicOrigin,
      transport: ctx.publicOrigin.startsWith('https:') ? 'https' : 'http',
      aiConfigured: ctx.aiConfigured,
      serverTime: nowIso(),
      email: { configured: ctx.mailer.configured, description: ctx.mailer.description },
      requireEmailVerification: ctx.settings.requireEmailVerification,
      retentionDays: ctx.settings.retentionDays,
      mfaExempt: db.prepare("SELECT id,email FROM users WHERE mfa_exempt=1 AND access_role<>'user'").all(),
      trackingStartedAt: trackingStartedAt(),
      superAdmins: accounts.activeSuperAdmins(),
      review: db.prepare('SELECT id,kind,reference,detail,created_at AS createdAt,resolved_at AS resolvedAt FROM migration_review ORDER BY resolved_at IS NOT NULL, created_at DESC').all(),
    };
  });
  app.post('/api/admin/review/:id/resolve', async (request) => {
    const admin = authenticate(request, 'system.view');
    const { id } = idParam.parse(request.params);
    const { reason } = z.object({ reason: reasonSchema }).strict().parse(request.body);
    const entry: AuditEntry = { action: 'system.review_resolved', targetType: 'system', target: id, detail: 'Marked a migration review item as resolved', reason };
    return guarded(admin, request, entry, () => {
      if (!db.prepare('UPDATE migration_review SET resolved_at=? WHERE id=? AND resolved_at IS NULL').run(nowIso(), id).changes) throw new ApiError(404, 'Review item not found or already resolved.');
      audit(admin, entry, request);
      return { ok: true };
    });
  });
}

function mailerFromEnvSafe(production: boolean): Mailer {
  try {
    return mailerFromEnv(process.env, production);
  } catch {
    return { configured: false, description: 'Not configured', send: async () => { throw new Error('Email delivery is not configured'); } };
  }
}
