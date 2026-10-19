import { expect, it } from 'vitest';
import { createWorkspace } from './domain';
import { borrowingEstimate, financeReport, periodDates, presetDates } from './finance';

it('reports business cashflow once per linked sale and separates personal and foreign receipts', () => {
  const w = createWorkspace({});
  w.sales.push({
    id: 'sale',
    items: [],
    total: 200,
    profit: 50,
    method: 'bkash',
    channel: 'shop',
    customer: '',
    createdAt: '2026-10-18T20:00:00Z',
    requestId: 'r',
  });
  const base = {
    direction: 'in' as const,
    amount: 200,
    method: 'bkash' as const,
    reference: '',
    party: '',
    occurredAt: '2026-10-19T04:00:00Z',
    business: true,
    source: 'sms' as const,
    note: '',
  };
  w.transactions = [
    { ...base, id: 'linked', linkedSaleId: 'sale' },
    { ...base, id: 'other', amount: 100 },
    { ...base, id: 'personal', business: false, amount: 999 },
    { ...base, id: 'inr', currency: 'INR', amount: 888 },
    { ...base, id: 'expense', direction: 'out', amount: 75 },
  ];
  const r = financeReport(w, '2026-10-19', '2026-10-19');
  expect(r).toMatchObject({
    income: 300,
    expenses: 75,
    net: 225,
    count: 3,
    foreignCount: 1,
    personalCount: 1,
  });
  expect(r.daily[0]).toMatchObject({ date: '2026-10-19', income: 300, expenses: 75 });
});
it('compares an equal preceding period and rejects reversed or excessive date ranges', () => {
  const w = createWorkspace({});
  const base = {
    items: [],
    profit: 0,
    method: 'cash' as const,
    channel: 'shop' as const,
    customer: '',
    requestId: 'r',
  };
  w.sales = [
    { ...base, id: 'a', total: 60, createdAt: '2026-10-17T10:00:00Z' },
    { ...base, id: 'b', total: 90, createdAt: '2026-10-19T10:00:00Z' },
  ];
  expect(financeReport(w, '2026-10-19', '2026-10-19')).toMatchObject({
    previousIncome: 0,
    change: null,
  });
  expect(financeReport(w, '2026-10-18', '2026-10-19')).toMatchObject({
    previousIncome: 60,
    change: 50,
  });
  expect(() => financeReport(w, '2026-10-20', '2026-10-19')).toThrow();
  expect(() => financeReport(w, '2020-01-01', '2026-10-19')).toThrow();
  expect(periodDates(7, new Date('2026-10-18T20:00:00Z'))).toEqual({
    from: '2026-10-13',
    to: '2026-10-19',
  });
});
it('keeps an estimate within the stated repayment budget and never sizes from zero revenue', () => {
  expect(borrowingEstimate(0, 12, 36).principal).toBe(0);
  const e = borrowingEstimate(10000, 12, 36);
  expect(e.monthlyBudget).toBe(1500);
  expect(e.principal).toBeGreaterThan(45000);
  expect(e.principal).toBeLessThan(46000);
  expect(borrowingEstimate(10000, 0, 12).principal).toBe(18000);
});
it('builds calendar presets in business time and the 1.x overview figures', () => {
  const now = new Date('2026-10-19T04:00:00Z'); // Monday in Dhaka
  expect(presetDates('week', now)).toMatchObject({ from: '2026-10-17', to: '2026-10-19' });
  expect(presetDates('month', now)).toMatchObject({ from: '2026-10-01', to: '2026-10-19' });
  expect(presetDates('lastMonth', now)).toMatchObject({ from: '2026-09-01', to: '2026-09-30', label: 'September 2026' });
  expect(presetDates('year', now)).toMatchObject({ from: '2026-01-01', label: '2026 so far' });
  expect(presetDates('pickMonth', now, '2026-02')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
  const w = createWorkspace({});
  const sale = { items: [], profit: 0, method: 'cash' as const, channel: 'shop' as const, requestId: 'r' };
  w.sales = [
    { ...sale, id: 'a', total: 100, customer: 'Rahim', createdAt: '2026-10-02T10:00:00Z' },
    { ...sale, id: 'b', total: 300, customer: 'rahim', createdAt: '2026-10-02T11:00:00Z', method: 'bkash' },
    { ...sale, id: 'c', total: 200, customer: '', createdAt: '2026-10-09T10:00:00Z', method: 'bkash' },
  ];
  const r = financeReport(w, '2026-10-01', '2026-10-19');
  expect(r).toMatchObject({ bucket: 'day', averageInflow: 200, inflowCount: 3, topMethod: { method: 'bkash', value: 500 } });
  expect(r.best).toMatchObject({ from: '2026-10-02', income: 400 });
  expect(r.payers[0]).toMatchObject({ name: 'Rahim', value: 400, count: 2 });
  expect(financeReport(w, '2026-07-22', '2026-10-19').bucket).toBe('week');
  const year = financeReport(w, '2026-01-01', '2026-10-19');
  expect(year.bucket).toBe('month');
  expect(year.buckets.find((b) => b.key === '2026-10')).toMatchObject({ income: 600, count: 3 });
});
