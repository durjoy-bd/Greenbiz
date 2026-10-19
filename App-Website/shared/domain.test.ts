import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { applyAction, createWorkspace, creditScore, dashboard } from './domain';
import type { Action, Workspace } from './types';

const at = '2026-10-18T19:00:00.000Z'; // 19 October in Dhaka
const product = { name: 'Rice', category: 'Grocery', unit: 'kg', description: '', quantity: 10, cost: 40.125, price: 50.125, lowAt: 2, source: 'manual' as const };
const stock = () => applyAction(createWorkspace({ name: 'Shop' }), { type: 'product.save', product }, at);
const sale = (state: Workspace, requestId = 'sale-1', quantity = 2, now = at) => applyAction(state, { type: 'sale.create', items: [{ productId: state.products[0].id, quantity }], method: 'cash', channel: 'shop', customer: '', requestId }, now);
const claim = (state: Workspace, requestId = 'claim-1') => applyAction(state, { type: 'payment.create', customer: 'Customer', order: 'order-1', channel: 'website', amount: 100, trxId: 'ABC1234567', requestId }, at);

describe('workspace transactions', () => {
  it('advances the persisted revision for each committed change but not an idempotent retry',()=>{
    const first=stock();expect(first.version).toBe(2);
    const second=sale(first);expect(second.version).toBe(3);
    expect(sale(second).version).toBe(3);
    expect(applyAction(second,{type:'shop.update',shop:{name:'Renamed'}}).version).toBe(4);
    expect(first.version).toBe(2);
  });
  it('starts with empty genuine records and an insufficient-history score', () => {
    const state = createWorkspace({ name: 'Shop' });
    expect(state.sales).toEqual([]);
    expect(state.offers).toEqual([]);
    expect(creditScore(state).value).toBeNull();
    expect(creditScore(state).reasons.some(r => /7/.test(r.detail))).toBe(true);
  });
  it('rounds prices at boundaries and merges cart duplicates before checking stock', () => {
    const state = stock();
    const next = applyAction(state, { type: 'sale.create', items: [{ productId: state.products[0].id, quantity: 1 }, { productId: state.products[0].id, quantity: 2 }], method: 'cash', channel: 'shop', customer: '', requestId: 'merged' }, at);
    expect(next.products[0].quantity).toBe(7);
    expect(next.sales[0].items).toHaveLength(1);
    expect(next.sales[0].total).toBe(150.39);
    expect(next.sales[0].profit).toBe(30);
    expect(state.products[0].quantity).toBe(10);
  });
  it('keeps failures atomic even when a later cart line is invalid', () => {
    const state = stock();
    const before = structuredClone(state);
    expect(() => applyAction(state, { type: 'sale.create', items: [{ productId: state.products[0].id, quantity: 2 }, { productId: 'missing', quantity: 1 }], method: 'cash', channel: 'shop', customer: '', requestId: 'fail' }, at)).toThrow();
    expect(state).toEqual(before);
    expect(() => sale(state, 'too-many', 11)).toThrow();
  });
  it('does not decrement stock twice after retrying a request', () => {
    const once = sale(stock());
    expect(sale(once)).toEqual(once);
  });
  it('rejects a reused request id for a different action', () => {
    const once = sale(stock(), 'same-id');
    expect(() => claim(once, 'same-id')).toThrow();
  });
  it('keeps historical sale names and costs after product deletion', () => {
    const sold = sale(stock());
    const next = applyAction(sold, { type: 'product.delete', id: sold.products[0].id }, at);
    expect(next.products).toHaveLength(0);
    expect(next.sales[0].items[0]).toMatchObject({ name: 'Rice', cost: 40.13 });
    expect(dashboard(next, new Date(at)).todaySales).toBe(100.26);
  });
  it.each([NaN, Infinity, -1])('rejects invalid money %s', cost => {
    expect(() => applyAction(stock(), { type: 'product.save', product: { ...product, cost } }, at)).toThrow();
  });
  it('rejects a positive payment that rounds down to zero poisha', () => {
    const state = stock();
    expect(() => applyAction(state, { type: 'payment.create', customer: 'Buyer', order: 'Invoice', channel: 'website', amount: 0.001, trxId: 'ABC1234567', requestId: 'subpoisha' }, at)).toThrow();
  });
  it('rejects excessive quantity precision, empty carts, unknown fields and missing update ids', () => {
    expect(() => sale(stock(), 'fraction', 1.0001)).toThrow();
    expect(() => applyAction(stock(), { type: 'sale.create', items: [], method: 'cash', channel: 'shop', customer: '', requestId: 'empty' }, at)).toThrow();
    expect(() => applyAction(stock(), { type: 'product.save', product: { ...product, id: 'missing' } }, at)).toThrow();
    expect(() => applyAction(stock(), { type: 'shop.update', shop: { createdAt: at } } as unknown as Action)).toThrow();
    expect(() => applyAction(stock(), { type: 'shop.update', shop: { name: 'X' }, offers: [] } as unknown as Action)).toThrow();
    expect(() => applyAction(stock(), { type: 'unknown' } as unknown as Action)).toThrow();
  });
  it('flags duplicate payment references and never verifies manual receipts', () => {
    const first = claim(stock());
    const second = claim(first, 'claim-2');
    expect(second.payments[1].status).toBe('duplicate');
    const reviewed = applyAction(second, { type: 'payment.review', id: second.payments[0].id, decision: 'manual', received: 100, note: 'Checked receipt manually' }, at);
    expect(reviewed.payments[0].status).toBe('manual');
    expect(() => applyAction(reviewed, { type: 'payment.review', id: reviewed.payments[0].id, decision: 'rejected', note: '' }, at)).toThrow();
  });
  it('keeps a prepared payment identity stable when offline creation and review replay independently', () => {
    const base = createWorkspace({ name: 'Shop' });
    const create = { type: 'payment.create', id: 'offline-payment', customer: 'Buyer', order: 'Invoice', channel: 'facebook', amount: 100, trxId: 'ABC1234567', requestId: 'offline-claim' } as Action;
    const review = { type: 'payment.review', id: 'offline-payment', decision: 'manual', received: 100, note: 'Checked manually' } as Action;
    const optimistic = applyAction(applyAction(base, create, at), review, at);
    const replayed = applyAction(applyAction(structuredClone(base), create, at), review, at);
    expect(optimistic.payments[0]).toMatchObject({ id: 'offline-payment', status: 'manual', received: 100 });
    expect(replayed.payments).toEqual(optimistic.payments);
    expect(applyAction(replayed, create, at).payments).toEqual(replayed.payments);
    expect(base.payments).toEqual([]);
  });
  it('refuses an existing payment id with a new request atomically and still validates the optional id', () => {
    const action = { type: 'payment.create', id: 'stable-payment', customer: 'Buyer', order: 'Invoice', channel: 'website', amount: 100, trxId: 'ABC1234567', requestId: 'first-claim' } as Action;
    const first = applyAction(stock(), action, at); const before = structuredClone(first);
    expect(() => applyAction(first, { ...action, requestId: 'different-claim' } as Action, at)).toThrow(/payment.*exist|id.*used/i);
    expect(first).toEqual(before);
    for (const id of ['', 123, 'x'.repeat(129)]) expect(() => applyAction(stock(), { ...action, id } as unknown as Action, at)).toThrow();
  });
  it('uses Dhaka dates for daily/monthly summaries and derives an internal score only with seven sale days', () => {
    let state = stock();
    for (let i = 0; i < 7; i++) state = sale(state, `day-${i}`, 1, `2026-10-${String(12 + i).padStart(2, '0')}T19:00:00.000Z`);
    const stats = dashboard(state, new Date(at));
    expect(stats.todayCount).toBe(1);
    expect(stats.monthCount).toBe(7);
    expect(stats.daily.at(-1)?.date).toBe('2026-10-19');
    const score = creditScore(state, new Date(at));
    expect(score.value).toBeGreaterThanOrEqual(300);
    expect(score.value).toBeLessThanOrEqual(900);
    expect(score.label).toMatch(/internal/i);
  });
});

describe('financial records and measured inventory', () => {
  const receipt = { id: 'receipt-1', amount: 25.07, direction: 'in' as const, method: 'nagad' as const, reference: 'REF1', party: 'Private buyer', occurredAt: at, business: true, source: 'sms' as const, note: 'Imported record, not verified' };
  const imported = () => applyAction(stock(), { type: 'transaction.import', transactions: [receipt], requestId: 'import-1' } as Action, at);
  it('retains only SHA256 signatures and reference digests after deleting a financial record', () => {
    const record = { ...receipt, reference: 'PRIVATE-REFERENCE-UNIQUE', party: 'PRIVATE-PARTY-UNIQUE', note: 'PRIVATE-NOTE-UNIQUE' };
    const first = applyAction(stock(), { type: 'transaction.import', transactions: [record], requestId: 'private-import' } as Action, at);
    const deleted = applyAction(first, { type: 'transaction.delete', id: record.id } as Action, at);
    expect(deleted.transactions).toEqual([]);
    const metadata = JSON.stringify({ processedRequests: deleted.processedRequests, transactionImports: deleted.transactionImports });
    for (const value of [record.reference, record.party, record.note]) { expect(metadata).not.toContain(value); expect(JSON.stringify(deleted)).not.toContain(value); }
    const hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
    expect(deleted.transactionImports?.[0].referenceKey).toBe(hash(JSON.stringify([record.method, record.reference])));
    expect(deleted.transactionImports?.[0].fingerprint).toBe(hash(JSON.stringify([record.amount, record.direction, record.method, record.reference, record.party, record.occurredAt, record.source, record.note, 'BDT'])));
    expect(JSON.parse(deleted.processedRequests.at(-1)!)[1]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(() => applyAction(deleted, { type: 'transaction.import', transactions: [{ ...record, amount: 99 }], requestId: 'altered-private-import' } as Action)).toThrow();
  });
  it('lazily hashes legacy request fingerprints and import metadata without breaking exact retries or conflict detection', () => {
    const first = imported(); const action = { type: 'transaction.import', transactions: [receipt], requestId: 'import-1' } as Action;
    first.processedRequests = [JSON.stringify(['import-1', JSON.stringify(action)])];
    first.transactionImports = [{ id: receipt.id, referenceKey: JSON.stringify([receipt.method, receipt.reference]), fingerprint: JSON.stringify([receipt.amount, receipt.direction, receipt.method, receipt.reference, receipt.party, receipt.occurredAt, receipt.source, receipt.note, 'BDT']) }];
    const retried = applyAction(first, action, at);
    expect(retried.version).toBe(first.version); expect(retried.transactions).toHaveLength(1);
    expect(JSON.stringify(retried.processedRequests)).not.toContain(receipt.party);
    expect(JSON.stringify(retried.transactionImports)).not.toContain(receipt.party);
    expect(() => applyAction(retried, { ...action, transactions: [{ ...receipt, amount: 30 }] } as Action)).toThrow();
    const deleted = applyAction(retried, { type: 'transaction.delete', id: receipt.id } as Action);
    expect(() => applyAction(deleted, { type: 'transaction.import', transactions: [{ ...receipt, amount: 30 }], requestId: 'old-ledger-altered' } as Action)).toThrow();
  });
  it('supports stable new ids and three-decimal stock with rounded line money', () => {
    const state = applyAction(createWorkspace({}), { type: 'product.save', create: true, product: { ...product, id: 'client-rice', quantity: 0.3 } } as Action, at);
    const next = sale(state, 'measured', 0.1);
    expect(next.products[0]).toMatchObject({ id: 'client-rice', quantity: 0.2 });
    expect(next.sales[0]).toMatchObject({ total: 5.01, profit: 1 });
    expect(() => applyAction(next, { type: 'product.save', create: true, product: { ...product, id: 'client-rice' } } as Action)).toThrow();
  });
  it('deduplicates immutable references and blank references by id and rejects changed reuse atomically', () => {
    const first = imported();
    const next = applyAction(first, { type: 'transaction.import', transactions: [{ ...receipt, id: 'alias' }, { ...receipt, id: 'blank-1', reference: '' }, { ...receipt, id: 'blank-2', reference: '' }], requestId: 'import-2' } as Action, at);
    expect(next.transactions).toHaveLength(3);
    for (const altered of [{ ...receipt, amount: 30 }, { ...receipt, id: 'new', amount: 30 }]) expect(() => applyAction(next, { type: 'transaction.import', transactions: [altered], requestId: 'bad' } as Action)).toThrow(/reuse|reference|different/i);
    expect(first.transactions).toHaveLength(1);
    expect(() => applyAction(first, { type: 'transaction.import', transactions: [{ ...receipt, rawSms: 'secret' }], requestId: 'raw' } as unknown as Action)).toThrow();
  });
  it('links only matching incoming business receipts atomically and prevents changing linked records', () => {
    const first = imported();
    const action = { type: 'sale.create', items: [{ productId: first.products[0].id, quantity: 0.5 }], method: 'nagad', channel: 'shop', customer: '', requestId: 'linked', transactionId: receipt.id } as Action;
    const next = applyAction(first, action, at);
    expect(next.transactions?.[0].linkedSaleId).toBe(next.sales[0].id);
    expect(next.sales[0].transactionId).toBe(receipt.id);
    expect(() => applyAction(next, { type: 'transaction.delete', id: receipt.id } as Action)).toThrow(/linked/i);
    expect(() => applyAction(next, { type: 'transaction.classify', id: receipt.id, business: false } as Action)).toThrow(/linked/i);
    expect(() => applyAction(first, { ...action, method: 'cash' } as Action)).toThrow();
    expect(first.products[0].quantity).toBe(10);
    const personal = applyAction(first, { type: 'transaction.classify', id: receipt.id, business: false } as Action);
    expect(() => applyAction(personal, action)).toThrow();
  });
  it('links a receipt inside the cash-out band and refuses one outside it', () => {
    const base = stock();
    const sale = (id: string, requestId: string) => ({ type: 'sale.create', items: [{ productId: base.products[0].id, quantity: 0.5 }], method: 'nagad', channel: 'shop', customer: '', requestId, transactionId: id }) as Action;
    const charged = applyAction(base, { type: 'transaction.import', transactions: [{ ...receipt, id: 'charged', reference: 'CHARGED', amount: 25.97 }], requestId: 'charged' } as Action, at);
    const linked = applyAction(charged, sale('charged', 'charged-sale'), at);
    expect(linked.sales[0].total).toBe(25.07);
    expect(linked.transactions?.[0]).toMatchObject({ amount: 25.97, linkedSaleId: linked.sales[0].id });
    const far = applyAction(base, { type: 'transaction.import', transactions: [{ ...receipt, id: 'far', reference: 'FAR', amount: 27 }], requestId: 'far' } as Action, at);
    expect(() => applyAction(far, sale('far', 'far-sale'), at)).toThrow(/cash-out band/);
  });
  it('counts unlinked business income as labeled score evidence without changing sales totals or counting a linked receipt twice', () => {
    const first = imported();
    expect(dashboard(first, new Date(at)).monthSales).toBe(0);
    expect(creditScore(first, new Date(at)).days).toBe(1);
    expect(JSON.stringify(creditScore(first, new Date(at)))).toMatch(/self-recorded|imported/i);
    const next = applyAction(first, { type: 'sale.create', items: [{ productId: first.products[0].id, quantity: 0.5 }], method: 'nagad', channel: 'shop', customer: '', requestId: 'linked', transactionId: receipt.id } as Action, at);
    expect(dashboard(next, new Date(at)).digital).toBe(100);
    expect(creditScore(next, new Date(at)).turnover).toBe(3);
  });
  it('retains immutable import identities through aliases, classification and deletion', () => {
    const first = applyAction(imported(), { type: 'transaction.import', transactions: [{ ...receipt, id: 'alias' }], requestId: 'alias-import' } as Action);
    expect(() => applyAction(first, { type: 'transaction.import', transactions: [{ ...receipt, id: 'alias', reference: 'new-reference' }], requestId: 'alias-reuse' } as Action)).toThrow();
    const classified = applyAction(first, { type: 'transaction.classify', id: receipt.id, business: false } as Action);
    const rescanned = applyAction(classified, { type: 'transaction.import', transactions: [receipt], requestId: 'rescan' } as Action);
    expect(rescanned.transactions?.[0].business).toBe(false);
    const deleted = applyAction(rescanned, { type: 'transaction.delete', id: receipt.id } as Action);
    expect(() => applyAction(deleted, { type: 'transaction.import', transactions: [{ ...receipt, amount: 999 }], requestId: 'deleted-reuse' } as Action)).toThrow();
    expect(applyAction(deleted, { type: 'transaction.import', transactions: [receipt], requestId: 'deleted-rescan' } as Action).transactions).toEqual([]);
  });
  it('keeps foreign receipts outside BDT score evidence and refuses mismatched currency reuse or sale linkage', () => {
    const first = applyAction(stock(), { type: 'transaction.import', transactions: [{ ...receipt, currency: 'INR' }], requestId: 'foreign' } as Action);
    expect(creditScore(first, new Date(at)).days).toBe(0);
    expect(() => applyAction(first, { type: 'transaction.import', transactions: [{ ...receipt, currency: 'BDT' }], requestId: 'changed-currency' } as Action)).toThrow();
    expect(() => applyAction(first, { type: 'sale.create', items: [{ productId: first.products[0].id, quantity: 0.5 }], method: receipt.method, channel: 'shop', customer: '', requestId: 'foreign-sale', transactionId: receipt.id } as Action)).toThrow();
  });
  it('bounds imports, rejects unsupported fields/dates/nonfinite values and commits no partial batch', () => {
    const first = imported();
    for (const transactions of [Array(1001).fill(receipt), [{ ...receipt, id: 'new', occurredAt: 'tomorrow' }], [{ ...receipt, id: 'new', amount: Infinity }], [{ ...receipt, id: 'new', linkedSaleId: 'forged-sale' }], [{ ...receipt, id: 'ok', reference: 'new' }, { ...receipt, id: 'bad', amount: -1 }]]) expect(() => applyAction(first, { type: 'transaction.import', transactions, requestId: 'invalid-import' } as unknown as Action)).toThrow();
    expect(first.transactions).toHaveLength(1);
  });
  it('allows large safe rounded money products without losing precision or accepting extra quantity digits', () => {
    const first = applyAction(createWorkspace({}), { type: 'product.save', product: { ...product, quantity: 10000, cost: 10000000, price: 10000000 } }, at);
    expect(dashboard(first).stockValue).toBe(100000000000);
    expect(() => applyAction(first, { type: 'product.save', product: { ...product, quantity: 0.0000000001 } })).toThrow();
  });
});
