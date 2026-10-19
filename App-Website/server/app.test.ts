import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildApp } from './app';
import { createBankAccount } from './admin';
import { dashboard } from '../shared/domain';
import type { FastifyInstance } from 'fastify';

const origin = 'http://127.0.0.1:8787';
const native = { 'x-greenbiz-client': 'native' };
const registration = (email = 'merchant@example.com') => ({ email, password: 'A-strong-password-456!', shopName: 'Test shop', owner: 'Shop owner', location: 'Dhaka', phone: '01700000000', bkash: '01700000000' });
const apps: FastifyInstance[] = [];
const dirs: string[] = [];
async function setup(options: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'greenbiz-test-')); dirs.push(dir);
  const dbPath = join(dir, 'test.sqlite');
  const app = await buildApp({ dbPath, publicOrigin: origin, ...options }); apps.push(app);
  await app.ready();
  return { app, dbPath };
}
async function register(app: FastifyInstance, email?: string) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: registration(email) });
  expect(response.statusCode).toBe(200);
  const session = response.json();
  return { ...session, headers: { ...native, authorization: `Bearer ${session.token}` } };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
});

describe('authenticated persistent API', () => {
  it('replays prepared payment creation and review with the same id and rejects collisions without committing a sync receipt', async () => {
    const { app, dbPath } = await setup(); const user = await register(app); const createdAt = new Date().toISOString();
    const envelope = { id: 'prepared-payment-envelope', baseVersion: 1, createdAt, action: { type: 'payment.create', id: 'prepared-payment', customer: 'Buyer', order: 'Invoice', channel: 'facebook', amount: 100, trxId: 'ABC1234567', requestId: 'prepared-payment-request' } };
    const first = await app.inject({ method: 'POST', url: '/api/sync', headers: user.headers, payload: envelope });
    expect(first.statusCode).toBe(200); expect(first.json().payments[0].id).toBe('prepared-payment');
    const reviewed = await app.inject({ method: 'POST', url: '/api/sync', headers: user.headers, payload: { id: 'prepared-review', baseVersion: 2, createdAt, action: { type: 'payment.review', id: 'prepared-payment', decision: 'manual', received: 100, note: 'Checked manually' } } });
    expect(reviewed.statusCode).toBe(200); expect(reviewed.json().payments[0]).toMatchObject({ id: 'prepared-payment', status: 'manual', received: 100 });
    const retry = await app.inject({ method: 'POST', url: '/api/sync', headers: user.headers, payload: envelope });
    expect(retry.statusCode).toBe(200); expect(retry.json().version).toBe(3); expect(retry.json().payments).toEqual(reviewed.json().payments);
    const collision = await app.inject({ method: 'POST', url: '/api/sync', headers: user.headers, payload: { ...envelope, id: 'colliding-payment-envelope', baseVersion: 3, action: { ...envelope.action, requestId: 'colliding-payment-request' } } });
    expect(collision.statusCode).toBe(400);
    const latest = (await app.inject({ url: '/api/workspace', headers: user.headers })).json();
    expect(latest.version).toBe(3); expect(latest.payments).toEqual(reviewed.json().payments);
    const db = new DatabaseSync(dbPath); expect(db.prepare('SELECT count(*) AS count FROM sync_requests').get()).toEqual({ count: 2 }); db.close();
  });
  it('rejects impossible sync timezone offsets without committing a workspace change or replay receipt', async () => {
    const { app, dbPath } = await setup({ now: () => new Date('2026-10-19T00:00:00Z') }); const user = await register(app);
    for (const [index, createdAt] of ['2000-01-01T00:00:00+99:99', '2026-10-19T00:00:00+24:00'].entries()) {
      const response = await app.inject({ method: 'POST', url: '/api/sync', headers: user.headers, payload: { id: `invalid-date-${index}`, baseVersion: 1, createdAt, action: { type: 'shop.update', shop: { name: 'Invalid date accepted' } } } });
      expect(response.statusCode).toBe(400);
    }
    const workspace = (await app.inject({ url: '/api/workspace', headers: user.headers })).json();
    expect(workspace.version).toBe(1); expect(workspace.shop.name).toBe('Test shop');
    const db = new DatabaseSync(dbPath); expect(db.prepare('SELECT count(*) AS count FROM sync_requests').get()).toEqual({ count: 0 }); db.close();
  });
  it('preserves the original business date of a delayed offline sale while normal actions use server time', async () => {
    const serverNow = '2026-10-19T01:00:00.000Z', occurredAt = '2026-10-18T17:30:00.000Z';
    const { app } = await setup({ now: () => new Date(serverNow) }); const user = await register(app);
    const stock = (await app.inject({ method: 'POST', url: '/api/actions', headers: user.headers, payload: { type: 'product.save', product: { name: 'Rice', category: '', unit: 'kg', description: '', quantity: 2, cost: 40, price: 50, lowAt: 0, source: 'manual' } } })).json();
    const action = { type: 'sale.create', items: [{ productId: stock.products[0].id, quantity: 0.5 }], method: 'cash', channel: 'shop', customer: '', requestId: 'late-offline-sale' };
    const offline = await app.inject({ method: 'POST', url: '/api/sync', headers: user.headers, payload: { id: 'late-envelope', baseVersion: stock.version, createdAt: occurredAt, action } });
    expect(offline.statusCode).toBe(200); expect(offline.json().sales[0].createdAt).toBe(occurredAt); expect(offline.json().activity.at(-1).createdAt).toBe(occurredAt);
    const statistics = dashboard(offline.json(), new Date(serverNow));
    expect(statistics.todaySales).toBe(0); expect(statistics.daily.find(day => day.date === '2026-10-18')?.value).toBe(25);
    const online = (await app.inject({ method: 'POST', url: '/api/actions', headers: user.headers, payload: { ...action, requestId: 'online-sale' } })).json();
    expect(online.sales[1].createdAt).toBe(serverNow);
    expect(dashboard(online, new Date(serverNow)).todaySales).toBe(25);
  });
  it('isolates multiple shops, public invoices, bank consent and interest, and cascades an account deletion', async () => {
    const { app, dbPath } = await setup(); const a = await register(app); const b = await register(app, 'other-owner@example.com');
    const created = await app.inject({ method: 'POST', url: '/api/shops', headers: a.headers, payload: { name: 'Second shop', owner: 'Second owner', location: 'Chittagong' } });
    expect(created.statusCode).toBe(200);
    const second = created.json(); const headers = { ...a.headers, 'x-greenbiz-shop': second.id };
    expect(second.workspace.shop.name).toBe('Second shop');
    expect((await app.inject({ url: '/api/shops', headers: a.headers })).json()).toEqual({ shops: [{ id: a.user.id, name: 'Test shop' }, { id: second.id, name: 'Second shop' }], activeDefault: a.user.id });
    expect((await app.inject({ url: '/api/workspace', headers: { ...b.headers, 'x-greenbiz-shop': second.id } })).statusCode).toBe(404);
    await app.inject({ method: 'POST', url: '/api/actions', headers, payload: { type: 'shop.update', shop: { shareScore: true } } });
    const order = (await app.inject({ method: 'POST', url: '/api/orders', headers, payload: { customer: 'Buyer', items: [{ name: 'Oil', quantity: 0.5, price: 100 }], delivery: 0 } })).json();
    expect(order.token).toBeTypeOf('string');
    expect((await app.inject({ url: '/api/orders', headers: a.headers })).json().orders).toEqual([]);
    const claim = await app.inject({ method: 'POST', url: `/api/public/orders/${order.token}/claim`, headers: native, payload: { trxId: 'AAA1234567' } });
    expect(claim.statusCode).toBe(200); expect(claim.json().shop.name).toBe('Second shop');
    expect((await app.inject({ url: '/api/workspace', headers })).json().payments).toHaveLength(1);
    expect((await app.inject({ url: '/api/workspace', headers: a.headers })).json().payments).toEqual([]);
    await createBankAccount({ dbPath, email: 'multi-bank@example.com', password: 'Bank-password-123!' });
    const login = (await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'multi-bank@example.com', password: 'Bank-password-123!' } })).json();
    const bank = { ...native, authorization: `Bearer ${login.token}` };
    const profiles = (await app.inject({ url: '/api/bank/businesses', headers: bank })).json().businesses;
    expect(profiles.map((profile: { id: string }) => profile.id)).toEqual([second.id]);
    expect((await app.inject({ method: 'POST', url: '/api/bank/offers', headers: bank, payload: { businessId: second.id, bank: 'Bank', name: 'Loan', kind: 'loan', amount: 1000, annualRate: 8, months: 12, requirements: '' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/bank/document-requests', headers: bank, payload: { businessId: second.id, message: 'Please prepare documents' } })).statusCode).toBe(200);
    const state = (await app.inject({ url: '/api/workspace', headers })).json();
    expect(state.activity.at(-1).title).toBe('Document request');
    expect((await app.inject({ method: 'POST', url: `/api/offers/${state.offers[0].id}/interest`, headers: a.headers, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/offers/${state.offers[0].id}/interest`, headers, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/bank/interests', headers: bank })).json().interests[0].businessId).toBe(second.id);
    expect((await app.inject({ method: 'DELETE', url: `/api/shops/${second.id}`, headers: b.headers, payload: { name: 'Second shop' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/shops/${second.id}`, headers: a.headers, payload: { name: 'Wrong name' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/auth/account', headers: a.headers, payload: { password: registration().password } })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/public/orders/${order.token}` })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/bank/interests', headers: bank })).json().interests).toEqual([]);
    const db = new DatabaseSync(dbPath);
    expect(db.prepare('SELECT id FROM shops WHERE owner_id=?').all(a.user.id)).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.close();
  });
  it('deletes a confirmed shop and refuses deleting the last shop, retaining a usable default', async () => {
    const { app } = await setup(); const user = await register(app);
    expect((await app.inject({ method: 'DELETE', url: `/api/shops/${user.user.id}`, headers: user.headers, payload: { name: 'Test shop' } })).statusCode).toBe(409);
    const second = (await app.inject({ method: 'POST', url: '/api/shops', headers: user.headers, payload: { name: 'Remaining' } })).json();
    expect((await app.inject({ method: 'DELETE', url: `/api/shops/${user.user.id}`, headers: user.headers, payload: { name: 'Test shop' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/shops', headers: user.headers })).json().activeDefault).toBe(second.id);
    expect((await app.inject({ url: '/api/workspace', headers: user.headers })).json().shop.name).toBe('Remaining');
  });
  it('durably replays an offline envelope once after a lost response and rejects reuse or revision conflicts', async () => {
    const { app, dbPath } = await setup(); const user = await register(app);
    const envelope = { id: 'offline-1', baseVersion: 1, createdAt: new Date().toISOString(), action: { type: 'product.save', create: true, product: { id: 'offline-product', name: 'Flour', category: '', unit: 'kg', description: '', quantity: 1.125, cost: 10, price: 20, lowAt: 0.1, source: 'manual' } } };
    const response = await app.inject({ method: 'POST', url: '/api/sync', headers: user.headers, payload: envelope });
    expect(response.statusCode).toBe(200); expect(response.json().version).toBe(2);
    await app.inject({ method: 'POST', url: '/api/actions', headers: user.headers, payload: { type: 'shop.update', shop: { name: 'Later name' } } });
    await app.close(); apps.splice(apps.indexOf(app), 1);
    const reopened = await buildApp({ dbPath, publicOrigin: origin }); apps.push(reopened);
    const retry = await reopened.inject({ method: 'POST', url: '/api/sync', headers: user.headers, payload: envelope });
    expect(retry.statusCode).toBe(200); expect(retry.json().products).toHaveLength(1); expect(retry.json().version).toBe(3); expect(retry.json().shop.name).toBe('Later name');
    expect((await reopened.inject({ method: 'POST', url: '/api/sync', headers: user.headers, payload: { ...envelope, baseVersion: 3 } })).statusCode).toBe(409);
    const conflict = await reopened.inject({ method: 'POST', url: '/api/sync', headers: user.headers, payload: { ...envelope, id: 'new-envelope' } });
    expect(conflict.statusCode).toBe(409); expect(conflict.json().error).toMatch(/revision|version/i);
    for (const payload of [{ ...envelope, injected: true }, { ...envelope, id: 'old', createdAt: '2000-01-01T00:00:00Z' }, { ...envelope, id: 'future', createdAt: '2099-01-01T00:00:00Z' }]) expect((await reopened.inject({ method: 'POST', url: '/api/sync', headers: user.headers, payload })).statusCode).toBe(400);
  });
  it('replays every action family through sync and commits no version or durable envelope on a rejected mutation', async () => {
    const { app, dbPath } = await setup(); const user = await register(app); let version = 1; let index = 0;
    const send = async (action: unknown, expected = 200) => {
      const response = await app.inject({ method: 'POST', url: '/api/sync', headers: user.headers, payload: { id: `queued-${++index}`, baseVersion: version, createdAt: new Date().toISOString(), action } });
      expect(response.statusCode).toBe(expected);
      if (expected === 200) { version++; expect(response.json().version).toBe(version); }
      return response.json();
    };
    await send({ type: 'product.save', create: true, product: { id: 'rice', name: 'Rice', category: '', unit: 'kg', description: '', quantity: 1, cost: 40, price: 50, lowAt: 0.1, source: 'manual' } });
    const receipt = { id: 'income', amount: 25, direction: 'in', method: 'bank', reference: 'PRIVATE-REFERENCE', party: 'PRIVATE-PARTY', occurredAt: new Date().toISOString(), business: true, source: 'manual', note: '' };
    await send({ type: 'transaction.import', requestId: 'import', transactions: [receipt] });
    await send({ type: 'transaction.classify', id: 'income', business: false });
    await send({ type: 'sale.create', items: [{ productId: 'rice', quantity: 0.5 }], method: 'bank', channel: 'shop', customer: '', requestId: 'rejected-sale', transactionId: 'income' }, 400);
    expect((await app.inject({ url: '/api/workspace', headers: user.headers })).json().products[0].quantity).toBe(1);
    await send({ type: 'transaction.classify', id: 'income', business: true });
    const linked = await send({ type: 'sale.create', items: [{ productId: 'rice', quantity: 0.5 }], method: 'bank', channel: 'shop', customer: '', requestId: 'sale', transactionId: 'income' });
    expect(linked.transactions[0].linkedSaleId).toBe(linked.sales[0].id);
    const payment = await send({ type: 'payment.create', customer: 'Buyer', order: 'Invoice', channel: 'facebook', amount: 20, trxId: 'AAA1234567', requestId: 'payment' });
    await send({ type: 'payment.review', id: payment.payments[0].id, decision: 'manual', received: 20, note: 'Manually checked' });
    await send({ type: 'shop.update', shop: { name: 'Updated name' } });
    await send({ type: 'product.delete', id: 'rice' });
    await send({ type: 'transaction.import', requestId: 'disposable', transactions: [{ ...receipt, id: 'disposable', reference: '' }] });
    await send({ type: 'transaction.delete', id: 'disposable' });
    await send({ type: 'shop.update', shop: { name: 'Injected' }, extra: true }, 400);
    const db = new DatabaseSync(dbPath);
    expect(db.prepare('SELECT count(*) AS count FROM sync_requests').get()).toEqual({ count: 11 }); db.close();
    const latest = (await app.inject({ url: '/api/workspace', headers: user.headers })).json();
    expect(latest.version).toBe(version); expect(latest.shop.name).toBe('Updated name'); expect(latest.transactions).toHaveLength(1);
  });
  it('registers an empty workspace, hashes passwords/tokens and persists through a restart', async () => {
    const { app, dbPath } = await setup();
    const session = await register(app);
    expect(session.user.role).toBe('merchant');
    const state = (await app.inject({ url: '/api/workspace', headers: session.headers })).json();
    expect(state.sales).toEqual([]);
    const db = new DatabaseSync(dbPath);
    const user = db.prepare('SELECT password_hash FROM users').get() as { password_hash: string };
    const token = db.prepare('SELECT token_hash FROM sessions').get() as { token_hash: string };
    expect(user.password_hash).not.toBe(registration().password);
    expect(token.token_hash).not.toBe(session.token);
    expect(token.token_hash).toHaveLength(64);
    db.close();
    await app.close(); apps.splice(apps.indexOf(app), 1);
    const reopened = await buildApp({ dbPath, publicOrigin: origin }); apps.push(reopened);
    const response = await reopened.inject({ url: '/api/workspace', headers: session.headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().shop.name).toBe('Test shop');
  });
  it('prevents caching authenticated or public order API responses', async () => {
    const { app } = await setup(); const user = await register(app);
    const response = await app.inject({ url: '/api/workspace', headers: user.headers });
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ url: '/api/health' })).headers['cache-control']).toBe('no-store');
  });
  it('rejects weak passwords, unknown registration fields and public bank provisioning', async () => {
    const { app } = await setup();
    for (const payload of [{ ...registration(), password: 'short' }, { ...registration(), role: 'bank' }, { ...registration(), userId: 'someone' }]) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty('error');
    }
  });
  it('uses generic invalid login errors and revokes sessions at logout and logout-all', async () => {
    const { app } = await setup();
    const a = await register(app);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: registration().email, password: registration().password } });
    expect(login.statusCode).toBe(200);
    const b = { ...native, authorization: `Bearer ${login.json().token}` };
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'missing@example.com', password: 'wrong-password!' } });
    const bad2 = await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: registration().email, password: 'wrong-password!' } });
    expect(bad.json()).toEqual(bad2.json());
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: a.headers })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/me', headers: a.headers })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/auth/me', headers: b })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/auth/logout-all', headers: b });
    expect((await app.inject({ url: '/api/auth/me', headers: b })).statusCode).toBe(401);
  });
  it('sets strict httpOnly web cookies, does not return a web token and rejects cross-origin/missing-origin mutations', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { origin }, payload: registration() });
    expect(response.statusCode).toBe(200);
    expect(response.json().token).toBeUndefined();
    const cookieHeader = response.headers['set-cookie'] as string;
    expect(cookieHeader).toContain('HttpOnly'); expect(cookieHeader).toContain('SameSite=Strict');
    const cookie = cookieHeader.split(';')[0];
    for (const headers of [{ cookie }, { cookie, origin: 'https://evil.example' }, { cookie, ...native }]) {
      expect((await app.inject({ method: 'POST', url: '/api/actions', headers, payload: { type: 'shop.update', shop: { name: 'Attacker' } } })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'POST', url: '/api/actions', headers: { cookie, origin }, payload: { type: 'shop.update', shop: { name: 'New shop' } } })).statusCode).toBe(200);
  });
  it('isolates ownership and persists idempotent sales instead of trusting client workspace fields', async () => {
    const { app, dbPath } = await setup(); const a = await register(app); const b = await register(app, 'b@example.com');
    const saved = await app.inject({ method: 'POST', url: '/api/actions', headers: a.headers, payload: { type: 'product.save', product: { name: 'Rice', category: '', unit: 'kg', description: '', quantity: 10, cost: 40, price: 50, lowAt: 1, source: 'manual' } } });
    const id = saved.json().products[0].id;
    const action = { type: 'sale.create', items: [{ productId: id, quantity: 2 }], method: 'cash', channel: 'shop', customer: 'Private customer', requestId: 'same-sale' };
    for (let i = 0; i < 2; i++) expect((await app.inject({ method: 'POST', url: '/api/actions', headers: a.headers, payload: action })).statusCode).toBe(200);
    const state = (await app.inject({ url: '/api/workspace', headers: a.headers })).json();
    expect(state.products[0].quantity).toBe(8); expect(state.sales).toHaveLength(1);
    const cacheDb = new DatabaseSync(dbPath);
    const cacheRow = cacheDb.prepare('SELECT document FROM workspaces WHERE user_id=?').get(a.user.id) as { document: string };
    const withoutCache = JSON.parse(cacheRow.document); withoutCache.processedRequests = [];
    cacheDb.prepare('UPDATE workspaces SET document=? WHERE user_id=?').run(JSON.stringify(withoutCache), a.user.id); cacheDb.close();
    const retriedAfterCacheEviction = await app.inject({ method: 'POST', url: '/api/actions', headers: a.headers, payload: action });
    expect(retriedAfterCacheEviction.json().products[0].quantity).toBe(8); expect(retriedAfterCacheEviction.json().sales).toHaveLength(1);
    expect((await app.inject({ url: '/api/workspace', headers: b.headers })).json().products).toEqual([]);
    expect((await app.inject({ method: 'POST', url: '/api/actions', headers: b.headers, payload: { type: 'product.delete', id } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/actions', headers: a.headers, payload: { type: 'shop.update', shop: { name: 'Injected' }, offers: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/actions', headers: a.headers, payload: { ...action, items: [{ productId: id, quantity: 3 }] } })).statusCode).toBe(409);
  });
  it('keeps order snapshots private and derives public claim amounts from the invoice', async () => {
    const { app } = await setup(); const a = await register(app); const b = await register(app, 'b@example.com');
    const result = await app.inject({ method: 'POST', url: '/api/orders', headers: a.headers, payload: { customer: 'Buyer', items: [{ name: 'Rice', quantity: 2, price: 50.125 }], delivery: 20 } });
    expect(result.statusCode).toBe(200); const { token, url } = result.json(); expect(token.length).toBeGreaterThanOrEqual(40); expect(url).toContain(token);
    const publicOrder = (await app.inject({ url: `/api/public/orders/${token}` })).json();
    expect(publicOrder.total).toBe(120.26); expect(publicOrder.items[0].price).toBe(50.13);
    expect(publicOrder.shop).toEqual({ name: 'Test shop', location: 'Dhaka', bkash: '01700000000' });
    expect(JSON.stringify(publicOrder)).not.toContain(registration().email);
    expect((await app.inject({ url: '/api/orders', headers: b.headers })).json().orders).toEqual([]);
    expect((await app.inject({ url: '/api/public/orders/not-a-real-order' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/public/orders/${token}/claim`, headers: native, payload: { trxId: 'ABC1234567', amount: 1 } })).statusCode).toBe(400);
    const claim = await app.inject({ method: 'POST', url: `/api/public/orders/${token}/claim`, headers: { origin }, payload: { trxId: 'ABC1234567' } });
    expect(claim.statusCode).toBe(200); expect(claim.json().payment.amount).toBe(120.26); expect(claim.json().payment.status).toBe('waiting');
    const repeat = await app.inject({ method: 'POST', url: `/api/public/orders/${token}/claim`, headers: { origin }, payload: { trxId: 'ABC1234567' } });
    expect(repeat.json().payment.id).toBe(claim.json().payment.id);
    expect((await app.inject({ url: '/api/workspace', headers: a.headers })).json().payments).toHaveLength(1);
  });
  it('flags transaction references reused by other merchants without verifying either claim', async () => {
    const { app } = await setup(); const a = await register(app); const b = await register(app, 'b@example.com');
    const action = { type: 'payment.create', customer: 'Buyer', order: 'Invoice', channel: 'website', amount: 100, trxId: 'ABC1234567', requestId: 'claim' };
    const first = await app.inject({ method: 'POST', url: '/api/actions', headers: a.headers, payload: action });
    const second = await app.inject({ method: 'POST', url: '/api/actions', headers: b.headers, payload: action });
    expect(first.json().payments[0].status).toBe('waiting'); expect(second.json().payments[0].status).toBe('duplicate');
    expect((await app.inject({ method: 'POST', url: '/api/actions', headers: a.headers, payload: { type: 'payment.review', id: first.json().payments[0].id, decision: 'verified', note: '' } })).statusCode).toBe(400);
  });
  it('binds a replayed rejected invoice claim to its exact payment after later private customer payments and a restart', async () => {
    const { app, dbPath } = await setup(); const merchant = await register(app);
    const created = await app.inject({ method: 'POST', url: '/api/orders', headers: merchant.headers, payload: { customer: 'Invoice buyer', items: [{ name: 'Item', quantity: 1, price: 100 }], delivery: 0 } });
    expect(created.statusCode).toBe(200); const token = created.json().token;
    const claim = (trxId: string) => app.inject({ method: 'POST', url: `/api/public/orders/${token}/claim`, headers: { origin }, payload: { trxId } });
    const first = await claim('AAA1234567'); expect(first.statusCode).toBe(200); const paymentA = first.json().payment;
    const reject = async (id: string) => { const response = await app.inject({ method: 'POST', url: '/api/actions', headers: merchant.headers, payload: { type: 'payment.review', id, decision: 'rejected', note: 'Reference not received' } }); expect(response.statusCode).toBe(200); };
    await reject(paymentA.id);
    const second = await claim('BBB1234567'); expect(second.statusCode).toBe(200); await reject(second.json().payment.id);
    const privatePayment = await app.inject({ method: 'POST', url: '/api/actions', headers: merchant.headers, payload: { type: 'payment.create', customer: 'PRIVATE OTHER CUSTOMER', order: 'PRIVATE INVOICE', channel: 'facebook', amount: 999, trxId: 'CCC1234567', requestId: 'private-customer-payment' } });
    expect(privatePayment.statusCode).toBe(200);
    await app.close(); apps.splice(apps.indexOf(app), 1);
    const reopened = await buildApp({ dbPath, publicOrigin: origin }); apps.push(reopened);
    const replay = await reopened.inject({ method: 'POST', url: `/api/public/orders/${token}/claim`, headers: { origin }, payload: { trxId: 'AAA1234567' } });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().payment.id).toBe(paymentA.id);
    expect(replay.json().payment).toMatchObject({ customer: 'Invoice buyer', amount: 100, trxId: 'AAA1234567', status: 'rejected' });
    expect(replay.body).not.toContain('PRIVATE OTHER CUSTOMER'); expect(replay.body).not.toContain('PRIVATE INVOICE');
    const publicRead = await reopened.inject({ url: `/api/public/orders/${token}` });
    expect(publicRead.json().payment.id).toBe(paymentA.id); expect(publicRead.body).not.toContain('PRIVATE OTHER CUSTOMER');
    expect((await reopened.inject({ url: '/api/workspace', headers: merchant.headers })).json().payments).toHaveLength(3);
  });
  it('fails closed when a pre-existing invoice payment link points at another customer record', async () => {
    const { app, dbPath } = await setup(); const merchant = await register(app);
    const token = (await app.inject({ method: 'POST', url: '/api/orders', headers: merchant.headers, payload: { customer: 'Invoice buyer', items: [{ name: 'Item', quantity: 1, price: 100 }], delivery: 0 } })).json().token;
    const workspace = (await app.inject({ method: 'POST', url: '/api/actions', headers: merchant.headers, payload: { type: 'payment.create', customer: 'PRIVATE CUSTOMER', order: 'PRIVATE INVOICE', channel: 'facebook', amount: 999, trxId: 'CCC1234567', requestId: 'unrelated' } })).json();
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE orders SET payment_id=? WHERE token=?').run(workspace.payments[0].id, token); db.close();
    const read = await app.inject({ url: `/api/public/orders/${token}` });
    expect(read.statusCode).toBe(409); expect(read.body).not.toContain('PRIVATE CUSTOMER'); expect(read.body).not.toContain('PRIVATE INVOICE');
    const claim = await app.inject({ method: 'POST', url: `/api/public/orders/${token}/claim`, headers: { origin }, payload: { trxId: 'AAA1234567' } });
    expect(claim.statusCode).toBe(409); expect(claim.body).not.toContain('PRIVATE CUSTOMER');
  });
  it('refuses to guess a legacy rejected claim result when a migration-era request has no payment identity', async () => {
    const { app, dbPath } = await setup(); const merchant = await register(app);
    const token = (await app.inject({ method: 'POST', url: '/api/orders', headers: merchant.headers, payload: { customer: 'Buyer', items: [{ name: 'Item', quantity: 1, price: 100 }], delivery: 0 } })).json().token;
    const claim = (trxId: string) => app.inject({ method: 'POST', url: `/api/public/orders/${token}/claim`, headers: { origin }, payload: { trxId } });
    const first = (await claim('AAA1234567')).json();
    await app.inject({ method: 'POST', url: '/api/actions', headers: merchant.headers, payload: { type: 'payment.review', id: first.payment.id, decision: 'rejected', note: '' } });
    const second = (await claim('BBB1234567')).json();
    await app.inject({ method: 'POST', url: '/api/actions', headers: merchant.headers, payload: { type: 'payment.review', id: second.payment.id, decision: 'rejected', note: '' } });
    await app.inject({ method: 'POST', url: '/api/actions', headers: merchant.headers, payload: { type: 'payment.create', customer: 'PRIVATE CUSTOMER', order: 'PRIVATE INVOICE', channel: 'facebook', amount: 999, trxId: 'CCC1234567', requestId: 'unrelated' } });
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE idempotency SET result_id=NULL WHERE user_id=? AND request_key=?').run(merchant.user.id, `order:${first.id}:AAA1234567`); db.close();
    const replay = await claim('AAA1234567');
    expect(replay.statusCode).toBe(409); expect(replay.body).not.toContain('PRIVATE CUSTOMER');
    const publicRead = await app.inject({ url: `/api/public/orders/${token}` });
    expect(publicRead.statusCode).toBe(200); expect(publicRead.json().payment.id).toBe(second.payment.id); expect(publicRead.body).not.toContain('PRIVATE CUSTOMER');
    expect((await app.inject({ url: '/api/workspace', headers: merchant.headers })).json().payments).toHaveLength(3);
  });
  it('requires bank role and merchant consent, exposes only aggregate profiles, and stores real offers', async () => {
    const { app, dbPath } = await setup(); const merchant = await register(app);
    await createBankAccount({ dbPath, email: 'bank@example.com', password: 'Bank-password-123!' });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'bank@example.com', password: 'Bank-password-123!' } });
    const bank = { ...native, authorization: `Bearer ${login.json().token}` };
    expect((await app.inject({ url: '/api/bank/businesses', headers: merchant.headers })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/workspace', headers: bank })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/bank/businesses', headers: bank })).json().businesses).toEqual([]);
    const offer = { businessId: merchant.user.id, bank: 'Test bank', name: 'Business loan', kind: 'loan', amount: 100000, annualRate: 8, months: 12, requirements: 'Subject to bank assessment' };
    expect((await app.inject({ method: 'POST', url: '/api/bank/offers', headers: bank, payload: offer })).statusCode).toBe(403);
    await app.inject({ method: 'POST', url: '/api/actions', headers: merchant.headers, payload: { type: 'shop.update', shop: { shareScore: true } } });
    const profiles = (await app.inject({ url: '/api/bank/businesses', headers: bank })).json().businesses;
    expect(profiles).toHaveLength(1); expect(profiles[0]).not.toHaveProperty('products'); expect(profiles[0]).not.toHaveProperty('customers');
    expect((await app.inject({ method: 'POST', url: '/api/bank/offers', headers: bank, payload: { ...offer, amount: 0.001 } })).statusCode).toBe(400);
    const beforeOffer=(await app.inject({url:'/api/workspace',headers:merchant.headers})).json().version;
    expect((await app.inject({ method: 'POST', url: '/api/bank/offers', headers: bank, payload: offer })).statusCode).toBe(200);
    const workspace = (await app.inject({ url: '/api/workspace', headers: merchant.headers })).json();
    expect(workspace.version).toBe(beforeOffer+1);
    expect(workspace.offers[0].bankId).toBe(login.json().user.id);
  });
  it('deletes only the authenticated account after password verification and cascades public orders/sessions', async () => {
    const { app } = await setup(); const a = await register(app); const b = await register(app, 'b@example.com');
    const order = (await app.inject({ method: 'POST', url: '/api/orders', headers: a.headers, payload: { customer: 'Buyer', items: [{ name: 'Item', quantity: 1, price: 1 }], delivery: 0 } })).json();
    expect((await app.inject({ method: 'DELETE', url: '/api/auth/account', headers: a.headers, payload: { password: 'wrong-password' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/auth/account', headers: a.headers, payload: { password: registration().password } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/me', headers: a.headers })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/public/orders/${order.token}` })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/auth/me', headers: b.headers })).statusCode).toBe(200);
  });
  it('persists one expression of interest per offer and hides it from other banks or after consent withdrawal', async () => {
    const { app, dbPath } = await setup(); const merchant = await register(app);
    for (const email of ['bank@example.com', 'other@example.com']) await createBankAccount({ dbPath, email, password: 'Bank-password-123!' });
    const bankHeaders = async (email: string) => { const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email, password: 'Bank-password-123!' } }); return { ...native, authorization: `Bearer ${response.json().token}` }; };
    const bank = await bankHeaders('bank@example.com'); const other = await bankHeaders('other@example.com');
    await app.inject({ method: 'POST', url: '/api/actions', headers: merchant.headers, payload: { type: 'shop.update', shop: { shareScore: true } } });
    await app.inject({ method: 'POST', url: '/api/bank/offers', headers: bank, payload: { businessId: merchant.user.id, bank: 'Bank', name: 'Loan', kind: 'loan', amount: 1000, annualRate: 8, months: 12, requirements: '' } });
    const offerId = (await app.inject({ url: '/api/workspace', headers: merchant.headers })).json().offers[0].id;
    const stranger = await register(app, 'stranger@example.com');
    expect((await app.inject({ method: 'POST', url: `/api/offers/${offerId}/interest`, headers: stranger.headers, payload: { message: 'Wrong owner' } })).statusCode).toBe(404);
    for (let i = 0; i < 2; i++) expect((await app.inject({ method: 'POST', url: `/api/offers/${offerId}/interest`, headers: merchant.headers, payload: { message: 'Please contact me' } })).statusCode).toBe(200);
    const interests = (await app.inject({ url: '/api/bank/interests', headers: bank })).json().interests;
    expect(interests).toHaveLength(1); expect(interests[0].message).toBe('Please contact me'); expect(interests[0].businessName).toBe('Test shop');
    expect((await app.inject({ url: '/api/bank/interests', headers: other })).json().interests).toEqual([]);
    await app.inject({ method: 'POST', url: '/api/actions', headers: merchant.headers, payload: { type: 'shop.update', shop: { shareScore: false } } });
    expect((await app.inject({ url: '/api/bank/interests', headers: bank })).json().interests).toEqual([]);
    expect((await app.inject({ method: 'POST', url: `/api/offers/${offerId}/interest`, headers: merchant.headers, payload: {} })).statusCode).toBe(403);
  });
  it('records a bank document request only with consent as a persistent merchant notification and increments its workspace version', async () => {
    const { app, dbPath } = await setup(); const merchant = await register(app);
    await createBankAccount({ dbPath, email: 'documents@example.com', password: 'Bank-password-123!' });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'documents@example.com', password: 'Bank-password-123!' } });
    const bank = { ...native, authorization: `Bearer ${login.json().token}` };
    const payload = { businessId: merchant.user.id, message: 'Please prepare the latest trade licence and three months of sales records.' };
    expect((await app.inject({ method: 'POST', url: '/api/bank/document-requests', headers: merchant.headers, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/bank/document-requests', headers: bank, payload })).statusCode).toBe(403);
    const beforeConsent = (await app.inject({ url: '/api/workspace', headers: merchant.headers })).json();
    expect(beforeConsent.activity.filter((activity: { title: string }) => activity.title === 'Document request')).toHaveLength(0);
    await app.inject({ method: 'POST', url: '/api/actions', headers: merchant.headers, payload: { type: 'shop.update', shop: { shareScore: true } } });
    const before = (await app.inject({ url: '/api/workspace', headers: merchant.headers })).json();
    for (const invalid of [{ ...payload, message: ' ' }, { ...payload, message: 'x'.repeat(1001) }, { ...payload, bankEmail: 'spoofed@example.com' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/bank/document-requests', headers: bank, payload: invalid })).statusCode).toBe(400);
    }
    const result = await app.inject({ method: 'POST', url: '/api/bank/document-requests', headers: bank, payload });
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ ok: true });
    await app.close(); apps.splice(apps.indexOf(app), 1);
    const reopened = await buildApp({ dbPath, publicOrigin: origin }); apps.push(reopened);
    const after = (await reopened.inject({ url: '/api/workspace', headers: merchant.headers })).json();
    expect(after.version).toBe(before.version + 1);
    const notification = after.activity.filter((activity: { title: string }) => activity.title === 'Document request');
    expect(notification).toHaveLength(1);
    expect(notification[0].detail).toContain('documents@example.com'); expect(notification[0].detail).toContain(payload.message);
    expect(Number.isFinite(new Date(notification[0].createdAt).getTime())).toBe(true);
    expect(notification[0].id).toMatch(/^[a-f0-9-]{36}$/);
    expect(after.products).toEqual(before.products); expect(after.sales).toEqual(before.sales); expect(after.payments).toEqual(before.payments);
  });
  it('returns honest unavailable AI/recovery states and rejects external image URLs', async () => {
    const { app } = await setup({ openaiApiKey: '' }); const user = await register(app);
    expect((await app.inject({ method: 'POST', url: '/api/ai/advisor', headers: user.headers, payload: { message: 'Advice' } })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/api/ai/stock', headers: user.headers, payload: { image: 'https://internal.invalid/photo.jpg' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/auth/forgot-password', headers: native, payload: { email: registration().email } })).statusCode).toBe(503);
    const health = (await app.inject({ url: '/api/health' })).json(); expect(health.bkashVerification).toBe(false); expect(health.ai).toBe(false);
  });
  it('sends only own aggregate records to the advisor and validates configured photo provider output', async () => {
    const calls: { url: string; body: string }[] = [];
    let content = 'Based on your recorded totals, keep a cash reserve. This is not lender approval.';
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'content-type': 'application/json' } });
    };
    const { app } = await setup({ openaiApiKey: 'test-only-key', openaiModel: 'configured-vision-model', fetchImpl }); const user = await register(app);
    const saved = (await app.inject({ method: 'POST', url: '/api/actions', headers: user.headers, payload: { type: 'product.save', product: { name: 'PRIVATE-PRODUCT', category: '', unit: 'piece', description: '', quantity: 3, cost: 40, price: 50, lowAt: 1, source: 'manual' } } })).json();
    await app.inject({ method: 'POST', url: '/api/actions', headers: user.headers, payload: { type: 'sale.create', items: [{ productId: saved.products[0].id, quantity: 1 }], method: 'cash', channel: 'shop', customer: 'PRIVATE-CUSTOMER', requestId: 'private-sale' } });
    const advice = await app.inject({ method: 'POST', url: '/api/ai/advisor', headers: user.headers, payload: { message: 'How can I manage cash?' } });
    expect(advice.statusCode).toBe(200); expect(advice.json().message).toBe(content);
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    for (const privateValue of ['PRIVATE-PRODUCT', 'PRIVATE-CUSTOMER', registration().email, registration().phone]) expect(calls[0].body).not.toContain(privateValue);
    expect(calls[0].body).toContain('monthlySales');
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/e8AAAAASUVORK5CYII=';
    content = JSON.stringify({ products: [{ name: 'Visible item', category: '', unit: 'piece', description: 'Check the label', quantity: 0, cost: 0, price: 0, lowAt: 0, source: 'photo' }] });
    const photo = await app.inject({ method: 'POST', url: '/api/ai/stock', headers: user.headers, payload: { image } });
    expect(photo.statusCode).toBe(200); expect(photo.json().products[0].source).toBe('photo');
    content = JSON.stringify({ products: [{ name: 'Fabricated', source: 'manual', price: -1 }] });
    expect((await app.inject({ method: 'POST', url: '/api/ai/stock', headers: user.headers, payload: { image } })).statusCode).toBe(502);
    expect((await app.inject({ url: '/api/workspace', headers: user.headers })).json().products).toHaveLength(1);
  });
  it('returns a readable provider failure instead of fabricating an answer', async () => {
    const { app } = await setup({ openaiApiKey: 'test-only-key', openaiModel: 'configured-model', fetchImpl: async () => new Response('{}', { status: 429 }) }); const user = await register(app);
    const result = await app.inject({ method: 'POST', url: '/api/ai/advisor', headers: user.headers, payload: { message: 'Advice' } });
    expect(result.statusCode).toBe(502); expect(result.json().error).toMatch(/provider/i); expect(result.json()).not.toHaveProperty('message');
  });
  it('sets secure cookies in production and throttles repeated authentication attempts', async () => {
    const { app } = await setup({ production: true, publicOrigin: 'https://greenbiz.example' });
    const registered = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { origin: 'https://greenbiz.example' }, payload: registration() });
    expect(registered.statusCode).toBe(200); expect(registered.headers['set-cookie']).toContain('Secure');
    let result;
    for (let i = 0; i < 11; i++) result = await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email: 'missing@example.com', password: 'wrong-password' } });
    expect(result?.statusCode).toBe(429); expect(result?.json()).toHaveProperty('error');
  });
  it('expires opaque sessions and refuses insecure production configuration', async () => {
    let now = new Date('2026-10-19T00:00:00Z');
    const { app } = await setup({ now: () => now, sessionTtlSeconds: 60 }); const user = await register(app);
    now = new Date('2026-10-19T00:02:00Z');
    expect((await app.inject({ url: '/api/auth/me', headers: user.headers })).statusCode).toBe(401);
    await expect(buildApp({ dbPath: ':memory:', production: true, publicOrigin: origin })).rejects.toThrow(/HTTPS/i);
  });
});
