import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Action, Dashboard, Score, Shop, Workspace } from './types';
import { isAttachable } from './tolerance';

const MAX_MONEY = 1_000_000_000;
const encoder = new TextEncoder();
const digest = (value: string) => `sha256:${bytesToHex(sha256(encoder.encode(value)))}`;
const normalizedDigest = (value: string) => /^sha256:[a-f0-9]{64}$/.test(value) ? value : digest(value);
function normalizeRequestFingerprint(record: string): string {
  try {
    const entry: unknown = JSON.parse(record);
    if (Array.isArray(entry) && entry.length === 2 && entry.every(value => typeof value === 'string')) return JSON.stringify([entry[0], normalizedDigest(entry[1])]);
  } catch { /* Legacy bare request IDs remain fail-closed on reuse. */ }
  return record;
}
const text = (max: number) => z.string().trim().max(max);
const id = z.string().min(1).max(128);
const quantity = z.number().finite().min(0).max(1_000_000).refine(value => Math.round(value * 1000) / 1000 === value, 'Use at most three decimal places');
const positiveQuantity = quantity.refine(value => value >= 0.001, 'Quantity must be at least 0.001');
const money = z.number().finite().min(0).max(MAX_MONEY).transform(round);
const paymentMethod = z.enum(['cash', 'bkash', 'nagad', 'rocket', 'upay', 'upi', 'bank', 'other']);
const financialRecord = z.object({ id, amount: money.refine(value => value >= 0.01, 'Amount must be positive'), direction: z.enum(['in', 'out']), method: paymentMethod, reference: text(128), party: text(120), occurredAt: z.string().datetime({ offset: true }).transform(time), business: z.boolean(), source: z.enum(['sms', 'manual']), note: text(1000), currency: z.enum(['BDT', 'INR']).optional() }).strict();
const shopFields = { name: text(100).min(1), owner: text(100), location: text(200), phone: text(30), bkash: text(30), language: z.enum(['en', 'bn']), shareScore: z.boolean() };
const productFields = { name: text(120).min(1), category: text(80), unit: text(30).min(1), description: text(1000), quantity, cost: money, price: money, lowAt: quantity, source: z.enum(['manual', 'photo']) };
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('product.save'), create: z.literal(true).optional(), product: z.object({ ...productFields, id: id.optional() }).strict() }).strict(),
  z.object({ type: z.literal('product.delete'), id }).strict(),
  z.object({ type: z.literal('sale.create'), items: z.array(z.object({ productId: id, quantity: positiveQuantity }).strict()).min(1).max(200), method: paymentMethod, transactionId: id.optional(), channel: z.enum(['shop', 'facebook', 'website']), customer: text(120), requestId: id }).strict(),
  z.object({ type: z.literal('transaction.import'), transactions: z.array(financialRecord).min(1).max(1000), requestId: id }).strict(),
  z.object({ type: z.literal('transaction.classify'), id, business: z.boolean() }).strict(),
  z.object({ type: z.literal('transaction.delete'), id }).strict(),
  z.object({ type: z.literal('payment.create'), id: id.optional(), customer: text(120).min(1), order: text(150).min(1), channel: text(30).min(1), amount: money.refine(value => value >= 0.01, 'Payment amount must be at least 0.01 taka'), trxId: z.string().regex(/^[A-Z0-9]{10}$/, 'Transaction ID must be 10 uppercase letters or digits'), requestId: id }).strict(),
  z.object({ type: z.literal('payment.review'), id, decision: z.enum(['manual', 'rejected']), received: money.optional(), note: text(1000) }).strict(),
  z.object({ type: z.literal('shop.update'), shop: z.object(shopFields).partial().strict() }).strict(),
]);
function round(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function cents(value: number): number {
  const result = Math.round((value + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(result)) throw new Error('Money exceeds safe arithmetic limit');
  return result;
}
function fromCents(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error('Money exceeds safe arithmetic limit');
  return value / 100;
}
function sum(values: number[]): number { return fromCents(values.reduce((total, value) => total + cents(value), 0)); }
export function multiplyMoney(value: number, count: number): number {
  const scaled = BigInt(cents(value)) * BigInt(Math.round(count * 1000));
  const rounded = (scaled + 500n) / 1000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Money exceeds safe arithmetic limit');
  return fromCents(Number(rounded));
}
const multiply = multiplyMoney;
const normalizedQuantity = (value: number) => Math.round(value * 1000) / 1000;
function time(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid timestamp');
  return date.toISOString();
}
const newId = () => globalThis.crypto.randomUUID();
const businessDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
export function businessDate(date: Date | string): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  if (!Number.isFinite(value.getTime())) throw new Error('Invalid date');
  return businessDateFormatter.format(value);
}
export function createWorkspace(shop: Partial<Shop>): Workspace {
  const { createdAt, ...settings } = shop;
  const validated = z.object(shopFields).partial().strict().parse(settings);
  return { version: 1, shop: { name: 'My GreenBiz shop', owner: '', location: '', phone: '', bkash: '', language: 'en', shareScore: false, ...validated, createdAt: time(createdAt ?? new Date().toISOString()) }, products: [], sales: [], payments: [], transactions: [], offers: [], activity: [], processedRequests: [] };
}
/** Immutable atomic transaction; retains 200 activities and 2,000 request fingerprints. */
export function applyAction(state: Workspace, action: Action, now = new Date().toISOString()): Workspace {
  const parsed = actionSchema.parse(action);
  const timestamp = time(now);
  const next = structuredClone(state);
  // Lazy conversion also covers mutations without request IDs, including deletion.
  next.processedRequests = next.processedRequests.map(normalizeRequestFingerprint);
  if (next.transactionImports) next.transactionImports = next.transactionImports.map(record => ({ ...record, referenceKey: record.referenceKey ? normalizedDigest(record.referenceKey) : '', fingerprint: normalizedDigest(record.fingerprint) }));
  if ('requestId' in parsed) {
    const signature = digest(JSON.stringify(parsed));
    const existing = next.processedRequests.find(record => {
      try { return JSON.parse(record)[0] === parsed.requestId; } catch { return record === parsed.requestId; }
    });
    if (existing) {
      if (existing === JSON.stringify([parsed.requestId, signature])) return next;
      throw new Error('Request ID has already been used for a different action');
    }
    const previousSale = next.sales.find(record => record.requestId === parsed.requestId);
    if (previousSale) {
      if (parsed.type !== 'sale.create') throw new Error('Request ID already used');
      const requested = new Map<string, number>();
      parsed.items.forEach(item => requested.set(item.productId, (requested.get(item.productId) ?? 0) + item.quantity));
      if (previousSale.method !== parsed.method || previousSale.transactionId !== parsed.transactionId || previousSale.channel !== parsed.channel || previousSale.customer !== parsed.customer || requested.size !== previousSale.items.length || previousSale.items.some(item => normalizedQuantity(requested.get(item.productId) ?? 0) !== item.quantity)) throw new Error('Request ID already used');
      return next;
    }
    next.processedRequests.push(JSON.stringify([parsed.requestId, signature]));
    next.processedRequests = next.processedRequests.slice(-2000);
  }
  let title = '';
  let detail = '';
  switch (parsed.type) {
    case 'product.save': {
      const existing = parsed.product.id ? next.products.find(item => item.id === parsed.product.id) : undefined;
      if (parsed.create && existing) throw new Error('Product already exists');
      if (parsed.product.id && !existing && !parsed.create) throw new Error('Product does not exist');
      if (!existing && next.products.length >= 10000) throw new Error('Inventory limit reached');
      multiply(parsed.product.cost, parsed.product.quantity);
      const updated = { ...parsed.product, id: existing?.id ?? parsed.product.id ?? newId(), createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
      if (existing) next.products[next.products.indexOf(existing)] = updated;
      else next.products.push(updated);
      title = existing ? 'Product updated' : 'Product added'; detail = updated.name;
      break;
    }
    case 'product.delete': {
      const product = next.products.find(item => item.id === parsed.id);
      if (!product) throw new Error('Product does not exist');
      next.products = next.products.filter(item => item.id !== parsed.id);
      title = 'Product deleted'; detail = product.name;
      break;
    }
    case 'sale.create': {
      if (next.sales.length >= 100000) throw new Error('Sales record limit reached; export and archive with an administrator');
      const cart = new Map<string, number>();
      parsed.items.forEach(item => cart.set(item.productId, normalizedQuantity((cart.get(item.productId) ?? 0) + item.quantity)));
      const items = [...cart.entries()].map(([productId, count]) => {
        const product = next.products.find(item => item.id === productId);
        if (!product) throw new Error('Product does not exist');
        if (count > product.quantity) throw new Error(`Insufficient stock for ${product.name}`);
        return { productId, name: product.name, quantity: count, price: product.price, cost: product.cost };
      });
      const total = sum(items.map(item => multiply(item.price, item.quantity)));
      const cost = sum(items.map(item => multiply(item.cost, item.quantity)));
      const receipt = parsed.transactionId ? next.transactions?.find(record => record.id === parsed.transactionId) : undefined;
      // A receipt within the cash-out band (at least 1 taka, or 2% of the bill) is the same payment.
      if (parsed.transactionId && (!receipt || receipt.linkedSaleId || receipt.direction !== 'in' || !receipt.business || (receipt.currency ?? 'BDT') !== 'BDT' || receipt.method !== parsed.method || !isAttachable(receipt.amount, total))) throw new Error('Transaction must be an unlinked incoming BDT business record with the same method and an amount within the cash-out band');
      const saleId = newId();
      for (const item of items) {
        const product = next.products.find(product => product.id === item.productId)!;
        product.quantity = normalizedQuantity(product.quantity - item.quantity); product.updatedAt = timestamp;
      }
      next.sales.push({ id: saleId, items, total, profit: fromCents(cents(total) - cents(cost)), method: parsed.method, channel: parsed.channel, customer: parsed.customer, createdAt: timestamp, requestId: parsed.requestId, ...(receipt ? { transactionId: receipt.id } : {}) });
      if (receipt) receipt.linkedSaleId = saleId;
      title = 'Sale recorded'; detail = `${total.toFixed(2)} taka · ${parsed.method}`;
      break;
    }
    case 'transaction.import': {
      next.transactions ??= [];
      const referenceKey = (record: { method: string; reference: string }) => record.reference ? digest(JSON.stringify([record.method, record.reference])) : '';
      const recordFingerprint = (record: typeof parsed.transactions[number]) => digest(JSON.stringify([record.amount, record.direction, record.method, record.reference, record.party, time(record.occurredAt), record.source, record.note, record.currency ?? 'BDT']));
      // Tombstones and alias IDs are retained so rescanning deleted records cannot
      // resurrect them or reuse their immutable identity with altered data.
      next.transactionImports ??= next.transactions.map(record => ({ id: record.id, referenceKey: referenceKey(record), fingerprint: recordFingerprint(record) }));
      const byId = new Map(next.transactionImports.map(record => [record.id, record]));
      const byReference = new Map(next.transactionImports.filter(record => record.referenceKey).map(record => [record.referenceKey, record]));
      for (const record of parsed.transactions) {
        const key = referenceKey(record); const signature = recordFingerprint(record);
        const existingId = byId.get(record.id);
        const existingRef = key ? byReference.get(key) : undefined;
        if ((existingId && existingId.fingerprint !== signature) || (existingRef && existingRef.fingerprint !== signature)) throw new Error('Financial id/reference reuse has different immutable fields');
        if (!existingId) {
          if (next.transactionImports.length >= 100000) throw new Error('Financial import identity limit reached');
          const identity = { id: record.id, referenceKey: key, fingerprint: signature };
          next.transactionImports.push(identity); byId.set(record.id, identity);
          if (key) byReference.set(key, identity);
        }
        if (existingId || existingRef) continue;
        if (next.transactions.length >= 100000) throw new Error('Financial transaction limit reached');
        next.transactions.push(record);
      }
      title = 'Financial records imported'; detail = 'Self-recorded financial records; no provider verification';
      break;
    }
    case 'transaction.classify':
    case 'transaction.delete': {
      const record = next.transactions?.find(record => record.id === parsed.id);
      if (!record) throw new Error('Transaction does not exist');
      if (record.linkedSaleId) throw new Error('Linked transactions cannot be reclassified or deleted');
      if (parsed.type === 'transaction.classify') record.business = parsed.business;
      else next.transactions = next.transactions!.filter(record => record.id !== parsed.id);
      title = parsed.type === 'transaction.classify' ? 'Transaction classified' : 'Transaction deleted';
      break;
    }
    case 'payment.create': {
      if (next.payments.length >= 100000) throw new Error('Payment record limit reached');
      if (parsed.id && next.payments.some(payment => payment.id === parsed.id)) throw new Error('Payment ID already used by an existing record');
      const duplicate = next.payments.some(item => item.trxId === parsed.trxId);
      next.payments.push({ id: parsed.id ?? newId(), customer: parsed.customer, order: parsed.order, channel: parsed.channel, amount: parsed.amount, received: null, trxId: parsed.trxId, status: duplicate ? 'duplicate' : 'waiting', createdAt: timestamp, note: duplicate ? 'This transaction reference already appears in another claim. No provider verification is available.' : 'Customer claim only. Provider verification is unavailable.' });
      title = duplicate ? 'Duplicate payment claim' : 'Payment claim received'; detail = parsed.trxId;
      break;
    }
    case 'payment.review': {
      const payment = next.payments.find(item => item.id === parsed.id);
      if (!payment) throw new Error('Payment does not exist');
      if (!['waiting', 'wrong_amount', 'duplicate'].includes(payment.status)) throw new Error('Payment has already been settled');
      if (parsed.decision === 'manual') {
        if (parsed.received === undefined) throw new Error('Enter the amount actually received');
        payment.received = parsed.received;
        payment.status = cents(parsed.received) === cents(payment.amount) ? 'manual' : 'wrong_amount';
      } else payment.status = 'rejected';
      payment.note = parsed.note;
      title = 'Payment reviewed'; detail = `${payment.trxId} · ${payment.status}`;
      break;
    }
    case 'shop.update': next.shop = { ...next.shop, ...parsed.shop }; title = 'Shop settings updated'; break;
  }
  next.activity.push({ id: newId(), title, detail, createdAt: timestamp });
  next.activity = next.activity.slice(-200);
  if (!Number.isSafeInteger(state.version) || state.version < 1 || state.version >= Number.MAX_SAFE_INTEGER) throw new Error('Workspace revision limit reached');
  next.version = state.version + 1;
  return next;
}
export function dashboard(state: Workspace, now = new Date()): Dashboard {
  const today = businessDate(now);
  const month = today.slice(0, 7);
  const records = state.sales.filter(sale => businessDate(sale.createdAt) <= today);
  const dailySales = records.filter(sale => businessDate(sale.createdAt) === today);
  const monthly = records.filter(sale => businessDate(sale.createdAt).startsWith(month));
  const monthSales = sum(monthly.map(sale => sale.total));
  const digitalTotal = sum(monthly.filter(sale => sale.method !== 'cash').map(sale => sale.total));
  const daily = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(`${today}T12:00:00+06:00`);
    day.setUTCDate(day.getUTCDate() - 6 + index);
    const date = businessDate(day);
    return { date, value: sum(records.filter(sale => businessDate(sale.createdAt) === date).map(sale => sale.total)) };
  });
  return { todaySales: sum(dailySales.map(sale => sale.total)), todayCount: dailySales.length, cash: sum(dailySales.filter(sale => sale.method === 'cash').map(sale => sale.total)), bkash: sum(dailySales.filter(sale => sale.method === 'bkash').map(sale => sale.total)), stockValue: sum(state.products.map(product => multiply(product.cost, product.quantity))), totalProducts: state.products.length, lowProducts: state.products.filter(product => product.quantity <= product.lowAt), reviewPayments: state.payments.filter(payment => ['waiting', 'wrong_amount', 'duplicate'].includes(payment.status)), monthSales, monthCount: monthly.length, profit: sum(monthly.map(sale => sale.profit)), digital: monthSales ? Math.round(digitalTotal / monthSales * 100) : 0, daily };
}
export function creditScore(state: Workspace, now = new Date()): Score {
  const today = businessDate(now);
  const importedIncome = (state.transactions ?? []).filter(record => record.business && !record.linkedSaleId && record.direction === 'in' && (record.currency ?? 'BDT') === 'BDT').map(record => ({ createdAt: record.occurredAt, total: record.amount, method: record.method }));
  const validSales = [...state.sales, ...importedIncome].filter(sale => businessDate(sale.createdAt) <= today && sale.total > 0);
  const dates = new Set(validSales.map(sale => businessDate(sale.createdAt)));
  const days = dates.size;
  const cutoff = new Date(`${today}T12:00:00+06:00`); cutoff.setUTCDate(cutoff.getUTCDate() - 29);
  const since = businessDate(cutoff);
  const recent = validSales.filter(sale => businessDate(sale.createdAt) >= since);
  const total = sum(recent.map(sale => sale.total));
  const digital = total ? Math.round(sum(recent.filter(sale => sale.method !== 'cash').map(sale => sale.total)) / total * 100) : 0;
  const consistency = Math.round(new Set(recent.map(sale => businessDate(sale.createdAt))).size / 30 * 100);
  const stock = sum(state.products.map(product => multiply(product.cost, product.quantity)));
  const turnover = stock ? Math.min(100, Math.round(total / stock * 50)) : 0;
  const value = days < 7 ? null : Math.round(300 + consistency * 1.8 + digital * 1.8 + turnover * 1.2 + Math.min(days / 90, 1) * 120);
  return { value, label: value === null ? 'More records needed' : 'Internal business indicator', days, digital, consistency, turnover, reasons: [
    { title: 'Recorded history', detail: 'At least 7 distinct days with positive sales or unlinked business income are required. Self-recorded/imported receipts are not provider verified; linked receipts count only once. Up to 120 points for 90 record days.', value: `${days} record days`, good: days >= 7 },
    { title: '30-day consistency', detail: 'Business record days in the last 30 business dates / 30; contributes up to 180 points.', value: `${consistency}%`, good: consistency >= 50 },
    { title: 'Digital business records', detail: 'Noncash sales and unlinked BDT business income / total business records in the last 30 days; up to 180 points. Self-recorded, not provider verified.', value: `${digital}%`, good: digital >= 50 },
    { title: 'Stock turnover', detail: '30-day recorded BDT business income / current stock cost, capped at 2; up to 120 points. No stock gives 0 points.', value: `${turnover}%`, good: turnover >= 50 },
    { title: 'Internal estimate only', detail: '300 base points. This is not a credit bureau score, lending decision, or approval.', value: '300–900 range', good: false },
  ] };
}
