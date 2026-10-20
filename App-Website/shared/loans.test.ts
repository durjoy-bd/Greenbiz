import { describe, expect, it } from 'vitest';
import {
  affordablePrincipalMinor,
  amortizedEmiMinor,
  floorToThousandMinor,
  institutions,
  interestOnlyEmiMinor,
  matchPlans,
  plans,
  priorityForRatio,
  repaymentEmiMinor,
} from './loans';

describe('loan maths', () => {
  it('amortises, inverts and services interest-only lines', () => {
    const emi = amortizedEmiMinor(10_000_000, 12, 12);
    expect(emi).toBeGreaterThan(888_000);
    expect(emi).toBeLessThan(889_000);
    expect(amortizedEmiMinor(1_200_000, 0, 12)).toBe(100_000);
    expect(Math.abs(affordablePrincipalMinor(emi, 12, 12) - 10_000_000)).toBeLessThan(100);
    expect(interestOnlyEmiMinor(10_000_000, 12)).toBe(100_000);
    expect(repaymentEmiMinor(10_000_000, 12, 12, 'revolving')).toBe(100_000);
    expect(repaymentEmiMinor(10_000_000, 12, 12, 'term')).toBe(emi);
  });
  it.each([
    [3, 'high'],
    [2, 'high'],
    [1.9999, 'high'],
    [1.99, 'medium'],
    [1.3, 'medium'],
    [1.29, 'low'],
    [null, 'unknown'],
  ])('labels %s× revenue cover as %s', (ratio, priority) => {
    expect(priorityForRatio(ratio)).toBe(priority);
  });
  it('rounds suggested amounts down to whole thousands', () => {
    expect(floorToThousandMinor(1_299_999)).toBe(1_200_000);
  });
});

describe('published product matching', () => {
  it('ships the 39-product, 8-bank catalogue', () => {
    expect(plans).toHaveLength(39);
    expect(institutions).toHaveLength(8);
    expect(plans.every((plan) => institutions.some((i) => i.id === plan.institutionId))).toBe(true);
  });
  it('sizes a loan inside a real product band and never above half of revenue', () => {
    const result = matchPlans({ monthlyRevenue: 100_000, shopAgeMonths: 36 });
    expect(result.capacity.basis).toBe('matched_plan');
    expect(result.capacity.maxAffordableEmi).toBe(50_000);
    expect(result.capacity.suggestedAmount % 1000).toBe(0);
    expect(result.matches.length).toBeLessThanOrEqual(12);
    expect(result.matches.some((m) => m.plan.id === result.capacity.planId)).toBe(true);
    const rank = { high: 0, medium: 1, low: 2, unknown: 3 };
    for (let i = 1; i < result.ranked.length; i++)
      expect(rank[result.ranked[i - 1].priority]).toBeLessThanOrEqual(rank[result.ranked[i].priority]);
    for (const match of result.ranked.filter((m) => m.priority === 'high' && m.facility === 'term'))
      expect(match.emi!).toBeLessThanOrEqual(50_000.01);
  });
  it('asks for a month of records before estimating', () => {
    const result = matchPlans({ monthlyRevenue: 0, shopAgeMonths: 0 });
    expect(result.capacity.basis).toBe('insufficient_revenue');
    expect(result.ranked[0].warnings.join(' ')).toMatch(/No business revenue/);
  });
  it('warns when a requested amount is outside a product band', () => {
    const result = matchPlans({ monthlyRevenue: 50_000, shopAgeMonths: 12, requestedAmount: 1 });
    expect(result.ranked.some((m) => m.warnings.some((w) => w.startsWith('This product lends')))).toBe(true);
  });
});

describe('honest sizing for small revenue', () => {
  it('never presents a product minimum as an affordable headline amount', () => {
    const tiny = matchPlans({ monthlyRevenue: 1, shopAgeMonths: 0 });
    expect(tiny.capacity.basis).toBe('insufficient_revenue');
    expect(tiny.capacity.suggestedAmount).toBe(0);
    const entry = tiny.ranked.find((m) => m.entryAmount && m.suggestedAmount);
    expect(entry).toBeDefined();
    expect(entry!.priority).not.toBe('high');
    expect(entry!.reasons.join(' ')).toMatch(/starts at/);
    expect(entry!.reasons.join(' ')).not.toMatch(/this plan supports about/);
  });
  it('sizes the headline from revenue even when an amount is requested', () => {
    const plain = matchPlans({ monthlyRevenue: 50_000, shopAgeMonths: 36 });
    const asked = matchPlans({ monthlyRevenue: 50_000, shopAgeMonths: 36, requestedAmount: 50_000_000 });
    expect(asked.capacity.suggestedAmount).toBe(plain.capacity.suggestedAmount);
    expect(plain.ranked.filter((m) => !m.entryAmount && m.priority === 'high').length).toBeGreaterThan(0);
  });
});
