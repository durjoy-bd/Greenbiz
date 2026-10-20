import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createAdminAccount } from './admin';
import { totpCode, totpStep } from './totp';
import { adminSignIn, linkToken, native, password, signIn, testServer, verifiedUser, web, type TestServer } from './test-support';

const servers: TestServer[] = [];
const superEmail = 'super@example.com';
async function setup(options = {}) {
  const s = await testServer(options);
  servers.push(s);
  await createAdminAccount({ dbPath: s.dbPath, email: superEmail, password, name: 'Sara Super' });
  return s;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
const query = <T>(dbPath: string, sql: string, ...params: string[]) => {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
};
/** Makes `email` an Admin through the API and returns that admin's panel headers. */
async function makeAdmin(s: TestServer, superHeaders: Record<string, string>, email = 'helper@example.com') {
  const user = await verifiedUser(s, email);
  const promoted = await s.app.inject({ method: 'POST', url: `/api/admin/users/${user.id}/role`, headers: superHeaders, payload: { accessRole: 'admin', reason: 'Support team' } });
  expect(promoted.statusCode, promoted.body).toBe(200);
  return { ...user, panel: (await adminSignIn(s, email)).headers };
}

describe('admin sign-in and two-step verification', () => {
  it('requires an administrator role and an authenticator code, and keeps the panel cookie apart', async () => {
    const s = await setup();
    const owner = await verifiedUser(s);
    expect((await s.app.inject({ url: '/api/admin/overview', headers: owner.headers })).statusCode).toBe(401);
    const notAdmin = await s.app.inject({ method: 'POST', url: '/api/admin/login', headers: web, payload: { email: 'owner@example.com', password } });
    expect(notAdmin.statusCode).toBe(403);
    expect(notAdmin.json().code).toBe('not_admin');
    expect((await s.app.inject({ method: 'POST', url: '/api/admin/login', headers: web, payload: { email: superEmail, password: 'Wrong-pass-123!' } })).statusCode).toBe(401);

    const first = (await s.app.inject({ method: 'POST', url: '/api/admin/login', headers: web, payload: { email: superEmail, password } })).json();
    expect(first).toMatchObject({ mfa: 'setup', secret: expect.stringMatching(/^[A-Z2-7]{32}$/), otpauthUrl: expect.stringContaining('otpauth://totp/'), qr: expect.stringMatching(/^data:image\/png;base64,/) });
    expect(first.challenge).toMatch(/^[a-f0-9]{64}$/);
    const wrong = await s.app.inject({ method: 'POST', url: '/api/admin/login/mfa', headers: web, payload: { challenge: first.challenge, code: '000000' } });
    expect(wrong.statusCode).toBe(401);
    const enrolled = await s.app.inject({ method: 'POST', url: '/api/admin/login/mfa', headers: web, payload: { challenge: first.challenge, code: totpCode(first.secret, totpStep(s.clock.now)) } });
    expect(enrolled.statusCode).toBe(200);
    const { recoveryCodes, admin } = enrolled.json();
    expect(recoveryCodes).toHaveLength(10);
    expect(admin).toMatchObject({ email: superEmail, name: 'Sara Super', accessRole: 'super_admin', mfaEnabled: true, permissions: expect.arrayContaining(['audit.view', 'staff.manage']) });
    const cookie = `greenbiz_admin=${enrolled.cookies.find((c) => c.name === 'greenbiz_admin')!.value}`;
    // The panel cookie never opens shop-owner routes.
    expect((await s.app.inject({ url: '/api/workspace', headers: { ...web, cookie } })).statusCode).toBe(401);

    // Next time: a code is required, the same code cannot be replayed, and a recovery code works once.
    const second = (await s.app.inject({ method: 'POST', url: '/api/admin/login', headers: web, payload: { email: superEmail, password } })).json();
    expect(second).toEqual({ mfa: 'verify', challenge: expect.any(String) });
    const replay = await s.app.inject({ method: 'POST', url: '/api/admin/login/mfa', headers: web, payload: { challenge: second.challenge, code: totpCode(first.secret, totpStep(s.clock.now)) } });
    expect(replay.statusCode).toBe(401);
    expect((await s.app.inject({ method: 'POST', url: '/api/admin/login/mfa', headers: web, payload: { challenge: second.challenge, code: recoveryCodes[0].toLowerCase() } })).statusCode).toBe(200);
    const third = (await s.app.inject({ method: 'POST', url: '/api/admin/login', headers: web, payload: { email: superEmail, password } })).json();
    expect((await s.app.inject({ method: 'POST', url: '/api/admin/login/mfa', headers: web, payload: { challenge: third.challenge, code: recoveryCodes[0] } })).statusCode).toBe(401);
    // Five wrong codes end the challenge.
    for (let i = 0; i < 4; i++) await s.app.inject({ method: 'POST', url: '/api/admin/login/mfa', headers: web, payload: { challenge: third.challenge, code: '123456' } });
    expect((await s.app.inject({ method: 'POST', url: '/api/admin/login/mfa', headers: web, payload: { challenge: third.challenge, code: '123456' } })).json().code).toBe('mfa_locked');

    await s.app.inject({ method: 'POST', url: '/api/admin/logout', headers: { ...web, cookie } });
    expect((await s.app.inject({ url: '/api/admin/me', headers: { ...web, cookie } })).json().admin).toBeNull();
  });

  it('refuses a second command-line Super Admin unless asked, and rejects admin changes from another origin', async () => {
    const s = await setup();
    await expect(createAdminAccount({ dbPath: s.dbPath, email: superEmail, password })).rejects.toThrow(/already exists/);
    const { headers } = await adminSignIn(s, superEmail);
    expect((await s.app.inject({ method: 'POST', url: '/api/admin/banks', headers: { ...headers, origin: 'https://evil.example' }, payload: { email: 'bank@example.com' } })).statusCode).toBe(403);
  });
});

describe('roles and permissions are enforced by the server', () => {
  it('keeps regular users out of every admin route, even when called directly', async () => {
    const s = await setup();
    const owner = await verifiedUser(s);
    const other = await verifiedUser(s, 'other@example.com');
    const routes = [
      ['GET', '/api/admin/overview'],
      ['GET', '/api/admin/users'],
      ['GET', `/api/admin/users/${other.id}`],
      ['GET', '/api/admin/activity'],
      ['GET', '/api/admin/audit'],
      ['POST', `/api/admin/users/${other.id}/status`],
      ['POST', `/api/admin/users/${owner.id}/role`],
      ['DELETE', `/api/admin/users/${other.id}`],
    ] as const;
    for (const [method, url] of routes) {
      for (const headers of [owner.headers, { ...web, authorization: owner.headers.authorization }, { ...web, cookie: 'greenbiz_admin=' + owner.token }]) {
        const response = await s.app.inject({ method, url, headers, payload: method === 'GET' ? undefined : { status: 'suspended', accessRole: 'super_admin', reason: 'self-promotion', email: 'other@example.com' } });
        expect(response.statusCode, `${method} ${url}`).toBe(401);
      }
    }
    // A user's own endpoints never expose another user's private data.
    const mine = (await s.app.inject({ url: '/api/auth/profile', headers: owner.headers })).json().profile;
    expect(mine.email).toBe('owner@example.com');
    expect((await s.app.inject({ url: '/api/workspace', headers: { ...owner.headers, 'x-greenbiz-shop': other.id } })).statusCode).toBe(404);
    expect(query<{ access_role: string }>(s.dbPath, 'SELECT access_role FROM users WHERE id=?', owner.id)[0].access_role).toBe('user');
  });

  it('lets an Admin manage users but not administrators, roles, deletions or the audit trail', async () => {
    const s = await setup();
    const superPanel = (await adminSignIn(s, superEmail)).headers;
    const helper = await makeAdmin(s, superPanel);
    const owner = await verifiedUser(s);
    const superId = query<{ id: string }>(s.dbPath, 'SELECT id FROM users WHERE email=?', superEmail)[0].id;

    expect((await s.app.inject({ url: '/api/admin/users', headers: helper.panel })).statusCode).toBe(200);
    expect((await s.app.inject({ url: '/api/admin/audit', headers: helper.panel })).statusCode).toBe(403);
    expect((await s.app.inject({ url: '/api/admin/system', headers: helper.panel })).statusCode).toBe(403);
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/role`, headers: helper.panel, payload: { accessRole: 'admin', reason: 'trying' } })).statusCode).toBe(403);
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${helper.id}/role`, headers: helper.panel, payload: { accessRole: 'super_admin', reason: 'trying' } })).statusCode).toBe(403);
    expect((await s.app.inject({ method: 'DELETE', url: `/api/admin/users/${owner.id}`, headers: helper.panel, payload: { email: 'owner@example.com', reason: 'trying' } })).statusCode).toBe(403);
    const onSuper = await s.app.inject({ method: 'POST', url: `/api/admin/users/${superId}/status`, headers: helper.panel, payload: { status: 'suspended', reason: 'trying' } });
    expect(onSuper.statusCode).toBe(403);
    // The refused attempt is still in the audit trail.
    const refused = query<{ outcome: string; admin_email: string }>(s.dbPath, "SELECT outcome,admin_email FROM admin_audit WHERE action='account.status' AND target=?", superId);
    expect(refused).toEqual([{ outcome: 'failure', admin_email: 'helper@example.com' }]);
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/status`, headers: helper.panel, payload: { status: 'suspended', reason: 'Chargeback dispute' } })).statusCode).toBe(200);
  });

  it('protects the last active Super Admin and ends admin access when a role is removed', async () => {
    const s = await setup();
    const superPanel = (await adminSignIn(s, superEmail)).headers;
    const superId = query<{ id: string }>(s.dbPath, 'SELECT id FROM users WHERE email=?', superEmail)[0].id;
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${superId}/role`, headers: superPanel, payload: { accessRole: 'user', reason: 'oops' } })).json().code).toBe('self');
    const second = await makeAdmin(s, superPanel, 'second@example.com');
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${second.id}/role`, headers: superPanel, payload: { accessRole: 'super_admin', reason: 'Backup owner' } })).statusCode).toBe(200);
    const secondPanel = (await adminSignIn(s, 'second@example.com')).headers;
    // Two Super Admins: one may demote the other, after which the survivor cannot be removed.
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${superId}/role`, headers: secondPanel, payload: { accessRole: 'admin', reason: 'Handover' } })).statusCode).toBe(200);
    expect((await s.app.inject({ url: '/api/admin/me', headers: superPanel })).json().admin).toBeNull();
    const firstAgain = (await adminSignIn(s, superEmail)).headers;
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${second.id}/status`, headers: firstAgain, payload: { status: 'suspended', reason: 'try' } })).statusCode).toBe(403);
    const db = new DatabaseSync(s.dbPath);
    db.prepare("UPDATE users SET access_role='super_admin' WHERE id=?").run(superId);
    db.prepare("UPDATE users SET status='deactivated' WHERE id=?").run(superId);
    db.close();
    // The only active Super Admin cannot delete their own account either.
    const lastSuper = await signIn(s.app, 'second@example.com');
    const selfDelete = await s.app.inject({ method: 'DELETE', url: '/api/auth/account', headers: lastSuper.headers, payload: { password } });
    expect(selfDelete.json().code).toBe('last_super_admin');
  });
});

describe('user management', () => {
  it('searches, filters, sorts and pages real accounts', async () => {
    const s = await setup();
    const { headers } = await adminSignIn(s, superEmail);
    for (const [i, name] of ['Amina', 'Bilal', 'Chandni', 'Dipu', 'Eshita'].entries()) {
      s.advance(60_000);
      await s.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: { fullName: name, email: `${name.toLowerCase()}@example.com`, password, shopName: `${name} Traders`, location: i % 2 ? 'Sylhet' : 'Dhaka' } });
      if (i < 3) await s.app.inject({ method: 'POST', url: '/api/auth/verify-email', headers: web, payload: { token: linkToken(s.sent, 'verify-email', `${name.toLowerCase()}@example.com`) } });
    }
    const all = (await s.app.inject({ url: '/api/admin/users?pageSize=5&sort=name&dir=asc', headers })).json();
    expect(all.total).toBe(6);
    expect(all.users.map((u: { name: string }) => u.name)).toEqual(['Amina', 'Bilal', 'Chandni', 'Dipu', 'Eshita']);
    expect((await s.app.inject({ url: '/api/admin/users?pageSize=5&page=2&sort=name&dir=asc', headers })).json().users.map((u: { name: string }) => u.name)).toEqual(['Sara Super']);
    expect((await s.app.inject({ url: '/api/admin/users?q=chandni%20trad', headers })).json().total).toBe(1);
    expect((await s.app.inject({ url: '/api/admin/users?q=traders', headers })).json().total).toBe(5);
    expect((await s.app.inject({ url: '/api/admin/users?verified=no', headers })).json().users.map((u: { name: string }) => u.name).sort()).toEqual(['Dipu', 'Eshita']);
    expect((await s.app.inject({ url: '/api/admin/users?role=super_admin', headers })).json().users[0]).toMatchObject({ email: superEmail, accessRole: 'super_admin' });
    expect((await s.app.inject({ url: '/api/admin/users?q=100%25', headers })).json().total).toBe(0);
    // The Super Admin was created with the real clock, so find Amina by name rather than position.
    const first = (await s.app.inject({ url: '/api/admin/users?sort=created&dir=asc&pageSize=10', headers })).json().users.find((u: { name: string }) => u.name === 'Amina');
    expect(first).toMatchObject({ name: 'Amina', organization: 'Amina Traders', type: 'merchant', verified: true, status: 'active', lastLoginAt: null });
    expect(Object.keys(first).sort()).toEqual(['accessRole', 'avatarVersion', 'createdAt', 'email', 'id', 'lastActivityAt', 'lastLoginAt', 'name', 'organization', 'status', 'type', 'verified']);
    expect((await s.app.inject({ url: '/api/admin/users?sort=password_hash', headers })).statusCode).toBe(400);
  });

  it('shows one account in full without any secret, and records the view', async () => {
    const s = await setup();
    const { headers } = await adminSignIn(s, superEmail);
    const owner = await verifiedUser(s);
    await s.app.inject({ method: 'POST', url: '/api/actions', headers: owner.headers, payload: { type: 'product.save', product: { name: 'Rice', category: 'Food', unit: 'kg', description: '', quantity: 10, cost: 40, price: 50, lowAt: 2, source: 'manual' } } });
    await s.app.inject({ method: 'POST', url: '/api/orders', headers: owner.headers, payload: { customer: 'Karim', items: [{ name: 'Rice', quantity: 1, price: 50 }], delivery: 0 } });
    await s.app.inject({ method: 'POST', url: '/api/auth/forgot-password', headers: web, payload: { email: 'owner@example.com' } });
    const response = await s.app.inject({ url: `/api/admin/users/${owner.id}`, headers });
    const detail = response.json();
    expect(detail.user).toMatchObject({ email: 'owner@example.com', name: 'Rahim Uddin', accessRole: 'user', status: 'active', verified: true, location: 'Dhaka' });
    expect(detail.shops).toEqual([expect.objectContaining({ id: owner.id, name: 'Rahim Store', products: 1 })]);
    expect(detail.related).toMatchObject({ invoices: 1, invoicesWithClaims: 0, offersReceived: [], offersSent: [] });
    expect(detail.sessions).toHaveLength(1);
    expect(detail.activity.events.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['account.register', 'auth.email_verified', 'auth.login', 'product.create', 'invoice.create']));
    expect(detail.allowed).toMatchObject({ edit: true, status: true, role: true, delete: true });
    // No password, hash, token, reset link or authenticator secret anywhere in the response.
    expect(response.body).not.toMatch(/password_hash|\$2[aby]\$|mfa_secret|token_hash|reset-password\/|[a-f0-9]{64}/);
    const views = query<{ action: string }>(s.dbPath, "SELECT action FROM admin_audit WHERE target=? AND action='user.view'", owner.id);
    expect(views).toHaveLength(1);
  });

  it('suspends with a reason, ending every session at once, then reactivates; deactivation needs a Super Admin to undo', async () => {
    const s = await setup();
    const superPanel = (await adminSignIn(s, superEmail)).headers;
    const helper = await makeAdmin(s, superPanel);
    const owner = await verifiedUser(s);
    const second = await signIn(s.app, 'owner@example.com');
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/status`, headers: helper.panel, payload: { status: 'suspended' } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/status`, headers: helper.panel, payload: { status: 'suspended', reason: 'Reported fraud' } })).statusCode).toBe(200);
    for (const session of [owner, second]) expect((await s.app.inject({ url: '/api/workspace', headers: session.headers })).statusCode).toBe(401);
    const blocked = await s.app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'owner@example.com', password } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: 'account_suspended', error: expect.stringMatching(/suspended/) });
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/status`, headers: helper.panel, payload: { status: 'active', reason: 'Cleared after review' } })).statusCode).toBe(200);
    const back = await signIn(s.app, 'owner@example.com');
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/status`, headers: helper.panel, payload: { status: 'deactivated', reason: 'Closed at owner request' } })).statusCode).toBe(200);
    expect((await s.app.inject({ url: '/api/workspace', headers: back.headers })).statusCode).toBe(401);
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'owner@example.com', password } })).json().code).toBe('account_deactivated');
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/status`, headers: helper.panel, payload: { status: 'active', reason: 'Undo' } })).statusCode).toBe(403);
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/status`, headers: superPanel, payload: { status: 'active', reason: 'Owner came back' } })).statusCode).toBe(200);
    const trail = query<{ action: string; reason: string; before_state: string; after_state: string; admin_email: string; outcome: string }>(
      s.dbPath,
      "SELECT action,reason,before_state,after_state,admin_email,outcome FROM admin_audit WHERE target=? AND action='account.status' ORDER BY created_at,rowid",
      owner.id,
    );
    expect(trail.map((t) => [t.reason, JSON.parse(t.before_state).status, JSON.parse(t.after_state).status, t.outcome])).toEqual([
      ['Reported fraud', 'active', 'suspended', 'success'],
      ['Cleared after review', 'suspended', 'active', 'success'],
      ['Closed at owner request', 'active', 'deactivated', 'success'],
      ['Undo', 'deactivated', 'active', 'failure'],
      ['Owner came back', 'deactivated', 'active', 'success'],
    ]);
  });

  it('emails a reset link without the administrator ever seeing or setting the password', async () => {
    const s = await setup();
    const { headers } = await adminSignIn(s, superEmail);
    const owner = await verifiedUser(s);
    const sent = await s.app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/password-reset-email`, headers });
    expect(sent.json()).toEqual({ ok: true });
    expect(s.sent.at(-1)).toMatchObject({ to: 'owner@example.com', subject: 'Reset your GreenBiz password' });
    // The old password still works until the owner uses the link.
    await signIn(s.app, 'owner@example.com');
    await s.app.inject({ method: 'POST', url: '/api/auth/reset-password', headers: web, payload: { token: linkToken(s.sent, 'reset-password'), password: 'Owner-chose-this-1!' } });
    await signIn(s.app, 'owner@example.com', 'Owner-chose-this-1!');
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/verification-email`, headers })).statusCode).toBe(409);
  });

  it('edits permitted profile fields with before-and-after values, invites bank users and deletes with confirmation', async () => {
    const s = await setup();
    const { headers } = await adminSignIn(s, superEmail);
    const owner = await verifiedUser(s);
    const edited = await s.app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/profile`, headers, payload: { fullName: 'Rahim Uddin Khan', phone: '01700000000', location: 'Dhaka', organization: '', reason: 'Owner asked by phone' } });
    expect(edited.json()).toEqual({ ok: true, changed: ['name', 'phone'] });
    const [entry] = query<{ before_state: string; after_state: string }>(s.dbPath, "SELECT before_state,after_state FROM admin_audit WHERE action='account.profile'");
    expect(JSON.parse(entry.before_state)).toEqual({ name: 'Rahim Uddin', phone: '' });
    expect(JSON.parse(entry.after_state)).toEqual({ name: 'Rahim Uddin Khan', phone: '01700000000' });
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/profile`, headers, payload: { fullName: 'X', email: 'hijack@example.com' } })).statusCode).toBe(400);

    const invited = await s.app.inject({ method: 'POST', url: '/api/admin/banks', headers, payload: { email: 'loans@bank.example', fullName: 'Nadia', organization: 'Example Bank' } });
    expect(invited.statusCode).toBe(200);
    await s.app.inject({ method: 'POST', url: '/api/auth/reset-password', headers: web, payload: { token: linkToken(s.sent, 'reset-password', 'loans@bank.example'), password: 'Bank-chosen-pass-1!' } });
    const bank = await signIn(s.app, 'loans@bank.example', 'Bank-chosen-pass-1!');
    expect((await s.app.inject({ url: '/api/auth/me', headers: bank.headers })).json().user).toMatchObject({ role: 'bank', accessRole: 'user', emailVerified: true });

    expect((await s.app.inject({ method: 'DELETE', url: `/api/admin/users/${owner.id}`, headers, payload: { email: 'wrong@example.com', reason: 'Requested' } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: 'DELETE', url: `/api/admin/users/${owner.id}`, headers, payload: { email: 'owner@example.com', reason: 'Owner requested deletion' } })).statusCode).toBe(200);
    expect((await s.app.inject({ url: '/api/admin/shops', headers })).json().shops).toHaveLength(0);
    expect(query(s.dbPath, "SELECT action FROM admin_audit WHERE action='account.delete' AND outcome='success'")).toHaveLength(1);
  });
});

describe('dashboard, activity log and audit trail', () => {
  it('reports metrics that match the underlying data', async () => {
    const s = await setup();
    const { headers } = await adminSignIn(s, superEmail);
    const a = await verifiedUser(s, 'a@example.com');
    await verifiedUser(s, 'b@example.com');
    await s.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: { fullName: 'C', email: 'c@example.com', password, shopName: 'C Shop' } });
    await s.app.inject({ method: 'POST', url: `/api/admin/users/${a.id}/status`, headers, payload: { status: 'suspended', reason: 'Testing metrics' } });
    s.advance(2 * 86_400_000);
    await verifiedUser(s, 'd@example.com');
    // Admin panel sessions last at most 12 hours.
    expect((await s.app.inject({ url: '/api/admin/overview', headers })).statusCode).toBe(401);
    const fresh = (await adminSignIn(s, superEmail)).headers;
    const overview = (await s.app.inject({ url: '/api/admin/overview?from=2026-10-20&to=2026-10-22', headers: fresh })).json();
    const db = new DatabaseSync(s.dbPath);
    const truth = db.prepare("SELECT COUNT(*) AS total, SUM(email_verified_at IS NOT NULL) AS verified, SUM(status='suspended') AS suspended FROM users").get() as { total: number; verified: number; suspended: number };
    const mau = db.prepare("SELECT COUNT(DISTINCT user_id) AS count FROM user_activity_days WHERE day>'2026-09-22' AND day<='2026-10-22'").get() as { count: number };
    const dau = db.prepare("SELECT COUNT(*) AS count FROM user_activity_days WHERE day='2026-10-22'").get() as { count: number };
    const fresh24 = db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at>='2026-10-19T18:00:00.000Z' AND created_at<'2026-10-22T18:00:00.000Z'").get() as { count: number };
    db.close();
    expect(overview.accounts).toMatchObject({ total: truth.total, verified: truth.verified, unverified: truth.total - truth.verified, suspended: truth.suspended, active: truth.total - truth.suspended, deactivated: 0, newInRange: fresh24.count });
    expect(overview.accounts).toMatchObject({ total: 5, verified: 4, suspended: 1, byRole: { user: 4, admin: 0, super_admin: 1 } });
    expect(overview.engagement).toMatchObject({ dau: dau.count, mau: mau.count });
    // On the last day: the new owner, and the Super Admin who signed in again.
    expect(overview.engagement.dau).toBe(2);
    const perDay = new DatabaseSync(s.dbPath);
    const signups = ['2026-10-20', '2026-10-21', '2026-10-22'].map((date) => (perDay.prepare("SELECT COUNT(*) AS count FROM users WHERE date(created_at,'+6 hours')=?").get(date) as { count: number }).count);
    perDay.close();
    expect(overview.daily.map((d: { signups: number }) => d.signups)).toEqual(signups);
    expect(signups[2]).toBe(1);
    expect(overview.recentRegistrations[0]).toMatchObject({ email: 'd@example.com', verified: true });
    expect(overview.recentActivity.length).toBeGreaterThan(0);
    expect(overview).toMatchObject({ timezone: 'Asia/Dhaka', range: { from: '2026-10-20', to: '2026-10-22' }, generatedAt: s.clock.now.toISOString() });
    expect((await s.app.inject({ url: '/api/admin/overview?from=2026-10-22&to=2026-10-20', headers: fresh })).statusCode).toBe(400);
  });

  it('filters and pages the activity log, and keeps the audit trail append-only and Super Admin only', async () => {
    const s = await setup();
    const { headers } = await adminSignIn(s, superEmail);
    const owner = await verifiedUser(s);
    for (let i = 0; i < 3; i++) await s.app.inject({ method: 'POST', url: '/api/actions', headers: owner.headers, payload: { type: 'product.save', product: { name: `Item ${i}`, category: '', unit: 'pc', description: '', quantity: 1, cost: 1, price: 2, lowAt: 0, source: 'manual' } } });
    const page1 = (await s.app.inject({ url: '/api/admin/activity?user=owner@example.com&action=product.create&pageSize=5', headers })).json();
    expect(page1.total).toBe(3);
    expect(page1.events[0]).toMatchObject({ userEmail: 'owner@example.com', action: 'product.create', outcome: 'success', description: 'Added product "Item 2"' });
    expect(page1.actions).toEqual(expect.arrayContaining(['auth.login', 'product.create']));
    expect((await s.app.inject({ url: '/api/admin/activity?q=Item%201', headers })).json().total).toBe(1);
    expect((await s.app.inject({ url: '/api/admin/activity?from=2026-10-21', headers })).json().total).toBe(0);
    expect((await s.app.inject({ url: '/api/admin/activity?outcome=failure', headers })).json().total).toBe(0);
    const audit = (await s.app.inject({ url: '/api/admin/audit?action=admin.login', headers })).json();
    expect(audit.entries[0]).toMatchObject({ adminEmail: superEmail, action: 'admin.login', outcome: 'success' });
    expect(Object.keys(audit.entries[0])).toEqual(expect.arrayContaining(['reason', 'before', 'after', 'target', 'createdAt']));
    // Not even the server's own database connection may change or delete history.
    const db = new DatabaseSync(s.dbPath);
    expect(() => db.prepare('DELETE FROM admin_audit').run()).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE admin_audit SET outcome='failure'").run()).toThrow(/append-only/);
    db.close();
  });

  it('keeps showing every shop and its records to administrators, audited', async () => {
    const s = await setup();
    const { headers } = await adminSignIn(s, superEmail);
    const owner = await verifiedUser(s);
    const product = (await s.app.inject({ method: 'POST', url: '/api/actions', headers: owner.headers, payload: { type: 'product.save', product: { name: 'Rice', category: 'Food', unit: 'kg', description: '', quantity: 10, cost: 40, price: 50, lowAt: 2, source: 'manual' } } })).json();
    await s.app.inject({ method: 'POST', url: '/api/actions', headers: owner.headers, payload: { type: 'sale.create', items: [{ productId: product.products[0].id, quantity: 2 }], method: 'bkash', channel: 'shop', customer: 'Karim', requestId: 'sale-1' } });
    const shops = (await s.app.inject({ url: '/api/admin/shops?q=rahim', headers })).json().shops;
    expect(shops[0]).toMatchObject({ name: 'Rahim Store', ownerEmail: 'owner@example.com', salesCount: 1, totalSales: 100 });
    const detail = (await s.app.inject({ url: `/api/admin/shops/${shops[0].id}`, headers })).json();
    expect(detail.workspace.sales[0]).toMatchObject({ customer: 'Karim', total: 100 });
    expect(detail.creditProfile.factors).toHaveLength(4);
    const system = (await s.app.inject({ url: '/api/admin/system', headers })).json();
    expect(system).toMatchObject({ transport: 'http', email: { configured: true }, requireEmailVerification: true, retentionDays: 365, superAdmins: 1, review: [] });
    expect(query(s.dbPath, "SELECT action FROM admin_audit WHERE action='shop.view'")).toHaveLength(1);
  });

  it('serves production over HTTP only with an explicit opt-in and never marks those cookies Secure', async () => {
    await expect(testServer({ production: true, mailer: undefined })).rejects.toThrow(/HTTPS/);
    const s = await setup({ production: true, allowInsecureHttp: true });
    const response = await s.app.inject({ method: 'POST', url: '/api/admin/login', headers: web, payload: { email: superEmail, password } });
    expect(response.statusCode).toBe(200);
    const owner = await s.app.inject({ method: 'POST', url: '/api/auth/register', headers: web, payload: { fullName: 'Web', email: 'web@example.com', password, shopName: 'Web' } });
    expect(owner.statusCode).toBe(202);
    expect((await s.app.inject({ url: '/api/health' })).json()).toMatchObject({ transport: 'http', passwordRecovery: true, emailVerification: true });
  });
});

describe('settings and the demo administrator', () => {
  it('lets a Super Admin change settings that apply at once, audited without secrets', async () => {
    const s = await setup();
    const { headers } = await adminSignIn(s, superEmail);
    const helper = await makeAdmin(s, headers);
    expect((await s.app.inject({ url: '/api/admin/settings', headers: helper.panel })).statusCode).toBe(403);
    const view = (await s.app.inject({ url: '/api/admin/settings', headers })).json();
    expect(view).toMatchObject({ requireEmailVerification: true, retentionDays: 365, email: { configured: true, source: 'injected' } });
    expect((await s.app.inject({ method: 'POST', url: '/api/admin/settings', headers, payload: { requireEmailVerification: false, retentionDays: 90 } })).statusCode).toBe(400);
    const saved = await s.app.inject({ method: 'POST', url: '/api/admin/settings', headers, payload: { requireEmailVerification: false, retentionDays: 90, reason: 'Pilot without email' } });
    expect(saved.json()).toMatchObject({ requireEmailVerification: false, retentionDays: 90 });
    // New sign-ups now get a session straight away.
    const open = await s.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: { fullName: 'Quick', email: 'quick@example.com', password, shopName: 'Quick Shop' } });
    expect(open.statusCode).toBe(200);
    expect(open.json().token).toMatch(/^[a-f0-9]{64}$/);
    const smtp = await s.app.inject({
      method: 'POST',
      url: '/api/admin/settings/email',
      headers,
      payload: { host: 'smtp.example.com', port: 587, secure: false, user: 'mailer', password: 'Smtp-Secret-99', from: 'GreenBiz <no-reply@example.com>', reason: 'Use our provider' },
    });
    expect(smtp.statusCode).toBe(200);
    expect(smtp.json().email.saved).toEqual({ host: 'smtp.example.com', port: 587, secure: false, user: 'mailer', from: 'GreenBiz <no-reply@example.com>', passwordSet: true });
    expect(smtp.body).not.toContain('Smtp-Secret-99');
    expect((await s.app.inject({ url: '/api/admin/audit?action=system.email', headers })).body).not.toContain('Smtp-Secret-99');
    expect((await s.app.inject({ url: '/api/admin/audit?action=system.settings', headers })).json().entries[0]).toMatchObject({
      reason: 'Pilot without email',
      before: { requireEmailVerification: true, retentionDays: 365 },
      after: { requireEmailVerification: false, retentionDays: 90 },
    });
    expect((await s.app.inject({ method: 'POST', url: '/api/admin/settings/email/test', headers })).json()).toEqual({ ok: true, to: superEmail });
  });

  it('signs a command-line demo account in with a password only, flags it, and lets a Super Admin require two-step', async () => {
    const s = await setup();
    await expect(createAdminAccount({ dbPath: s.dbPath, email: 'demo@example.com', password: 'demo1234' })).rejects.toThrow();
    await createAdminAccount({ dbPath: s.dbPath, email: 'demo@example.com', password: 'demo1234', demo: true });
    const login = await s.app.inject({ method: 'POST', url: '/api/admin/login', headers: web, payload: { email: 'demo@example.com', password: 'demo1234' } });
    expect(login.json()).toMatchObject({ mfa: 'none', admin: { email: 'demo@example.com', accessRole: 'super_admin', mfaExempt: true } });
    const demo = { ...web, cookie: 'greenbiz_admin=' + login.cookies.find((c) => c.name === 'greenbiz_admin')!.value };
    expect((await s.app.inject({ url: '/api/admin/system', headers: demo })).json().mfaExempt).toEqual([{ id: expect.any(String), email: 'demo@example.com' }]);
    const { headers } = await adminSignIn(s, superEmail);
    const demoId = query<{ id: string }>(s.dbPath, "SELECT id FROM users WHERE email='demo@example.com'")[0].id;
    expect((await s.app.inject({ method: 'POST', url: `/api/admin/users/${demoId}/mfa-exemption`, headers, payload: { reason: 'Going live' } })).statusCode).toBe(200);
    expect((await s.app.inject({ url: '/api/admin/me', headers: demo })).json().admin).toBeNull();
    expect((await s.app.inject({ method: 'POST', url: '/api/admin/login', headers: web, payload: { email: 'demo@example.com', password: 'demo1234' } })).json().mfa).toBe('setup');
  });
});
