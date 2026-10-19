import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { z } from 'zod';
import { businessDate, creditScore, dashboard } from '../shared/domain';
import { creditProfile } from '../shared/credit-profile';
import type { Workspace } from '../shared/types';
import { ApiError } from './errors';
import { readWorkspace, transaction } from './store';
import { emailSchema, passwordSchema } from './validation';

/**
 * Platform administration. Administrators are a separate table with their own
 * cookie (scoped to /api/admin), never a customer role, and every view of a
 * shop's records or change to an account is written to an audit trail.
 */
interface AdminContext {
  db: DatabaseSync;
  now: () => Date;
  secureCookies: boolean;
  ttl: number;
  dbPath: string;
  publicOrigin: string;
  aiConfigured: boolean;
}
interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  session_hash: string;
}
const COOKIE = 'greenbiz_admin';
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const dummyHash = hash(randomBytes(32).toString('hex'), 12);
const idParam = z.object({ id: z.string().min(1).max(128) }).strict();
const search = z.object({ q: z.string().trim().max(120).optional() }).strict();

/** Satisfies the password policy: four character classes, 16 characters, no look-alikes. */
export function temporaryPassword(): string {
  const sets = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%*-+'];
  const all = sets.join('');
  const chars = sets.map((set) => set[randomInt(set.length)]);
  while (chars.length < 16) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export async function createAdministrator(db: DatabaseSync, email: string, password: string, createdAt: string) {
  const address = emailSchema.parse(email);
  const passwordHash = await hash(passwordSchema.parse(password), 12);
  const id = randomUUID();
  db.prepare('INSERT INTO administrators(id,email,password_hash,created_at) VALUES(?,?,?,?)').run(id, address, passwordHash, createdAt);
  return { id, email: address };
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
  const { db, now } = ctx;
  const started = Date.now();
  const loginLimit = { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } };

  function authenticate(request: FastifyRequest): AdminRow {
    const raw = request.cookies[COOKIE];
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) throw new ApiError(401, 'Sign in as an administrator.');
    const sessionHash = tokenHash(raw);
    const admin = db
      .prepare('SELECT a.id,a.email,a.password_hash FROM admin_sessions s JOIN administrators a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>?')
      .get(sessionHash, now().getTime()) as Omit<AdminRow, 'session_hash'> | undefined;
    if (!admin) throw new ApiError(401, 'Sign in as an administrator.');
    return { ...admin, session_hash: sessionHash };
  }
  function audit(admin: Pick<AdminRow, 'id' | 'email'>, action: string, target: string, detail = '') {
    db.prepare('INSERT INTO admin_audit(id,admin_id,admin_email,action,target,detail,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), admin.id, admin.email, action, target, detail.slice(0, 500), now().toISOString());
  }
  function setCookie(reply: FastifyReply, token: string) {
    // Scoped to the admin API so it is never sent with shop-owner requests.
    reply.setCookie(COOKIE, token, { path: '/api/admin', httpOnly: true, sameSite: 'strict', secure: ctx.secureCookies, maxAge: Math.min(ctx.ttl, 60 * 60 * 12) });
  }
  function issue(reply: FastifyReply, adminId: string) {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').run(now().getTime());
    db.prepare('INSERT INTO admin_sessions(token_hash,admin_id,created_at,expires_at) VALUES(?,?,?,?)').run(tokenHash(token), adminId, now().getTime(), now().getTime() + Math.min(ctx.ttl, 60 * 60 * 12) * 1000);
    setCookie(reply, token);
  }
  function shopRows() {
    return db
      .prepare('SELECT s.id, s.owner_id, u.email, u.disabled_at, w.updated_at FROM shops s JOIN users u ON u.id=s.owner_id JOIN workspaces w ON w.user_id=s.id ORDER BY w.updated_at DESC, s.id')
      .all() as { id: string; owner_id: string; email: string; disabled_at: string | null; updated_at: string }[];
  }
  function userRow(id: string) {
    const user = db.prepare('SELECT id,email,role,created_at,last_login_at,disabled_at FROM users WHERE id=?').get(id) as
      | { id: string; email: string; role: string; created_at: string; last_login_at: string | null; disabled_at: string | null }
      | undefined;
    if (!user) throw new ApiError(404, 'Account not found.');
    return user;
  }

  app.post('/api/admin/login', loginLimit, async (request, reply) => {
    const data = z.object({ email: emailSchema, password: z.string().min(1).max(256) }).strict().parse(request.body);
    const admin = db.prepare('SELECT id,email,password_hash FROM administrators WHERE email=?').get(data.email) as Omit<AdminRow, 'session_hash'> | undefined;
    const valid = await compare(data.password, admin?.password_hash ?? (await dummyHash));
    if (!admin || !valid) throw new ApiError(401, 'Invalid administrator email or password.');
    db.prepare('UPDATE administrators SET last_login_at=? WHERE id=?').run(now().toISOString(), admin.id);
    issue(reply, admin.id);
    audit(admin, 'admin.login', admin.email);
    return { admin: { id: admin.id, email: admin.email } };
  });
  app.post('/api/admin/logout', async (request, reply) => {
    const admin = authenticate(request);
    db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(admin.session_hash);
    reply.clearCookie(COOKIE, { path: '/api/admin', httpOnly: true, sameSite: 'strict', secure: ctx.secureCookies });
    return { ok: true };
  });
  // Answers "who is signed in?" without an error status, so the console stays quiet before sign-in.
  app.get('/api/admin/me', async (request) => {
    try {
      const admin = authenticate(request);
      return { admin: { id: admin.id, email: admin.email } };
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) return { admin: null };
      throw error;
    }
  });
  app.post('/api/admin/password', loginLimit, async (request, reply) => {
    const admin = authenticate(request);
    const data = z.object({ current: z.string().min(1).max(256), password: passwordSchema }).strict().parse(request.body);
    if (!(await compare(data.current, admin.password_hash))) throw new ApiError(401, 'Your current password is not correct.');
    const passwordHash = await hash(data.password, 12);
    transaction(db, () => {
      db.prepare('UPDATE administrators SET password_hash=? WHERE id=?').run(passwordHash, admin.id);
      db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(admin.id);
      audit(admin, 'admin.password', admin.email);
    });
    issue(reply, admin.id);
    return { ok: true };
  });

  app.get('/api/admin/overview', async (request) => {
    authenticate(request);
    const today = now();
    const roles = db.prepare('SELECT role, COUNT(*) AS count, SUM(CASE WHEN disabled_at IS NULL THEN 0 ELSE 1 END) AS disabled FROM users GROUP BY role').all() as { role: string; count: number; disabled: number }[];
    const sessions = (db.prepare('SELECT COUNT(DISTINCT user_id) AS count FROM sessions WHERE expires_at>?').get(today.getTime()) as { count: number }).count;
    const days = Array.from({ length: 30 }, (_, i) => {
      const day = new Date(today.getTime() - (29 - i) * 86_400_000);
      return businessDate(day);
    });
    const salesByDay = new Map(days.map((day) => [day, 0]));
    const signupsByDay = new Map(days.map((day) => [day, 0]));
    for (const row of db.prepare('SELECT created_at FROM users').all() as { created_at: string }[]) {
      const day = businessDate(row.created_at);
      if (signupsByDay.has(day)) signupsByDay.set(day, signupsByDay.get(day)! + 1);
    }
    const totals = { shops: 0, products: 0, stockValue: 0, salesCount: 0, totalSales: 0, monthSales: 0, todaySales: 0, transactions: 0, paymentsToReview: 0, activeShops7d: 0 };
    const weekAgo = today.getTime() - 7 * 86_400_000;
    for (const row of shopRows()) {
      const w = readWorkspace(db, row.id);
      const s = shopSummary(w, today);
      totals.shops++;
      totals.products += s.products;
      totals.stockValue += s.stockValue;
      totals.salesCount += s.salesCount;
      totals.totalSales += s.totalSales;
      totals.monthSales += s.monthSales;
      totals.todaySales += s.todaySales;
      totals.transactions += s.transactions;
      totals.paymentsToReview += s.paymentsToReview;
      if (Date.parse(s.lastActivity) >= weekAgo) totals.activeShops7d++;
      for (const sale of w.sales) {
        const day = businessDate(sale.createdAt);
        if (salesByDay.has(day)) salesByDay.set(day, salesByDay.get(day)! + sale.total);
      }
    }
    for (const key of ['stockValue', 'totalSales', 'monthSales', 'todaySales'] as const) totals[key] = Math.round(totals[key] * 100) / 100;
    return {
      accounts: {
        merchants: roles.find((r) => r.role === 'merchant')?.count ?? 0,
        banks: roles.find((r) => r.role === 'bank')?.count ?? 0,
        suspended: roles.reduce((sum, r) => sum + (r.disabled ?? 0), 0),
        signedIn: sessions,
        administrators: (db.prepare('SELECT COUNT(*) AS count FROM administrators').get() as { count: number }).count,
      },
      totals,
      daily: days.map((date) => ({ date, sales: Math.round(salesByDay.get(date)! * 100) / 100, signups: signupsByDay.get(date)! })),
    };
  });

  app.get('/api/admin/shops', async (request) => {
    authenticate(request);
    const { q } = search.parse(request.query);
    const needle = q?.toLowerCase() ?? '';
    const today = now();
    const shops = shopRows()
      .map((row) => ({ id: row.id, ownerId: row.owner_id, ownerEmail: row.email, ownerSuspended: !!row.disabled_at, updatedAt: row.updated_at, ...shopSummary(readWorkspace(db, row.id), today) }))
      .filter((shop) => !needle || [shop.name, shop.owner, shop.location, shop.ownerEmail, shop.phone].some((v) => v.toLowerCase().includes(needle)));
    return { shops };
  });
  app.get('/api/admin/shops/:id', async (request) => {
    const admin = authenticate(request);
    const { id } = idParam.parse(request.params);
    const row = shopRows().find((shop) => shop.id === id);
    if (!row) throw new ApiError(404, 'Shop not found.');
    const workspace = readWorkspace(db, id);
    const today = now();
    const orders = (db.prepare('SELECT token,document,payment_id,created_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 200').all(id) as { token: string; document: string; payment_id: string | null; created_at: string }[]).map((order) => {
      const invoice = JSON.parse(order.document) as { customer: string; total: number };
      return { createdAt: order.created_at, customer: invoice.customer, total: invoice.total, paid: !!order.payment_id };
    });
    audit(admin, 'shop.view', id, workspace.shop.name);
    return {
      shop: { id, ownerId: row.owner_id, ownerEmail: row.email, ownerSuspended: !!row.disabled_at, updatedAt: row.updated_at, ...shopSummary(workspace, today) },
      workspace,
      dashboard: dashboard(workspace, today),
      indicator: creditScore(workspace, today),
      creditProfile: creditProfile(workspace, today),
      orders,
    };
  });
  app.get('/api/admin/shops/:id/export', async (request, reply) => {
    const admin = authenticate(request);
    const { id } = idParam.parse(request.params);
    if (!db.prepare('SELECT id FROM shops WHERE id=?').get(id)) throw new ApiError(404, 'Shop not found.');
    const workspace = readWorkspace(db, id);
    audit(admin, 'shop.export', id, workspace.shop.name);
    reply.header('Content-Disposition', 'attachment; filename="greenbiz-shop-export.json"');
    return { application: 'GreenBiz', exportedAt: now().toISOString(), exportedBy: admin.email, shopId: id, workspace };
  });

  app.get('/api/admin/users', async (request) => {
    authenticate(request);
    const { q } = search.parse(request.query);
    const needle = q?.toLowerCase() ?? '';
    const users = db.prepare('SELECT id,email,role,created_at,last_login_at,disabled_at FROM users ORDER BY created_at DESC').all() as { id: string; email: string; role: string; created_at: string; last_login_at: string | null; disabled_at: string | null }[];
    const shops = db.prepare('SELECT id, owner_id FROM shops').all() as { id: string; owner_id: string }[];
    const active = new Set((db.prepare('SELECT DISTINCT user_id FROM sessions WHERE expires_at>?').all(now().getTime()) as { user_id: string }[]).map((r) => r.user_id));
    return {
      users: users
        .map((user) => {
          const owned = shops.filter((shop) => shop.owner_id === user.id).map((shop) => ({ id: shop.id, name: readWorkspace(db, shop.id).shop.name }));
          return { id: user.id, email: user.email, role: user.role, createdAt: user.created_at, lastLoginAt: user.last_login_at, suspendedAt: user.disabled_at, signedIn: active.has(user.id), shops: owned };
        })
        .filter((user) => !needle || user.email.toLowerCase().includes(needle) || user.shops.some((shop) => shop.name.toLowerCase().includes(needle))),
    };
  });
  app.post('/api/admin/users/:id/suspend', async (request) => {
    const admin = authenticate(request);
    const { id } = idParam.parse(request.params);
    const { suspended } = z.object({ suspended: z.boolean() }).strict().parse(request.body);
    const user = userRow(id);
    transaction(db, () => {
      db.prepare('UPDATE users SET disabled_at=? WHERE id=?').run(suspended ? now().toISOString() : null, id);
      if (suspended) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      audit(admin, suspended ? 'account.suspend' : 'account.restore', id, user.email);
    });
    return { ok: true };
  });
  app.post('/api/admin/users/:id/sign-out', async (request) => {
    const admin = authenticate(request);
    const { id } = idParam.parse(request.params);
    const user = userRow(id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    audit(admin, 'account.sign-out', id, user.email);
    return { ok: true };
  });
  app.post('/api/admin/users/:id/reset-password', async (request) => {
    const admin = authenticate(request);
    const { id } = idParam.parse(request.params);
    const user = userRow(id);
    const password = temporaryPassword();
    const passwordHash = await hash(password, 12);
    transaction(db, () => {
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      audit(admin, 'account.reset-password', id, user.email);
    });
    // Shown once to the administrator; only its hash is stored.
    return { temporaryPassword: password };
  });
  app.delete('/api/admin/users/:id', async (request) => {
    const admin = authenticate(request);
    const { id } = idParam.parse(request.params);
    const { email } = z.object({ email: emailSchema }).strict().parse(request.body);
    const user = userRow(id);
    if (user.email.toLowerCase() !== email) throw new ApiError(400, 'Type the account email exactly to confirm deletion.');
    transaction(db, () => {
      db.prepare('DELETE FROM users WHERE id=?').run(id);
      audit(admin, 'account.delete', id, user.email);
    });
    return { ok: true };
  });
  app.post('/api/admin/banks', async (request) => {
    const admin = authenticate(request);
    const data = z.object({ email: emailSchema, password: passwordSchema }).strict().parse(request.body);
    const passwordHash = await hash(data.password, 12);
    const id = randomUUID();
    transaction(db, () => {
      if (db.prepare('SELECT id FROM users WHERE email=?').get(data.email)) throw new ApiError(409, 'An account with this email already exists.');
      db.prepare('INSERT INTO users(id,email,password_hash,role,created_at) VALUES(?,?,?,?,?)').run(id, data.email, passwordHash, 'bank', now().toISOString());
      audit(admin, 'bank.create', id, data.email);
    });
    return { id, email: data.email };
  });
  app.get('/api/admin/administrators', async (request) => {
    authenticate(request);
    return { administrators: db.prepare('SELECT id,email,created_at AS createdAt,last_login_at AS lastLoginAt FROM administrators ORDER BY created_at').all() };
  });
  app.post('/api/admin/administrators', async (request) => {
    const admin = authenticate(request);
    const data = z.object({ email: emailSchema, password: passwordSchema }).strict().parse(request.body);
    if (db.prepare('SELECT id FROM administrators WHERE email=?').get(data.email)) throw new ApiError(409, 'An administrator with this email already exists.');
    const created = await createAdministrator(db, data.email, data.password, now().toISOString());
    audit(admin, 'admin.create', created.id, created.email);
    return created;
  });

  app.get('/api/admin/activity', async (request) => {
    authenticate(request);
    const items = shopRows().flatMap((row) => {
      const w = readWorkspace(db, row.id);
      return w.activity.slice(-40).map((a) => ({ ...a, shopId: row.id, shopName: w.shop.name, ownerEmail: row.email }));
    });
    return { activity: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300) };
  });
  app.get('/api/admin/audit', async (request) => {
    authenticate(request);
    return { audit: db.prepare('SELECT id,admin_email AS adminEmail,action,target,detail,created_at AS createdAt FROM admin_audit ORDER BY created_at DESC LIMIT 300').all() };
  });
  app.get('/api/admin/system', async (request) => {
    authenticate(request);
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
      serverTime: now().toISOString(),
    };
  });
}
