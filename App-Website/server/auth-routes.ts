import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { compare, hash } from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createWorkspace } from '../shared/domain';
import { ApiError } from './errors';
import { type Accounts, type AccountRow, publicUser, requestInfo, TTL } from './accounts';
import { dataUrl, parseImageDataUrl } from './images';
import { mail, type Mailer } from './mailer';
import type { RuntimeSettings } from './settings';
import { transaction } from './store';
import { emailSchema, loginSchema, newPasswordSchema, profileSchema, registerSchema, resetSchema, tokenSchema } from './validation';

interface AuthContext {
  db: DatabaseSync;
  now: () => Date;
  accounts: Accounts;
  mailer: Mailer;
  publicOrigin: string;
  settings: RuntimeSettings;
  authLimit: { config: { rateLimit: { max: number; timeWindow: string } } };
}
const dummyHash = hash(randomBytes(32).toString('hex'), 12);
const linkLimit = { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } };
const sessionId = z.object({ id: z.string().regex(/^[a-f0-9]{32}$/) }).strict();
/** r•••@example.com: enough to recognise your own address on a reset page. */
const maskEmail = (email: string) => email.replace(/^(.)[^@]*(@.*)$/, '$1•••$2');

export function registerAuthRoutes(app: FastifyInstance, ctx: AuthContext) {
  const { db, now, accounts } = ctx;
  const nowIso = () => now().toISOString();
  const link = (path: string, token: string) => `${ctx.publicOrigin}/#/${path}/${token}`;

  function profile(user: AccountRow) {
    const avatar = db.prepare('SELECT content_type,data FROM user_avatars WHERE user_id=?').get(user.id) as { content_type: string; data: Uint8Array } | undefined;
    const pending = db
      .prepare("SELECT payload,expires_at FROM auth_tokens WHERE user_id=? AND purpose='change_email' AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1")
      .get(user.id, nowIso()) as { payload: string; expires_at: string } | undefined;
    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      phone: user.phone,
      location: user.location,
      organization: user.organization,
      role: user.role,
      accessRole: user.access_role,
      status: user.status,
      emailVerified: !!user.email_verified_at,
      emailVerifiedAt: user.email_verified_at,
      pendingEmail: pending ? { email: pending.payload, expiresAt: pending.expires_at } : null,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      passwordChangedAt: user.password_changed_at,
      mfaEnabled: !!user.mfa_enabled_at,
      avatar: avatar ? dataUrl(avatar.content_type, avatar.data) : null,
      shops: db.prepare('SELECT id,name FROM shops WHERE owner_id=? ORDER BY created_at,id').all(user.id) as { id: string; name: string }[],
      emailDelivery: ctx.mailer.configured,
    };
  }
  function sendVerification(user: Pick<AccountRow, 'id' | 'email' | 'full_name'>) {
    const token = accounts.issueToken(user.id, 'verify_email', TTL.verifyEmail, user.email);
    return mail.verify(user.email, user.full_name, link('verify-email', token));
  }
  const info = (request: FastifyRequest) => requestInfo(request);

  app.post('/api/auth/register', ctx.authLimit, async (request, reply) => {
    const data = registerSchema.parse(request.body);
    const name = data.fullName ?? data.owner ?? '';
    const verify = ctx.settings.requireEmailVerification;
    if (verify && !ctx.mailer.configured)
      throw new ApiError(503, 'New accounts must confirm their email, but email delivery is not set up on this server. Contact the server operator.', 'email_unavailable');
    const passwordHash = await hash(data.password, 12);
    const existing = accounts.accountByEmail(data.email);
    if (existing) {
      // With verification on, the answer is the same whether or not the address is registered;
      // the owner of the address is told by email instead.
      if (verify) {
        accounts.deliverInBackground(mail.alreadyRegistered(data.email, `${ctx.publicOrigin}/#/login`));
        return reply.code(202).send({ verificationRequired: true, email: data.email });
      }
      throw new ApiError(409, 'An account with this email already exists. Sign in, or reset your password if you have forgotten it.', 'email_taken');
    }
    const id = randomUUID();
    const timestamp = nowIso();
    const state = createWorkspace({ name: data.shopName, owner: name, location: data.location, phone: data.phone, bkash: data.bkash, createdAt: timestamp });
    const outcome = transaction(db, () => {
      if (db.prepare('SELECT id FROM users WHERE email=?').get(data.email)) throw new ApiError(409, 'An account with this email already exists. Sign in, or reset your password if you have forgotten it.', 'email_taken');
      db.prepare("INSERT INTO users(id,email,password_hash,role,created_at,full_name,location,access_role,status,must_verify,password_changed_at) VALUES(?,?,?,'merchant',?,?,?,'user','active',1,?)").run(
        id,
        data.email,
        passwordHash,
        timestamp,
        name,
        data.location,
        timestamp,
      );
      db.prepare('INSERT INTO shops(id,owner_id,created_at,name) VALUES(?,?,?,?)').run(id, id, timestamp, data.shopName);
      db.prepare('INSERT INTO workspaces(user_id,document,updated_at) VALUES(?,?,?)').run(id, JSON.stringify(state), timestamp);
      accounts.record({ userId: id, action: 'account.register', description: 'Created an account and the shop "' + data.shopName.slice(0, 60) + '"', recordType: 'shop', recordId: id, shopId: id, info: info(request) });
      const user = accounts.account(id)!;
      const message = ctx.mailer.configured ? sendVerification(user) : null;
      return { user, message, session: verify ? null : accounts.issueSession(request, reply, user) };
    });
    if (outcome.message) accounts.deliverInBackground(outcome.message);
    if (!outcome.session) return reply.code(202).send({ verificationRequired: true, email: data.email });
    return outcome.session;
  });

  app.post('/api/auth/login', ctx.authLimit, async (request, reply) => {
    const data = loginSchema.parse(request.body);
    accounts.assertNotLocked(data.email, request.ip);
    const user = accounts.accountByEmail(data.email);
    const valid = await compare(data.password, user?.password_hash ?? (await dummyHash));
    if (!user || !valid) {
      accounts.loginFailed(data.email, request.ip);
      if (user) accounts.record({ userId: user.id, action: 'auth.login', outcome: 'failure', description: 'Sign-in failed: incorrect password', info: info(request) });
      throw new ApiError(401, 'Invalid email or password.', 'invalid_credentials');
    }
    accounts.loginSucceeded(data.email);
    if (user.status !== 'active') {
      accounts.record({ userId: user.id, action: 'auth.login', outcome: 'failure', description: `Sign-in refused: account ${user.status}`, info: info(request) });
      throw new ApiError(403, user.status === 'suspended' ? 'This account is suspended. Contact the GreenBiz administrator.' : 'This account has been deactivated. Contact the GreenBiz administrator.', 'account_' + user.status);
    }
    if (ctx.settings.requireEmailVerification && user.must_verify && !user.email_verified_at) {
      accounts.record({ userId: user.id, action: 'auth.login', outcome: 'failure', description: 'Sign-in refused: email not confirmed yet', info: info(request) });
      throw new ApiError(403, 'Confirm your email address before signing in. Use the link we emailed you, or send a new one.', 'email_unverified');
    }
    return transaction(db, () => {
      db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(nowIso(), user.id);
      accounts.record({ userId: user.id, action: 'auth.login', description: 'Signed in', info: info(request) });
      return accounts.issueSession(request, reply, user);
    });
  });
  app.get('/api/auth/me', async (request) => ({ user: publicUser(accounts.authenticate(request)) }));
  app.post('/api/auth/logout', async (request, reply) => {
    const user = accounts.authenticate(request);
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.session_hash);
    accounts.record({ userId: user.id, action: 'auth.logout', description: 'Signed out', info: info(request) });
    accounts.clearSessionCookie(reply);
    return { ok: true };
  });
  app.post('/api/auth/logout-all', async (request, reply) => {
    const user = accounts.authenticate(request);
    accounts.revokeAll(user.id);
    accounts.record({ userId: user.id, action: 'auth.logout', description: 'Signed out on every device', info: info(request) });
    accounts.clearSessionCookie(reply);
    return { ok: true };
  });
  app.delete('/api/auth/account', ctx.authLimit, async (request, reply) => {
    const user = accounts.authenticate(request);
    const data = z.object({ password: z.string().min(1).max(256) }).strict().parse(request.body);
    if (!(await compare(data.password, user.password_hash))) throw new ApiError(401, 'Invalid credentials.');
    transaction(db, () => {
      if (user.access_role === 'super_admin' && user.status === 'active' && accounts.activeSuperAdmins() <= 1)
        throw new ApiError(409, 'You are the only active Super Admin. Make another account Super Admin before deleting yours.', 'last_super_admin');
      accounts.record({ userId: user.id, action: 'account.delete', description: 'Deleted their account and its shops', info: info(request) });
      db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    });
    accounts.clearSessionCookie(reply);
    return { ok: true };
  });
  app.post('/api/auth/password', ctx.authLimit, async (request, reply) => {
    const user = accounts.authenticate(request);
    const data = newPasswordSchema.parse(request.body);
    if (!(await compare(data.current, user.password_hash))) {
      accounts.record({ userId: user.id, action: 'auth.password_change', outcome: 'failure', description: 'Password change failed: current password incorrect', info: info(request) });
      throw new ApiError(401, 'Your current password is not correct.', 'invalid_credentials');
    }
    const passwordHash = await hash(data.password, 12);
    const session = transaction(db, () => {
      db.prepare('UPDATE users SET password_hash=?,password_changed_at=? WHERE id=?').run(passwordHash, nowIso(), user.id);
      // Every other device signs out; this one keeps a fresh session.
      accounts.revokeAll(user.id);
      accounts.record({ userId: user.id, action: 'auth.password_change', description: 'Changed password and signed out other devices', info: info(request) });
      return accounts.issueSession(request, reply, user);
    });
    accounts.deliverInBackground(mail.passwordChanged(user.email));
    return session;
  });

  app.post('/api/auth/forgot-password', ctx.authLimit, async (request, reply) => {
    const { email } = z.object({ email: emailSchema }).strict().parse(request.body);
    if (!ctx.mailer.configured) throw new ApiError(503, 'Password recovery email is not set up on this server. Contact the server administrator. No email has been sent.', 'email_unavailable');
    const user = accounts.accountByEmail(email);
    // Same answer whether or not the address has an account.
    if (user && user.status === 'active' && !accounts.emailQuotaReached(user.id, 'reset_password')) {
      const token = accounts.issueToken(user.id, 'reset_password', TTL.resetPassword);
      accounts.record({ userId: user.id, action: 'auth.password_reset_requested', description: 'Asked for a password reset link', info: info(request) });
      accounts.deliverInBackground(mail.reset(user.email, link('reset-password', token), TTL.resetPassword / 60_000));
    }
    return reply.code(202).send({ ok: true });
  });
  app.post('/api/auth/reset-password/check', linkLimit, async (request) => {
    const { token } = tokenSchema.parse(request.body);
    const row = accounts.findToken(token, 'reset_password');
    const user = accounts.account(row.user_id);
    if (!user) throw new ApiError(400, 'This link is not valid. Request a new one.', 'link_invalid');
    return { email: maskEmail(user.email), expiresAt: row.expires_at };
  });
  app.post('/api/auth/reset-password', ctx.authLimit, async (request) => {
    const data = resetSchema.parse(request.body);
    const row = accounts.findToken(data.token, 'reset_password');
    const passwordHash = await hash(data.password, 12);
    const user = transaction(db, () => {
      const current = accounts.findToken(data.token, 'reset_password');
      const user = accounts.account(current.user_id);
      if (!user) throw new ApiError(400, 'This link is not valid. Request a new one.', 'link_invalid');
      // The link reached this inbox, which also proves the address belongs to the account.
      db.prepare('UPDATE users SET password_hash=?,password_changed_at=?,email_verified_at=coalesce(email_verified_at,?) WHERE id=?').run(passwordHash, nowIso(), nowIso(), user.id);
      accounts.consumeToken(row);
      accounts.revokeAll(user.id);
      accounts.loginSucceeded(user.email);
      accounts.record({ userId: user.id, action: 'auth.password_reset', description: 'Reset password with an email link and signed out every device', info: info(request) });
      return user;
    });
    accounts.deliverInBackground(mail.passwordChanged(user.email));
    return { ok: true, email: user.email };
  });

  app.post('/api/auth/verify-email', linkLimit, async (request) => {
    const { token } = tokenSchema.parse(request.body);
    return transaction(db, () => {
      const row = accounts.findToken(token, 'verify_email');
      const user = accounts.account(row.user_id);
      // A link sent to a previous address cannot verify the current one.
      if (!user || row.payload !== user.email) throw new ApiError(400, 'This link is not valid. Request a new one.', 'link_invalid');
      accounts.consumeToken(row);
      if (!user.email_verified_at) {
        db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(nowIso(), user.id);
        accounts.record({ userId: user.id, action: 'auth.email_verified', description: 'Confirmed email address', info: requestInfo(request) });
      }
      return { ok: true, email: user.email };
    });
  });
  app.post('/api/auth/verify-email/resend', ctx.authLimit, async (request, reply) => {
    const { email } = z.object({ email: emailSchema }).strict().parse(request.body);
    if (!ctx.mailer.configured) throw new ApiError(503, 'Email delivery is not set up on this server. Contact the server operator.', 'email_unavailable');
    const user = accounts.accountByEmail(email);
    if (user && !user.email_verified_at && user.status === 'active' && !accounts.emailQuotaReached(user.id, 'verify_email')) accounts.deliverInBackground(sendVerification(user));
    return reply.code(202).send({ ok: true });
  });
  app.post('/api/auth/verify-email/send', ctx.authLimit, async (request) => {
    const user = accounts.authenticate(request);
    if (user.email_verified_at) throw new ApiError(409, 'Your email address is already confirmed.');
    if (accounts.emailQuotaReached(user.id, 'verify_email')) throw new ApiError(429, 'Several confirmation emails were sent in the last hour. Check your inbox and spam folder, or try again later.');
    await accounts.deliverNow(sendVerification(user));
    return { ok: true };
  });

  app.get('/api/auth/profile', async (request) => ({ profile: profile(accounts.authenticate(request)) }));
  app.post('/api/auth/profile', async (request) => {
    const user = accounts.authenticate(request);
    const data = profileSchema.parse(request.body);
    const fields = { full_name: data.fullName, phone: data.phone, location: data.location, organization: data.organization };
    const labels: Record<keyof typeof fields, string> = { full_name: 'name', phone: 'phone', location: 'location', organization: 'organisation' };
    const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter((key) => user[key] !== fields[key]);
    if (changed.length)
      transaction(db, () => {
        db.prepare('UPDATE users SET full_name=?,phone=?,location=?,organization=? WHERE id=?').run(fields.full_name, fields.phone, fields.location, fields.organization, user.id);
        accounts.record({ userId: user.id, action: 'profile.update', description: `Updated profile (${changed.map((key) => labels[key]).join(', ')})`, info: info(request) });
      });
    return { profile: profile(accounts.account(user.id)!) };
  });
  app.post('/api/auth/avatar', async (request) => {
    const user = accounts.authenticate(request);
    const { image } = z.object({ image: z.string().max(700_000) }).strict().parse(request.body);
    const parsed = parseImageDataUrl(image, 400 * 1024);
    transaction(db, () => {
      db.prepare('INSERT INTO user_avatars(user_id,content_type,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET content_type=excluded.content_type,data=excluded.data,updated_at=excluded.updated_at').run(
        user.id,
        parsed.type,
        parsed.bytes,
        nowIso(),
      );
      db.prepare('UPDATE users SET avatar_updated_at=? WHERE id=?').run(nowIso(), user.id);
      accounts.record({ userId: user.id, action: 'profile.photo', description: 'Updated profile photo', info: info(request) });
    });
    return { profile: profile(accounts.account(user.id)!) };
  });
  app.delete('/api/auth/avatar', async (request) => {
    const user = accounts.authenticate(request);
    transaction(db, () => {
      db.prepare('DELETE FROM user_avatars WHERE user_id=?').run(user.id);
      db.prepare('UPDATE users SET avatar_updated_at=NULL WHERE id=?').run(user.id);
      accounts.record({ userId: user.id, action: 'profile.photo', description: 'Removed profile photo', info: info(request) });
    });
    return { profile: profile(accounts.account(user.id)!) };
  });

  app.post('/api/auth/email', ctx.authLimit, async (request) => {
    const user = accounts.authenticate(request);
    const data = z.object({ newEmail: emailSchema, password: z.string().min(1, 'Enter your current password').max(256) }).strict().parse(request.body);
    if (!(await compare(data.password, user.password_hash))) throw new ApiError(401, 'Your current password is not correct.', 'invalid_credentials');
    if (data.newEmail === user.email) throw new ApiError(400, 'That is already your email address.');
    if (accounts.accountByEmail(data.newEmail)) throw new ApiError(409, 'This email address is already used by another account.', 'email_taken');
    if (accounts.emailQuotaReached(user.id, 'change_email')) throw new ApiError(429, 'Several change requests were sent in the last hour. Try again later.');
    const message = transaction(db, () => {
      db.prepare("UPDATE auth_tokens SET used_at=? WHERE user_id=? AND purpose='change_email' AND used_at IS NULL").run(nowIso(), user.id);
      const token = accounts.issueToken(user.id, 'change_email', TTL.changeEmail, data.newEmail);
      accounts.record({ userId: user.id, action: 'auth.email_change_requested', description: 'Asked to change sign-in email (waiting for confirmation)', info: info(request) });
      return mail.changeEmail(data.newEmail, link('confirm-email', token));
    });
    await accounts.deliverNow(message);
    accounts.deliverInBackground(mail.emailChangeRequested(user.email, data.newEmail));
    return { profile: profile(accounts.account(user.id)!) };
  });
  app.delete('/api/auth/email', async (request) => {
    const user = accounts.authenticate(request);
    db.prepare("UPDATE auth_tokens SET used_at=? WHERE user_id=? AND purpose='change_email' AND used_at IS NULL").run(nowIso(), user.id);
    return { profile: profile(accounts.account(user.id)!) };
  });
  app.post('/api/auth/email/confirm', linkLimit, async (request, reply) => {
    const { token } = tokenSchema.parse(request.body);
    const email = transaction(db, () => {
      const row = accounts.findToken(token, 'change_email');
      const email = emailSchema.parse(row.payload);
      if (db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email, row.user_id)) throw new ApiError(409, 'This email address is now used by another account.', 'email_taken');
      db.prepare('UPDATE users SET email=?,email_verified_at=? WHERE id=?').run(email, nowIso(), row.user_id);
      accounts.consumeToken(row);
      // Sign in again with the new address everywhere.
      accounts.revokeAll(row.user_id);
      accounts.record({ userId: row.user_id, action: 'auth.email_changed', description: 'Changed sign-in email and signed out every device', info: info(request) });
      return email;
    });
    accounts.clearSessionCookie(reply);
    return { ok: true, email };
  });

  app.get('/api/auth/sessions', async (request) => {
    const user = accounts.authenticate(request);
    const at = now().getTime();
    const rows = (kind: 'app' | 'admin', table: 'sessions' | 'staff_sessions') =>
      (db.prepare(`SELECT id,token_hash,created_at,last_seen_at,expires_at,device,network FROM ${table} WHERE user_id=? AND expires_at>?`).all(user.id, at) as {
        id: string;
        token_hash: string;
        created_at: number;
        last_seen_at: number | null;
        expires_at: number;
        device: string;
        network: string;
      }[]).map((s) => ({
        id: s.id,
        kind,
        current: s.token_hash === user.session_hash,
        device: s.device || 'Device not recorded (signed in before 2.4)',
        network: s.network,
        createdAt: new Date(s.created_at).toISOString(),
        lastSeenAt: new Date(s.last_seen_at ?? s.created_at).toISOString(),
        expiresAt: new Date(s.expires_at).toISOString(),
      }));
    const sessions = [...rows('app', 'sessions'), ...rows('admin', 'staff_sessions')].sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt.localeCompare(a.lastSeenAt));
    return { sessions };
  });
  app.delete('/api/auth/sessions/:id', async (request) => {
    const user = accounts.authenticate(request);
    const { id } = sessionId.parse(request.params);
    const own = db.prepare('SELECT token_hash FROM sessions WHERE id=? AND user_id=?').get(id, user.id) as { token_hash: string } | undefined;
    if (own?.token_hash === user.session_hash) throw new ApiError(400, 'Use Sign out to end the session on this device.');
    const removed = Number(db.prepare('DELETE FROM sessions WHERE id=? AND user_id=?').run(id, user.id).changes) + Number(db.prepare('DELETE FROM staff_sessions WHERE id=? AND user_id=?').run(id, user.id).changes);
    if (!removed) throw new ApiError(404, 'That session has already ended.');
    accounts.record({ userId: user.id, action: 'auth.session_revoked', description: 'Signed out another session', info: info(request) });
    return { ok: true };
  });
  app.post('/api/auth/sessions/revoke-others', async (request) => {
    const user = accounts.authenticate(request);
    const count = Number(db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(user.id, user.session_hash).changes) + Number(db.prepare('DELETE FROM staff_sessions WHERE user_id=?').run(user.id).changes);
    accounts.record({ userId: user.id, action: 'auth.session_revoked', description: `Signed out ${count} other session${count === 1 ? '' : 's'}`, info: info(request) });
    return { ok: true, signedOut: count };
  });
}
