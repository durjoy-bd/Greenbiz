import { businessDate } from './domain';
import type { PaymentMethod, Workspace } from './types';

export const methodLabels: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
  upay: 'Upay',
  upi: 'UPI',
  bank: 'Bank transfer',
  other: 'Other',
};
const dayMs = 86_400_000;
const rounded = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function shiftDate(date: string, count: number) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}
export function periodDates(days: number, now = new Date()) {
  const to = businessDate(now);
  return { from: shiftDate(to, 1 - days), to };
}
export type PeriodPreset = '7' | '30' | 'week' | 'month' | 'lastMonth' | '90' | 'year' | 'pickMonth' | 'custom';
export const periodLabels: Record<PeriodPreset, string> = {
  '7': '7 days',
  '30': '30 days',
  week: 'This week',
  month: 'This month',
  lastMonth: 'Last month',
  '90': 'Last 90 days',
  year: 'This year',
  pickMonth: 'Pick a month',
  custom: 'Custom',
};
const monthName = (month: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + '-01T00:00:00Z'));
const monthEnd = (month: string) => shiftDate(shiftDate(month + '-01', 32).slice(0, 7) + '-01', -1);
/**
 * Calendar ranges in the shop's business timezone (Asia/Dhaka). Partial
 * periods end today; the comparison window is the same length immediately
 * before, so "this month so far" is never compared with a full month.
 */
export function presetDates(preset: Exclude<PeriodPreset, 'custom'>, now = new Date(), month?: string) {
  const today = businessDate(now);
  switch (preset) {
    case '7':
    case '30':
    case '90':
      return { ...periodDates(Number(preset), now), label: periodLabels[preset] };
    case 'week': {
      // Weeks start on Saturday, the first working day in Bangladesh.
      const weekday = new Date(today + 'T00:00:00Z').getUTCDay();
      return { from: shiftDate(today, -((weekday + 1) % 7)), to: today, label: 'This week' };
    }
    case 'month':
      return { from: today.slice(0, 8) + '01', to: today, label: 'This month' };
    case 'lastMonth': {
      const last = shiftDate(today.slice(0, 8) + '01', -1).slice(0, 7);
      return { from: last + '-01', to: monthEnd(last), label: monthName(last) };
    }
    case 'year':
      return { from: today.slice(0, 4) + '-01-01', to: today, label: `${today.slice(0, 4)} so far` };
    case 'pickMonth': {
      // A future month (typed past the picker's limit) falls back to this month.
      const chosen = month && /^\d{4}-\d{2}$/.test(month) && month <= today.slice(0, 7) ? month : today.slice(0, 7);
      const end = monthEnd(chosen);
      return { from: chosen + '-01', to: end < today ? end : today, label: monthName(chosen) };
    }
  }
}
export interface CashflowRow {
  id: string;
  date: string;
  amount: number;
  direction: 'in' | 'out';
  method: PaymentMethod;
  source: 'sale' | 'sms' | 'manual';
  party: string;
  reference: string;
}
export type Bucket = 'day' | 'week' | 'month';
export function financeReport(w: Workspace, from: string, to: string) {
  const valid = (d: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    Number.isFinite(Date.parse(d)) &&
    new Date(d).toISOString().slice(0, 10) === d;
  if (!valid(from) || !valid(to)) throw new Error('Choose valid report dates.');
  const days = Math.round((Date.parse(to) - Date.parse(from)) / dayMs) + 1;
  if (days < 1 || days > 366) throw new Error('Choose a date range of 1 to 366 days.');
  const previousFrom = shiftDate(from, -days),
    previousTo = shiftDate(from, -1);
  const transactions = w.transactions || [];
  const rows: CashflowRow[] = w.sales.map((s) => ({
    id: s.id,
    date: businessDate(s.createdAt),
    amount: s.total,
    direction: 'in',
    method: s.method,
    source: 'sale',
    party: s.customer,
    reference: s.transactionId ? (transactions.find((t) => t.id === s.transactionId)?.reference ?? '') : '',
  }));
  for (const t of transactions) {
    if (t.business && !t.linkedSaleId && (t.currency ?? 'BDT') === 'BDT')
      rows.push({
        id: t.id,
        date: businessDate(t.occurredAt),
        amount: t.amount,
        direction: t.direction,
        method: t.method,
        source: t.source,
        party: t.party,
        reference: t.reference,
      });
  }
  const selected = rows.filter((r) => r.date >= from && r.date <= to);
  const sum = (items: CashflowRow[]) =>
    rounded(items.reduce((n, r) => n + Math.round(r.amount * 100), 0) / 100);
  const incoming = selected.filter((r) => r.direction === 'in');
  const income = sum(incoming),
    expenses = sum(selected.filter((r) => r.direction === 'out'));
  const previous = rows.filter((r) => r.date >= previousFrom && r.date <= previousTo);
  const previousIncome = sum(previous.filter((r) => r.direction === 'in')),
    previousExpenses = sum(previous.filter((r) => r.direction === 'out'));
  const daily = Array.from({ length: days }, (_, i) => {
    const date = shiftDate(from, i),
      records = selected.filter((r) => r.date === date);
    return {
      date,
      income: sum(records.filter((r) => r.direction === 'in')),
      expenses: sum(records.filter((r) => r.direction === 'out')),
    };
  });
  // Day bars up to a month, week bars up to a quarter, month bars beyond.
  const bucket: Bucket = days <= 31 ? 'day' : days <= 120 ? 'week' : 'month';
  const buckets: { key: string; from: string; to: string; income: number; expenses: number; count: number }[] = [];
  for (const d of daily) {
    const key = bucket === 'month' ? d.date.slice(0, 7) : bucket === 'week' ? shiftDate(from, Math.floor(Math.round((Date.parse(d.date) - Date.parse(from)) / dayMs) / 7) * 7) : d.date;
    let current = buckets[buckets.length - 1];
    if (!current || current.key !== key) buckets.push((current = { key, from: d.date, to: d.date, income: 0, expenses: 0, count: 0 }));
    current.to = d.date;
    current.income = rounded(current.income + d.income);
    current.expenses = rounded(current.expenses + d.expenses);
    current.count += selected.filter((r) => r.date === d.date).length;
  }
  const methods = (Object.keys(methodLabels) as PaymentMethod[])
    .map((method) => {
      const records = selected.filter((r) => r.method === method);
      return {
        method,
        value: sum(records.filter((r) => r.direction === 'in')),
        out: sum(records.filter((r) => r.direction === 'out')),
        count: records.length,
      };
    })
    .filter((m) => m.value > 0)
    .sort((a, b) => b.value - a.value);
  const payerTotals = new Map<string, { name: string; value: number; count: number }>();
  for (const r of incoming) {
    const name = r.party.trim() || (r.source === 'sale' ? 'Walk-in customers' : 'Unlabelled payer');
    const key = name.toLowerCase();
    const current = payerTotals.get(key) ?? { name, value: 0, count: 0 };
    current.value = rounded(current.value + r.amount);
    current.count++;
    payerTotals.set(key, current);
  }
  const best = [...buckets].sort((a, b) => b.income - a.income)[0];
  const periodTransactions = transactions.filter((t) => {
    const date = businessDate(t.occurredAt);
    return date >= from && date <= to;
  });
  const change = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 100) : null);
  return {
    from,
    to,
    days,
    previousFrom,
    previousTo,
    income,
    expenses,
    net: rounded(income - expenses),
    previousIncome,
    previousExpenses,
    change: change(income, previousIncome),
    expenseChange: change(expenses, previousExpenses),
    daily,
    bucket,
    buckets,
    best: best && best.income > 0 ? best : null,
    methods,
    topMethod: methods[0] ?? null,
    payers: [...payerTotals.values()].sort((a, b) => b.value - a.value).slice(0, 5),
    inflowCount: incoming.length,
    averageInflow: incoming.length ? rounded(income / incoming.length) : 0,
    rows: selected.sort((a, b) => b.date.localeCompare(a.date)),
    count: selected.length,
    personalCount: periodTransactions.filter((t) => !t.business).length,
    foreignCount: periodTransactions.filter((t) => (t.currency ?? 'BDT') !== 'BDT').length,
    activeDays: daily.filter((d) => d.income > 0).length,
    consistency: Math.round((daily.filter((d) => d.income > 0).length / days) * 100),
    largestDayShare: income
      ? Math.round((Math.max(...daily.map((d) => d.income)) / income) * 100)
      : 0,
    digitalShare: income
      ? Math.round((sum(incoming.filter((r) => r.method !== 'cash')) / income) * 100)
      : 0,
  };
}
/** A configurable annuity benchmark, not an affordability assessment or lender quote. */
export function borrowingEstimate(
  monthlyRevenue: number,
  annualRate = 12,
  months = 36,
  repaymentShare = 15,
) {
  if (
    ![monthlyRevenue, annualRate, months, repaymentShare].every(Number.isFinite) ||
    monthlyRevenue < 0 ||
    annualRate < 0 ||
    annualRate > 100 ||
    months < 1 ||
    months > 120 ||
    repaymentShare < 1 ||
    repaymentShare > 50
  )
    throw new Error('Invalid financing assumptions.');
  const monthlyBudget = rounded((monthlyRevenue * repaymentShare) / 100),
    rate = annualRate / 1200;
  const principal = monthlyBudget
    ? Math.floor(
        rate ? (monthlyBudget * (1 - Math.pow(1 + rate, -months))) / rate : monthlyBudget * months,
      )
    : 0;
  return { monthlyBudget, principal, annualRate, months, repaymentShare };
}
/** Average monthly business revenue over the last 90 days, floored at a 30-day span. */
export function monthlyBusinessRevenue(w: Workspace, now = new Date()) {
  const last90 = periodDates(90, now),
    recent = financeReport(w, last90.from, last90.to);
  const firstDate = [
    ...w.sales.map((s) => businessDate(s.createdAt)),
    ...(w.transactions || [])
      .filter((t) => t.business && (t.currency ?? 'BDT') === 'BDT')
      .map((t) => businessDate(t.occurredAt)),
  ].sort()[0];
  const observedDays = firstDate
    ? Math.min(90, Math.max(30, Math.ceil((Date.parse(last90.to) - Date.parse(firstDate)) / dayMs) + 1))
    : 90;
  return { monthlyRevenue: rounded((recent.income * 30) / observedDays), observedDays };
}
