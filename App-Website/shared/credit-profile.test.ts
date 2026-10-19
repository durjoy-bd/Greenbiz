import { describe, expect, it } from 'vitest';
import { computeCreditProfile, creditProfile, FACTOR_WEIGHTS, WINDOW_DAYS } from './credit-profile';
import { applyAction, createWorkspace } from './domain';
import type { Action } from './types';

const DAY = 86_400_000;
const NOW = new Date(Date.UTC(2026, 9, 17, 12));
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const inflowsEvery = (days: number, count: number, amount = 1000) =>
  Array.from({ length: count }, (_, i) => ({ direction: 'in' as const, amount, occurredAt: ago(i * days) }));
const factor = (profile: ReturnType<typeof computeCreditProfile>, name: string) =>
  profile.factors.find((f) => f.name === name)!.score;

describe('behavioural credit profile', () => {
  it('uses the documented weights', () => {
    expect(Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
  it('scores an empty shop as zero with explanations', () => {
    const profile = computeCreditProfile([], NOW);
    expect(profile).toMatchObject({ score: 0, band: 'No data yet', monthlyRevenue: 0 });
    expect(profile.riskFlags).toEqual(expect.arrayContaining(['no_activity', 'no_inflow']));
    expect(profile.risks[0]).toMatch(/90 days/);
  });
  it('ignores records outside the window and outflow when measuring revenue', () => {
    const recent = inflowsEvery(3, 10);
    const stale = [{ direction: 'in' as const, amount: 1000, occurredAt: ago(WINDOW_DAYS + 5) }];
    expect(computeCreditProfile([...recent, ...stale], NOW).score).toBe(computeCreditProfile(recent, NOW).score);
    const spend = { direction: 'out' as const, amount: 5000, occurredAt: ago(1) };
    expect(computeCreditProfile([...recent, spend], NOW).monthlyRevenue).toBe(computeCreditProfile(recent, NOW).monthlyRevenue);
  });
  it('scores volume against the ৳20,000 reference', () => {
    const half = computeCreditProfile(inflowsEvery(3, 30, 1000), NOW);
    expect(factor(half, 'volume')).toBeGreaterThan(40);
    expect(factor(half, 'volume')).toBeLessThan(60);
    const full = computeCreditProfile([5, 35, 65].map((d) => ({ direction: 'in' as const, amount: 20000, occurredAt: ago(d) })), NOW);
    expect(factor(full, 'volume')).toBeGreaterThan(90);
  });
  it('rewards steady months and flags decline, low activity and concentration', () => {
    const steady = computeCreditProfile([10, 40, 70].map((d) => ({ direction: 'in' as const, amount: 20000, occurredAt: ago(d) })), NOW);
    const erratic = computeCreditProfile([{ direction: 'in', amount: 59000, occurredAt: ago(10) }, { direction: 'in', amount: 1000, occurredAt: ago(40) }], NOW);
    expect(factor(steady, 'stability')).toBeGreaterThan(factor(erratic, 'stability'));
    expect(computeCreditProfile([{ direction: 'in', amount: 100, occurredAt: ago(2) }, { direction: 'in', amount: 30000, occurredAt: ago(35) }], NOW).riskFlags).toContain('revenue_declining');
    expect(computeCreditProfile([{ direction: 'in', amount: 1000, occurredAt: ago(2) }], NOW).riskFlags).toEqual(expect.arrayContaining(['low_activity', 'insufficient_history']));
    const concentrated = computeCreditProfile([{ direction: 'in', amount: 90000, occurredAt: ago(5), counterparty: 'A' }, { direction: 'in', amount: 1000, occurredAt: ago(10), counterparty: 'B' }], NOW);
    expect(concentrated.riskFlags).toContain('counterparty_concentration');
  });
  it('reads business BDT records once and leaves personal or foreign records out', () => {
    let w = createWorkspace({ name: 'Shop' });
    w = applyAction(w, { type: 'product.save', product: { name: 'Rice', category: 'Other', unit: 'kg', description: '', quantity: 100, cost: 40, price: 50, lowAt: 1, source: 'manual' } } as Action, ago(20));
    const income = { amount: 50, direction: 'in' as const, method: 'bkash' as const, reference: 'R1', party: '', occurredAt: ago(3), business: true, source: 'sms' as const, note: '' };
    w = applyAction(w, { type: 'transaction.import', requestId: 'i', transactions: [income, { ...income, id: 'personal', reference: 'R2', business: false }, { ...income, id: 'inr', reference: 'R3', method: 'upi', currency: 'INR' }].map((t, i) => ({ id: 'id' + i, ...t })) } as Action, ago(3));
    w = applyAction(w, { type: 'sale.create', items: [{ productId: w.products[0].id, quantity: 1 }], method: 'bkash', channel: 'shop', customer: '', requestId: 's', transactionId: 'id0' } as Action, ago(3));
    expect(creditProfile(w, NOW).transactionCount).toBe(1);
  });
});
