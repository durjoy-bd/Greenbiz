import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createAdminAccount } from './admin';
import { temporaryPassword } from './admin-routes';
import { passwordSchema } from './validation';

const origin = 'http://127.0.0.1:8787';
const web = { origin };
const native = { 'x-greenbiz-client': 'native' };
const adminEmail = 'admin@example.com';
const adminPassword = 'Admin-password-789!';
const apps: FastifyInstance[] = [];
const dirs: string[] = [];

async function setup(options: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'greenbiz-admin-'));
  dirs.push(dir);
  const dbPath = join(dir, 'test.sqlite');
  await createAdminAccount({ dbPath, email: adminEmail, password: adminPassword });
  const app = await buildApp({ dbPath, publicOrigin: origin, ...options });
  apps.push(app);
  await app.ready();
  return { app, dbPath };
}
async function merchant(app: FastifyInstance, email = 'owner@example.com') {
  const response = await app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: { email, password: 'A-strong-password-456!', shopName: 'Rahim Store', owner: 'Rahim', location: 'Dhaka', phone: '01700000000', bkash: '01700000000' } });
  expect(response.statusCode).toBe(200);
  const session = response.json();
  return { id: session.user.id as string, headers: { ...native, authorization: `Bearer ${session.token}` } };
}
async function admin(app: FastifyInstance) {
  const response = await app.inject({ method: 'POST', url: '/api/admin/login', headers: web, payload: { email: adminEmail, password: adminPassword } });
  expect(response.statusCode).toBe(200);
  const cookie = response.cookies.find((c) => c.name === 'greenbiz_admin')!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/admin' });
  return { ...web, cookie: `greenbiz_admin=${cookie.value}` };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe('platform administration', () => {
  it('keeps administrator sign-in separate from shop owners', async () => {
    const { app } = await setup();
    const owner = await merchant(app);
    expect((await app.inject({ method: 'GET', url: '/api/admin/overview', headers: owner.headers })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/admin/login', headers: web, payload: { email: 'owner@example.com', password: 'A-strong-password-456!' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: adminEmail, password: adminPassword } })).statusCode).toBe(401);
    const headers = await admin(app);
    expect((await app.inject({ method: 'GET', url: '/api/admin/me', headers })).json().admin.email).toBe(adminEmail);
    // An admin cookie cannot be used for shop-owner routes.
    expect((await app.inject({ method: 'GET', url: '/api/workspace', headers })).statusCode).toBe(401);
    await app.inject({ method: 'POST', url: '/api/admin/logout', headers });
    expect((await app.inject({ method: 'GET', url: '/api/admin/me', headers })).json().admin).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/admin/overview', headers })).statusCode).toBe(401);
  });

  it('shows platform totals, every shop and its full records, and audits each view', async () => {
    const { app } = await setup();
    const owner = await merchant(app);
    await app.inject({ method: 'POST', url: '/api/actions', headers: owner.headers, payload: { type: 'product.save', product: { name: 'Rice', category: 'Other', unit: 'kg', description: '', quantity: 10, cost: 40, price: 50, lowAt: 2, source: 'manual' } } });
    const workspace = (await app.inject({ url: '/api/workspace', headers: owner.headers })).json();
    await app.inject({ method: 'POST', url: '/api/actions', headers: owner.headers, payload: { type: 'sale.create', items: [{ productId: workspace.products[0].id, quantity: 2 }], method: 'bkash', channel: 'shop', customer: 'Karim', requestId: 'sale-1' } });
    const headers = await admin(app);
    const overview = (await app.inject({ url: '/api/admin/overview', headers })).json();
    expect(overview.accounts).toMatchObject({ merchants: 1, administrators: 1 });
    expect(overview.totals).toMatchObject({ shops: 1, products: 1, salesCount: 1, totalSales: 100 });
    expect(overview.daily).toHaveLength(30);
    const shops = (await app.inject({ url: '/api/admin/shops?q=rahim', headers })).json().shops;
    expect(shops).toHaveLength(1);
    expect(shops[0]).toMatchObject({ name: 'Rahim Store', ownerEmail: 'owner@example.com', salesCount: 1 });
    expect((await app.inject({ url: '/api/admin/shops?q=nobody', headers })).json().shops).toHaveLength(0);
    const detail = (await app.inject({ url: `/api/admin/shops/${shops[0].id}`, headers })).json();
    expect(detail.workspace.sales[0]).toMatchObject({ customer: 'Karim', total: 100 });
    expect(detail.creditProfile.factors).toHaveLength(4);
    const audit = (await app.inject({ url: '/api/admin/audit', headers })).json().audit;
    expect(audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['admin.login', 'shop.view']));
    const activity = (await app.inject({ url: '/api/admin/activity', headers })).json().activity;
    expect(activity[0]).toMatchObject({ shopName: 'Rahim Store', title: 'Sale recorded' });
  });

  it('suspends, restores, signs out and resets shop-owner accounts', async () => {
    const { app } = await setup();
    const owner = await merchant(app);
    const headers = await admin(app);
    expect((await app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/suspend`, headers, payload: { suspended: true } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/workspace', headers: owner.headers })).statusCode).toBe(401);
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'owner@example.com', password: 'A-strong-password-456!' } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toMatch(/suspended/);
    await app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/suspend`, headers, payload: { suspended: false } });
    const users = (await app.inject({ url: '/api/admin/users', headers })).json().users;
    expect(users[0]).toMatchObject({ email: 'owner@example.com', suspendedAt: null, shops: [{ name: 'Rahim Store' }] });
    const reset = (await app.inject({ method: 'POST', url: `/api/admin/users/${owner.id}/reset-password`, headers })).json();
    expect(passwordSchema.safeParse(reset.temporaryPassword).success).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'owner@example.com', password: 'A-strong-password-456!' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'owner@example.com', password: reset.temporaryPassword } })).statusCode).toBe(200);
  });

  it('deletes an account only with its exact email and creates bank users and administrators', async () => {
    const { app } = await setup();
    const owner = await merchant(app);
    const headers = await admin(app);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/users/${owner.id}`, headers, payload: { email: 'wrong@example.com' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/users/${owner.id}`, headers, payload: { email: 'owner@example.com' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/admin/shops', headers })).json().shops).toHaveLength(0);
    expect((await app.inject({ method: 'POST', url: '/api/admin/banks', headers, payload: { email: 'bank@example.com', password: 'weak' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/admin/banks', headers, payload: { email: 'bank@example.com', password: 'Bank-password-123!' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'bank@example.com', password: 'Bank-password-123!' } })).json().user.role).toBe('bank');
    expect((await app.inject({ method: 'POST', url: '/api/admin/administrators', headers, payload: { email: 'second@example.com', password: 'Second-admin-123!' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/admin/administrators', headers })).json().administrators).toHaveLength(2);
    expect((await app.inject({ url: '/api/admin/system', headers })).json()).toMatchObject({ transport: 'http' });
  });

  it('rejects admin mutations from another origin', async () => {
    const { app } = await setup();
    const headers = await admin(app);
    expect((await app.inject({ method: 'POST', url: '/api/admin/banks', headers: { ...headers, origin: 'https://evil.example' }, payload: { email: 'bank@example.com', password: 'Bank-password-123!' } })).statusCode).toBe(403);
  });
});

describe('account security', () => {
  it('lets a shop owner change their password, signing out other devices', async () => {
    const { app } = await setup();
    const owner = await merchant(app);
    const second = await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'owner@example.com', password: 'A-strong-password-456!' } });
    const other = { ...native, authorization: `Bearer ${second.json().token}` };
    expect((await app.inject({ method: 'POST', url: '/api/auth/password', headers: owner.headers, payload: { current: 'nope', password: 'New-password-321!' } })).statusCode).toBe(401);
    const changed = await app.inject({ method: 'POST', url: '/api/auth/password', headers: owner.headers, payload: { current: 'A-strong-password-456!', password: 'New-password-321!' } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().token).toMatch(/^[a-f0-9]{64}$/);
    expect((await app.inject({ url: '/api/workspace', headers: other })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'owner@example.com', password: 'New-password-321!' } })).statusCode).toBe(200);
  });

  it('serves production over HTTP only with an explicit opt-in and never marks those cookies Secure', async () => {
    await expect(setup({ production: true })).rejects.toThrow(/HTTPS/);
    const { app } = await setup({ production: true, allowInsecureHttp: true });
    const response = await app.inject({ method: 'POST', url: '/api/admin/login', headers: web, payload: { email: adminEmail, password: adminPassword } });
    expect(response.cookies[0].secure).toBeFalsy();
    expect((await app.inject({ url: '/api/health' })).json().transport).toBe('http');
  });

  it('generates temporary passwords that satisfy the policy', () => {
    for (let i = 0; i < 50; i++) expect(passwordSchema.safeParse(temporaryPassword()).success).toBe(true);
  });
});
