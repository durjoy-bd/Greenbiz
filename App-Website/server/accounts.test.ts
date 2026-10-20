import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashSync } from 'bcryptjs';
import { buildApp } from './app';
import { disabledMailer } from './mailer';
import { coarseNetwork } from './accounts';
import { linkToken, native, password, signIn, testServer, verifiedUser, web, type TestServer } from './test-support';

const servers: TestServer[] = [];
async function server(options = {}) {
  const s = await testServer(options);
  servers.push(s);
  return s;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
const events = (dbPath: string, userId: string) => {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare('SELECT action,outcome,description FROM activity_events WHERE user_id=? ORDER BY created_at,rowid').all(userId) as { action: string; outcome: string; description: string }[];
  } finally {
    db.close();
  }
};

describe('registration and email verification', () => {
  it('registers, confirms the email, signs in and signs out', async () => {
    const s = await server();
    const registered = await s.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: { fullName: 'Rahim Uddin', email: 'Owner@Example.com', password, confirmPassword: password, shopName: 'Rahim Store', location: 'Dhaka' } });
    expect(registered.statusCode).toBe(202);
    expect(registered.json()).toEqual({ verificationRequired: true, email: 'owner@example.com' });
    expect(registered.json().token).toBeUndefined();
    expect(s.sent.at(-1)).toMatchObject({ to: 'owner@example.com', subject: 'Confirm your GreenBiz email address' });

    const early = await s.app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'owner@example.com', password } });
    expect(early.statusCode).toBe(403);
    expect(early.json().code).toBe('email_unverified');

    const verified = await s.app.inject({ method: 'POST', url: '/api/auth/verify-email', headers: web, payload: { token: linkToken(s.sent, 'verify-email') } });
    expect(verified.json()).toEqual({ ok: true, email: 'owner@example.com' });
    const user = await signIn(s.app, 'owner@example.com');
    const me = (await s.app.inject({ url: '/api/auth/me', headers: user.headers })).json().user;
    expect(me).toEqual({ id: user.id, email: 'owner@example.com', role: 'merchant', name: 'Rahim Uddin', accessRole: 'user', emailVerified: true });
    expect((await s.app.inject({ url: '/api/workspace', headers: user.headers })).json().shop).toMatchObject({ name: 'Rahim Store', owner: 'Rahim Uddin' });

    expect((await s.app.inject({ method: 'POST', url: '/api/auth/logout', headers: user.headers })).statusCode).toBe(200);
    expect((await s.app.inject({ url: '/api/auth/me', headers: user.headers })).statusCode).toBe(401);
    expect(events(s.dbPath, user.id).map((e) => `${e.action}:${e.outcome}`)).toEqual([
      'account.register:success',
      'auth.login:failure',
      'auth.email_verified:success',
      'auth.login:success',
      'auth.logout:success',
    ]);
  });

  it('never creates a second account for an address and gives the same answer either way', async () => {
    const s = await server();
    await verifiedUser(s);
    const again = await s.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: { fullName: 'Someone Else', email: 'owner@example.com', password: 'Another-pass-123!', confirmPassword: 'Another-pass-123!', shopName: 'Copy' } });
    expect(again.statusCode).toBe(202);
    expect(again.json()).toEqual({ verificationRequired: true, email: 'owner@example.com' });
    expect(s.sent.at(-1)).toMatchObject({ to: 'owner@example.com', subject: 'You already have a GreenBiz account' });
    const db = new DatabaseSync(s.dbPath);
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 1 });
    db.close();
    // Without verification the duplicate is refused outright.
    const open = await server({ requireEmailVerification: false });
    const payload = { fullName: 'A', email: 'a@example.com', password, shopName: 'A' };
    expect((await open.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload })).statusCode).toBe(200);
    const duplicate = await open.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('email_taken');
  });

  it('explains invalid input field by field and refuses self-assigned roles and bots', async () => {
    const s = await server();
    const base = { fullName: 'Rahim', email: 'r@example.com', password, confirmPassword: password, shopName: 'Shop' };
    const mismatch = await s.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: { ...base, confirmPassword: 'Different-pass-1!' } });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().fields).toEqual({ confirmPassword: 'Passwords do not match' });
    const weak = await s.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: { ...base, password: 'short', confirmPassword: 'short' } });
    expect(weak.json().fields.password).toBe('Use at least 10 characters');
    const blank = await s.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: { ...base, fullName: '', email: 'not-an-email' } });
    expect(blank.json().fields).toMatchObject({ fullName: 'Enter your full name', email: 'Enter a valid email address' });
    for (const extra of [{ accessRole: 'super_admin' }, { access_role: 'admin' }, { role: 'bank' }, { website: 'http://spam.example' }]) {
      expect((await s.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: { ...base, ...extra } })).statusCode).toBe(400);
    }
    const noMail = await server({ mailer: disabledMailer });
    const refused = await noMail.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: base });
    expect(refused.statusCode).toBe(503);
    expect(refused.json().code).toBe('email_unavailable');
  });

  it('lets accounts from before verification existed keep signing in, and resends links on request', async () => {
    const s = await server();
    await s.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: { fullName: 'Late', email: 'late@example.com', password, shopName: 'Late Shop' } });
    const first = linkToken(s.sent, 'verify-email');
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/verify-email/resend', headers: web, payload: { email: 'late@example.com' } })).statusCode).toBe(202);
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/verify-email/resend', headers: web, payload: { email: 'nobody@example.com' } })).statusCode).toBe(202);
    const second = linkToken(s.sent, 'verify-email');
    expect(second).not.toBe(first);
    s.advance(25 * 60 * 60_000);
    const expired = await s.app.inject({ method: 'POST', url: '/api/auth/verify-email', headers: web, payload: { token: second } });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().code).toBe('link_expired');
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/verify-email', headers: web, payload: { token: 'f'.repeat(64) } })).json().code).toBe('link_invalid');
    // Legacy accounts are flagged must_verify = 0 by the migration.
    const db = new DatabaseSync(s.dbPath);
    db.prepare('UPDATE users SET must_verify=0').run();
    db.close();
    await signIn(s.app, 'late@example.com');
  });
});

describe('password recovery', () => {
  it('sends a single-use, 30-minute link that resets the password and ends every session', async () => {
    const s = await server();
    const user = await verifiedUser(s);
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/forgot-password', headers: web, payload: { email: 'nobody@example.com' } })).statusCode).toBe(202);
    const before = s.sent.length;
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/forgot-password', headers: web, payload: { email: 'owner@example.com' } })).statusCode).toBe(202);
    expect(s.sent.length).toBe(before + 1);
    const token = linkToken(s.sent, 'reset-password');
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/reset-password/check', headers: web, payload: { token } })).json().email).toBe('o•••@example.com');
    const mismatch = await s.app.inject({ method: 'POST', url: '/api/auth/reset-password', headers: web, payload: { token, password: 'New-password-321!', confirmPassword: 'nope' } });
    expect(mismatch.statusCode).toBe(400);
    const reset = await s.app.inject({ method: 'POST', url: '/api/auth/reset-password', headers: web, payload: { token, password: 'New-password-321!', confirmPassword: 'New-password-321!' } });
    expect(reset.statusCode).toBe(200);
    expect((await s.app.inject({ url: '/api/workspace', headers: user.headers })).statusCode).toBe(401);
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'owner@example.com', password } })).statusCode).toBe(401);
    await signIn(s.app, 'owner@example.com', 'New-password-321!');
    const reused = await s.app.inject({ method: 'POST', url: '/api/auth/reset-password', headers: web, payload: { token, password: 'Third-password-1!' } });
    expect(reused.statusCode).toBe(410);
    expect(reused.json().code).toBe('link_used');
    expect(s.sent.at(-1)).toMatchObject({ subject: 'Your GreenBiz password was changed' });

    await s.app.inject({ method: 'POST', url: '/api/auth/forgot-password', headers: web, payload: { email: 'owner@example.com' } });
    const older = linkToken(s.sent, 'reset-password');
    s.advance(31 * 60_000);
    const late = await s.app.inject({ method: 'POST', url: '/api/auth/reset-password', headers: web, payload: { token: older, password: 'Third-password-1!' } });
    expect(late.json().code).toBe('link_expired');
    const actions = events(s.dbPath, user.id).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.password_reset_requested', 'auth.password_reset']));
  });

  it('locks an address for 15 minutes after five wrong passwords, whether or not it exists', async () => {
    // The per-address request limit is raised so only the per-account lock is tested here.
    const s = await server({ authRateLimitMax: 100 });
    await verifiedUser(s);
    for (const email of ['owner@example.com', 'ghost@example.com']) {
      for (let i = 0; i < 5; i++) expect((await s.app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email, password: 'Wrong-password-0!' } })).statusCode).toBe(401);
      const locked = await s.app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email, password } });
      expect(locked.statusCode).toBe(429);
      expect(locked.json().code).toBe('locked');
    }
    s.advance(16 * 60_000);
    await signIn(s.app, 'owner@example.com');
  });

  it('locks only the guessing address, so a stranger cannot lock the owner out, and caps guesses spread across addresses', async () => {
    const s = await server({ authRateLimitMax: 1000 });
    await verifiedUser(s);
    const login = (pass: string, remoteAddress: string) => s.app.inject({ method: 'POST', url: '/api/auth/login', headers: native, remoteAddress, payload: { email: 'owner@example.com', password: pass } });
    for (let i = 0; i < 5; i++) expect((await login('Wrong-password-0!', '203.0.113.9')).statusCode).toBe(401);
    expect((await login(password, '203.0.113.9')).json().code).toBe('locked');
    // The owner, elsewhere, still signs in, and that clears the stranger's lock too.
    expect((await login(password, '198.51.100.4')).statusCode).toBe(200);
    expect((await login(password, '203.0.113.9')).statusCode).toBe(200);
    // Fifty wrong guesses from fifty addresses lock the email everywhere for 15 minutes.
    for (let i = 0; i < 50; i++) expect((await login('Wrong-password-0!', `192.0.2.${i + 1}`)).statusCode).toBe(401);
    expect((await login(password, '198.51.100.4')).json().code).toBe('locked');
    s.advance(16 * 60_000);
    expect((await login(password, '198.51.100.4')).statusCode).toBe(200);
  });
});

describe('profile and account settings', () => {
  it('saves profile changes that survive a reload and refuses invalid values', async () => {
    const s = await server();
    const user = await verifiedUser(s);
    const profile = (await s.app.inject({ url: '/api/auth/profile', headers: user.headers })).json().profile;
    expect(profile).toMatchObject({ fullName: 'Rahim Uddin', email: 'owner@example.com', emailVerified: true, accessRole: 'user', status: 'active', location: 'Dhaka', shops: [{ name: 'Rahim Store' }], avatar: null });
    expect(JSON.stringify(profile)).not.toMatch(/password_hash|\$2[aby]\$|mfa_secret/);
    const saved = await s.app.inject({ method: 'POST', url: '/api/auth/profile', headers: user.headers, payload: { fullName: 'Rahim U.', phone: '+880 1700-000000', location: 'Mirpur, Dhaka', organization: '' } });
    expect(saved.statusCode).toBe(200);
    // A fresh request, like reloading the page, returns the saved values.
    expect((await s.app.inject({ url: '/api/auth/profile', headers: user.headers })).json().profile).toMatchObject({ fullName: 'Rahim U.', phone: '+880 1700-000000', location: 'Mirpur, Dhaka' });
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/profile', headers: user.headers, payload: { fullName: '', phone: 'call me' } })).json().fields).toMatchObject({ fullName: 'Enter your full name', phone: expect.any(String) });
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/profile', headers: user.headers, payload: { fullName: 'X', accessRole: 'super_admin' } })).statusCode).toBe(400);
    const png = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).toString('base64');
    const photo = await s.app.inject({ method: 'POST', url: '/api/auth/avatar', headers: user.headers, payload: { image: png } });
    expect(photo.json().profile.avatar).toBe(png);
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/avatar', headers: user.headers, payload: { image: 'data:image/png;base64,' + Buffer.from('<svg>hello</svg>').toString('base64') } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: 'DELETE', url: '/api/auth/avatar', headers: user.headers })).json().profile.avatar).toBeNull();
    expect(events(s.dbPath, user.id).filter((e) => e.action.startsWith('profile.')).map((e) => e.description)).toEqual(['Updated profile (name, phone, location)', 'Updated profile photo', 'Removed profile photo']);
  });

  it('changes the sign-in email only after the new address is confirmed', async () => {
    const s = await server();
    const user = await verifiedUser(s);
    await verifiedUser(s, 'taken@example.com');
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/email', headers: user.headers, payload: { newEmail: 'new@example.com', password: 'wrong' } })).statusCode).toBe(401);
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/email', headers: user.headers, payload: { newEmail: 'taken@example.com', password } })).statusCode).toBe(409);
    const requested = await s.app.inject({ method: 'POST', url: '/api/auth/email', headers: user.headers, payload: { newEmail: 'new@example.com', password } });
    expect(requested.json().profile).toMatchObject({ email: 'owner@example.com', pendingEmail: { email: 'new@example.com' } });
    expect(s.sent.map((m) => m.to)).toEqual(expect.arrayContaining(['new@example.com', 'owner@example.com']));
    const confirmed = await s.app.inject({ method: 'POST', url: '/api/auth/email/confirm', headers: web, payload: { token: linkToken(s.sent, 'confirm-email', 'new@example.com') } });
    expect(confirmed.json()).toEqual({ ok: true, email: 'new@example.com' });
    expect((await s.app.inject({ url: '/api/auth/me', headers: user.headers })).statusCode).toBe(401);
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'owner@example.com', password } })).statusCode).toBe(401);
    const again = await signIn(s.app, 'new@example.com');
    expect((await s.app.inject({ url: '/api/auth/me', headers: again.headers })).json().user).toMatchObject({ email: 'new@example.com', emailVerified: true });
  });

  it('lists active sessions and signs out the others', async () => {
    const s = await server();
    const phone = await verifiedUser(s);
    s.advance(60_000);
    const laptop = await signIn(s.app, 'owner@example.com');
    const third = await signIn(s.app, 'owner@example.com');
    const list = (await s.app.inject({ url: '/api/auth/sessions', headers: laptop.headers })).json().sessions;
    expect(list).toHaveLength(3);
    expect(list.filter((x: { current: boolean }) => x.current)).toHaveLength(1);
    expect(list[0]).toMatchObject({ current: true, device: 'GreenBiz Android app', kind: 'app' });
    expect(JSON.stringify(list)).not.toContain(laptop.token);
    const other = list.find((x: { current: boolean }) => !x.current);
    expect((await s.app.inject({ method: 'DELETE', url: `/api/auth/sessions/${list[0].id}`, headers: laptop.headers })).statusCode).toBe(400);
    expect((await s.app.inject({ method: 'DELETE', url: `/api/auth/sessions/${other.id}`, headers: laptop.headers })).statusCode).toBe(200);
    const signedOut = await s.app.inject({ method: 'POST', url: '/api/auth/sessions/revoke-others', headers: laptop.headers });
    expect(signedOut.json().signedOut).toBe(1);
    for (const gone of [phone, third]) expect((await s.app.inject({ url: '/api/auth/me', headers: gone.headers })).statusCode).toBe(401);
    expect((await s.app.inject({ url: '/api/auth/me', headers: laptop.headers })).statusCode).toBe(200);
    // Nobody can end another account's session by guessing its id.
    const stranger = await verifiedUser(s, 'stranger@example.com');
    const mine = (await s.app.inject({ url: '/api/auth/sessions', headers: laptop.headers })).json().sessions[0].id;
    expect((await s.app.inject({ method: 'DELETE', url: `/api/auth/sessions/${mine}`, headers: stranger.headers })).statusCode).toBe(404);
  });

  it('changes the password, keeps this device signed in and records it', async () => {
    const s = await server();
    const user = await verifiedUser(s);
    const other = await signIn(s.app, 'owner@example.com');
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/password', headers: user.headers, payload: { current: password, password: 'New-password-321!', confirmPassword: 'mismatch' } })).statusCode).toBe(400);
    const changed = await s.app.inject({ method: 'POST', url: '/api/auth/password', headers: user.headers, payload: { current: password, password: 'New-password-321!', confirmPassword: 'New-password-321!' } });
    const fresh = { ...native, authorization: `Bearer ${changed.json().token}` };
    expect((await s.app.inject({ url: '/api/auth/me', headers: fresh })).statusCode).toBe(200);
    expect((await s.app.inject({ url: '/api/auth/me', headers: other.headers })).statusCode).toBe(401);
    expect(events(s.dbPath, user.id).at(-1)).toMatchObject({ action: 'auth.password_change', description: 'Changed password and signed out other devices' });
  });
});

describe('activity tracking', () => {
  it('records GreenBiz actions with readable descriptions, accurate times and no secrets', async () => {
    const s = await server();
    const user = await verifiedUser(s);
    const saved = (await s.app.inject({ method: 'POST', url: '/api/actions', headers: user.headers, payload: { type: 'product.save', product: { name: 'Rice', category: 'Food', unit: 'kg', description: '', quantity: 10, cost: 40, price: 50, lowAt: 2, source: 'manual' } } })).json();
    s.advance(1000);
    await s.app.inject({ method: 'POST', url: '/api/actions', headers: user.headers, payload: { type: 'sale.create', items: [{ productId: saved.products[0].id, quantity: 2 }], method: 'cash', channel: 'shop', customer: '', requestId: 'sale-1' } });
    // A replayed request changes nothing and records nothing.
    await s.app.inject({ method: 'POST', url: '/api/actions', headers: user.headers, payload: { type: 'sale.create', items: [{ productId: saved.products[0].id, quantity: 2 }], method: 'cash', channel: 'shop', customer: '', requestId: 'sale-1' } });
    await s.app.inject({ method: 'POST', url: '/api/shops', headers: user.headers, payload: { name: 'Second branch' } });
    const db = new DatabaseSync(s.dbPath);
    const rows = db.prepare("SELECT * FROM activity_events WHERE action IN ('product.create','sale.create','shop.create') ORDER BY created_at").all() as Record<string, string>[];
    expect(rows.map((r) => [r.action, r.description])).toEqual([
      ['product.create', 'Added product "Rice"'],
      ['sale.create', 'Recorded a sale of ৳100'],
      ['shop.create', 'Created the shop "Second branch"'],
    ]);
    expect(rows[0]).toMatchObject({ user_id: user.id, actor_id: user.id, record_type: 'product', record_id: saved.products[0].id, created_at: '2026-10-20T06:00:00.000Z', device: 'GreenBiz Android app' });
    expect(rows[1].created_at).toBe('2026-10-20T06:00:01.000Z');
    const all = JSON.stringify(db.prepare('SELECT * FROM activity_events').all());
    expect(all).not.toContain(password);
    expect(all).not.toContain(user.token);
    expect(() => db.prepare("UPDATE activity_events SET description='changed'").run()).toThrow(/cannot be changed/);
    db.close();
  });

  it('keeps "last login" and "last activity" separate and counts each Dhaka day once', async () => {
    const s = await server();
    const user = await verifiedUser(s);
    s.advance(2 * 60 * 60_000);
    await s.app.inject({ url: '/api/workspace', headers: user.headers });
    const db = new DatabaseSync(s.dbPath);
    const row = db.prepare('SELECT last_login_at,last_activity_at FROM users WHERE id=?').get(user.id) as { last_login_at: string; last_activity_at: string };
    expect(row).toEqual({ last_login_at: '2026-10-20T06:00:00.000Z', last_activity_at: '2026-10-20T08:00:00.000Z' });
    s.advance(20 * 60 * 60_000);
    await s.app.inject({ url: '/api/workspace', headers: user.headers });
    expect(db.prepare('SELECT day FROM user_activity_days WHERE user_id=? ORDER BY day').all(user.id)).toEqual([{ day: '2026-10-20' }, { day: '2026-10-21' }]);
    db.close();
  });

  it('removes activity older than the retention period', async () => {
    const s = await server({ activityRetentionDays: 30 });
    const user = await verifiedUser(s);
    await s.close();
    servers.splice(servers.indexOf(s), 1);
    const later = await buildApp({ dbPath: s.dbPath, publicOrigin: 'http://127.0.0.1:8787', mailer: disabledMailer, activityRetentionDays: 30, now: () => new Date('2026-12-01T00:00:00Z') });
    const db = new DatabaseSync(s.dbPath);
    expect(db.prepare('SELECT COUNT(*) AS count FROM activity_events WHERE user_id=?').get(user.id)).toEqual({ count: 0 });
    db.close();
    await later.close();
  });

  it('keeps only the network, not the address, of each device', () => {
    expect(coarseNetwork('203.0.113.77')).toBe('203.0.113.x');
    expect(coarseNetwork('::ffff:198.51.100.9')).toBe('198.51.100.x');
    expect(coarseNetwork('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
  });
});

describe('migration from 2.3', () => {
  it('turns administrators into Super Admin accounts, keeps every record and flags what it cannot match', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'greenbiz-migrate-'));
    const dbPath = join(dir, 'legacy.sqlite');
    const legacy = new DatabaseSync(dbPath);
    legacy.exec('PRAGMA foreign_keys=ON; CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const [version, file] of [[1, 'schema.sql'], [2, 'migration-002.sql'], [3, 'migration-003.sql'], [4, 'migration-004.sql'], [5, 'migration-005.sql']] as const) {
      legacy.exec(readFileSync(new URL('./' + file, import.meta.url), 'utf8'));
      legacy.prepare('INSERT INTO migrations VALUES(?,?)').run(version, '2026-10-01T00:00:00Z');
    }
    const passwordHash = hashSync(password, 4);
    const workspace = (name: string, owner: string) => JSON.stringify({ version: 1, shop: { name, owner, location: '', phone: '', bkash: '', language: 'en', shareScore: false, createdAt: '2026-10-01T00:00:00Z' }, products: [], sales: [], payments: [], offers: [], activity: [], processedRequests: [] });
    legacy.prepare("INSERT INTO users(id,email,password_hash,role,created_at,disabled_at,last_login_at) VALUES('u1','shop@example.com',?,'merchant','2026-10-01T00:00:00Z',NULL,'2026-10-05T00:00:00Z')").run(passwordHash);
    legacy.prepare("INSERT INTO users(id,email,password_hash,role,created_at,disabled_at) VALUES('u2','blocked@example.com',?,'merchant','2026-10-02T00:00:00Z','2026-10-03T00:00:00Z')").run(passwordHash);
    legacy.prepare("INSERT INTO users(id,email,password_hash,role,created_at) VALUES('u3','clash@example.com',?,'merchant','2026-10-02T00:00:00Z')").run(passwordHash);
    for (const [id, name, owner] of [['u1', 'Shapla Store', 'Shapla Begum'], ['u2', 'Blocked Shop', ''], ['u3', 'Clash Shop', 'C']]) {
      legacy.prepare('INSERT INTO shops(id,owner_id,created_at) VALUES(?,?,?)').run(id, id, '2026-10-01T00:00:00Z');
      legacy.prepare('INSERT INTO workspaces(user_id,document,updated_at) VALUES(?,?,?)').run(id, workspace(name, owner), '2026-10-01T00:00:00Z');
    }
    legacy.prepare("INSERT INTO administrators(id,email,password_hash,created_at) VALUES('a1','admin@example.com',?,'2026-09-01T00:00:00Z')").run(passwordHash);
    legacy.prepare("INSERT INTO administrators(id,email,password_hash,created_at) VALUES('a2','clash@example.com',?,'2026-09-01T00:00:00Z')").run(passwordHash);
    legacy.prepare("INSERT INTO admin_audit(id,admin_id,admin_email,action,target,detail,created_at) VALUES('old','a1','admin@example.com','shop.view','u1','Shapla Store','2026-10-04T00:00:00Z')").run();
    legacy.close();

    const app = await buildApp({ dbPath, publicOrigin: 'http://127.0.0.1:8787', mailer: disabledMailer });
    const db = new DatabaseSync(dbPath);
    const users = db.prepare('SELECT id,email,full_name,access_role,status,must_verify,email_verified_at,last_activity_at FROM users ORDER BY id').all();
    expect(users).toEqual([
      { id: 'a1', email: 'admin@example.com', full_name: '', access_role: 'super_admin', status: 'active', must_verify: 0, email_verified_at: null, last_activity_at: null },
      { id: 'u1', email: 'shop@example.com', full_name: 'Shapla Begum', access_role: 'user', status: 'active', must_verify: 0, email_verified_at: null, last_activity_at: '2026-10-05T00:00:00Z' },
      { id: 'u2', email: 'blocked@example.com', full_name: '', access_role: 'user', status: 'suspended', must_verify: 0, email_verified_at: null, last_activity_at: null },
      { id: 'u3', email: 'clash@example.com', full_name: 'C', access_role: 'user', status: 'active', must_verify: 0, email_verified_at: null, last_activity_at: null },
    ]);
    expect(db.prepare('SELECT id,name FROM shops ORDER BY id').all()).toEqual([
      { id: 'u1', name: 'Shapla Store' },
      { id: 'u2', name: 'Blocked Shop' },
      { id: 'u3', name: 'Clash Shop' },
    ]);
    expect(db.prepare('SELECT kind,reference FROM migration_review').all()).toEqual([{ kind: 'administrator_not_merged', reference: 'a2' }]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM admin_audit WHERE id='old'").get()).toEqual({ count: 1 });
    expect(() => db.prepare("DELETE FROM admin_audit WHERE id='old'").run()).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE admin_audit SET detail='x' WHERE id='old'").run()).toThrow(/append-only/);
    db.close();
    // Existing owners keep signing in without a verification step; suspended ones stay blocked.
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'shop@example.com', password } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'blocked@example.com', password } })).statusCode).toBe(403);
    // The converted administrator signs in to the app normally (no shop yet) and to the panel with MFA.
    const admin = await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'admin@example.com', password } });
    expect(admin.json().user).toMatchObject({ accessRole: 'super_admin' });
    expect((await app.inject({ url: '/api/shops', headers: { ...native, authorization: `Bearer ${admin.json().token}` } })).json().shops).toEqual([]);
    expect((await app.inject({ method: 'POST', url: '/api/admin/login', headers: web, payload: { email: 'admin@example.com', password } })).json().mfa).toBe('setup');
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
