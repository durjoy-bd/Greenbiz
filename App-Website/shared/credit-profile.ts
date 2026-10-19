import type { Workspace } from './types';

/**
 * Behavioural credit profile (0–100), ported from GreenBiz 1.x.
 *
 * Rule-based and explainable: every factor fits in one sentence. Trailing 90
 * days of business BDT records only — sales plus unlinked business receipts and
 * expenses. Personal and foreign-currency records are excluded, and a receipt
 * linked to a sale counts once (as the sale). All money is integer poisha.
 */
export const WINDOW_DAYS = 90;
/** ৳20,000 a month scores full marks on volume. */
export const REFERENCE_MONTHLY_INFLOW = 20_000;
export const FACTOR_WEIGHTS = { consistency: 0.3, volume: 0.25, stability: 0.25, activity: 0.2 } as const;
export type FactorName = keyof typeof FACTOR_WEIGHTS;

export interface CreditFactor { name: FactorName; title: string; score: number; weight: number; label: string }
export interface CreditProfile {
  score: number;
  band: 'Strong' | 'Building' | 'Early' | 'No data yet';
  factors: CreditFactor[];
  /** Average monthly business inflow, in taka. */
  monthlyRevenue: number;
  monthlyVolatility: number;
  transactionCount: number;
  riskFlags: string[];
  risks: string[];
  improvements: string[];
}
export interface CreditInput { direction: 'in' | 'out'; amount: number; occurredAt: string; counterparty?: string }

const DAY_MS = 86_400_000;
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const poisha = (taka: number) => Math.round((taka + Number.EPSILON) * 100);

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean <= 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}
const monthKey = (ms: number) => {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const bandForScore = (score: number): CreditProfile['band'] =>
  score >= 70 ? 'Strong' : score >= 40 ? 'Building' : score > 0 ? 'Early' : 'No data yet';

const RISK_TEXT: Record<string, string> = {
  no_activity: 'No business records in the last 90 days yet.',
  no_inflow: 'No money coming in has been recorded yet.',
  insufficient_history: 'Fewer than 10 records so far — more history gives a steadier score.',
  low_activity: 'Sales are concentrated in a few days. Recording more days helps.',
  high_volatility: 'Monthly revenue swings a lot. Lenders prefer steadier months.',
  revenue_declining: 'Revenue is down more than 30% versus the previous month.',
  counterparty_concentration: 'Most revenue comes from one payer, which is a concentration risk.',
};
const FACTOR_TIPS: Record<FactorName, string> = {
  consistency: 'Record sales every week, including small ones, so income looks steady week to week.',
  volume: 'Record every business receipt — mobile money, bank and cash — so monthly turnover is complete.',
  stability: 'Plan stock for slow months so revenue does not drop sharply from one month to the next.',
  activity: 'Record something on more days: sales, expenses and stock purchases all count as activity.',
};

/** Pure: the same records and clock always give the same profile. */
export function computeCreditProfile(records: CreditInput[], now = new Date()): CreditProfile {
  const nowMs = now.getTime();
  const windowStart = nowMs - WINDOW_DAYS * DAY_MS;
  const windowed = records
    .map((record) => ({ ...record, at: Date.parse(record.occurredAt), minor: poisha(record.amount) }))
    .filter((record) => Number.isFinite(record.at) && record.at >= windowStart && record.at <= nowMs && record.minor > 0);
  const inflows = windowed.filter((record) => record.direction === 'in');
  const totalInflow = inflows.reduce((sum, record) => sum + record.minor, 0);

  // Activity: share of the last 90 days with any record.
  const activeDayRatio = new Set(windowed.map((record) => Math.floor(record.at / DAY_MS))).size / WINDOW_DAYS;
  const activity = clamp(activeDayRatio * 100);

  // Volume: monthly inflow against the reference, over the observed span
  // floored at 30 days so three good days are not extrapolated tenfold.
  const earliest = windowed.reduce((min, record) => Math.min(min, record.at), nowMs);
  const divisorDays = Math.min(WINDOW_DAYS, Math.max(30, (nowMs - earliest) / DAY_MS));
  const monthlyRevenueMinor = Math.round((totalInflow / divisorDays) * 30);
  const volume = clamp((monthlyRevenueMinor / poisha(REFERENCE_MONTHLY_INFLOW)) * 100);

  // Stability: inverse month-over-month volatility; needs two months.
  const byMonth = new Map<string, number>();
  for (const record of inflows) byMonth.set(monthKey(record.at), (byMonth.get(monthKey(record.at)) ?? 0) + record.minor);
  const monthValues = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  const monthlyVolatility = monthValues.length >= 2 ? coefficientOfVariation(monthValues) : 0;
  const stability = monthValues.length >= 2 ? clamp((1 - monthlyVolatility) * 100) : 0;

  // Consistency: weekly inflow spread; zero weeks count against it.
  const weekly: number[] = [];
  for (let week = 0; week < WINDOW_DAYS / 7; week += 1) {
    const end = nowMs - week * 7 * DAY_MS;
    weekly.push(inflows.filter((record) => record.at > end - 7 * DAY_MS && record.at <= end).reduce((sum, record) => sum + record.minor, 0));
  }
  const weeksWithInflow = weekly.filter((value) => value > 0).length;
  const consistency = weeksWithInflow >= 2 ? clamp((1 - coefficientOfVariation(weekly)) * 100) : 0;

  const factors: CreditFactor[] = [
    { name: 'consistency', title: 'Consistency', score: Math.round(consistency), weight: FACTOR_WEIGHTS.consistency, label: 'How evenly sales are spread week to week' },
    { name: 'volume', title: 'Sales volume', score: Math.round(volume), weight: FACTOR_WEIGHTS.volume, label: 'Monthly money coming in, against a ৳20,000 reference turnover' },
    { name: 'stability', title: 'Stability', score: Math.round(stability), weight: FACTOR_WEIGHTS.stability, label: 'How steady monthly revenue is (less swing is better)' },
    { name: 'activity', title: 'Activity', score: Math.round(activity), weight: FACTOR_WEIGHTS.activity, label: 'Share of the last 90 days with any recorded activity' },
  ];
  const raw = consistency * FACTOR_WEIGHTS.consistency + volume * FACTOR_WEIGHTS.volume + stability * FACTOR_WEIGHTS.stability + activity * FACTOR_WEIGHTS.activity;

  const riskFlags: string[] = [];
  if (!windowed.length) riskFlags.push('no_activity');
  if (windowed.length > 0 && windowed.length < 10) riskFlags.push('insufficient_history');
  if (totalInflow === 0) riskFlags.push('no_inflow');
  if (activeDayRatio < 0.15 && windowed.length > 0) riskFlags.push('low_activity');
  if (monthlyVolatility > 0.6) riskFlags.push('high_volatility');
  if (monthValues.length >= 2) {
    const previous = monthValues[monthValues.length - 2], latest = monthValues[monthValues.length - 1];
    if (previous > 0 && latest < previous * 0.7) riskFlags.push('revenue_declining');
  }
  if (totalInflow > 0) {
    const byPayer = new Map<string, number>();
    for (const record of inflows) {
      const key = record.counterparty?.trim().toLowerCase() || 'unlabelled';
      byPayer.set(key, (byPayer.get(key) ?? 0) + record.minor);
    }
    if (byPayer.size >= 2 && Math.max(...byPayer.values()) / totalInflow > 0.85) riskFlags.push('counterparty_concentration');
  }
  const score = Math.round(clamp(raw));
  return {
    score,
    band: bandForScore(score),
    factors,
    monthlyRevenue: monthlyRevenueMinor / 100,
    monthlyVolatility: Number(monthlyVolatility.toFixed(4)),
    transactionCount: windowed.length,
    riskFlags,
    risks: riskFlags.map((flag) => RISK_TEXT[flag] ?? flag.replaceAll('_', ' ')),
    improvements: factors.filter((factor) => factor.score < 60).sort((a, b) => a.score * a.weight - b.score * b.weight).map((factor) => FACTOR_TIPS[factor.name]),
  };
}

/** Business BDT records from a workspace; linked receipts count once, as their sale. */
export function businessRecords(w: Workspace): CreditInput[] {
  return [
    ...w.sales.map((sale) => ({ direction: 'in' as const, amount: sale.total, occurredAt: sale.createdAt, counterparty: sale.customer })),
    ...(w.transactions ?? [])
      .filter((t) => t.business && !t.linkedSaleId && (t.currency ?? 'BDT') === 'BDT')
      .map((t) => ({ direction: t.direction, amount: t.amount, occurredAt: t.occurredAt, counterparty: t.party })),
  ];
}

export const creditProfile = (w: Workspace, now = new Date()) => computeCreditProfile(businessRecords(w), now);
