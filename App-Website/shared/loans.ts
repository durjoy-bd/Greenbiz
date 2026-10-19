import plansData from './catalogue/plans.json';
import institutionsData from './catalogue/institutions.json';

/**
 * Loan affordability matching, ported from GreenBiz 1.x.
 *
 * The catalogue is the published Bangladeshi SME product table (39 products,
 * 8 banks) last checked on 18 October 2026. Every figure is an estimate from
 * published terms: lenders also check collateral, CIB history and documents.
 * Money is integer poisha internally; the public result is in taka.
 */
export type RepaymentFacility = 'term' | 'revolving' | 'interest_only' | 'bullet';
export type MatchPriority = 'high' | 'medium' | 'low' | 'unknown';

export interface Institution { id: string; name: string; institutionType: string; website: string | null; description: string }
export interface Eligibility {
  requiresCollateral?: boolean | null; collateralNote?: string; guarantorsRequired?: number | null;
  minBusinessAgeMonths?: number | null; minAgeYears?: number | null; maxAgeYears?: number | null;
  womenOwned?: boolean; requiresTradeLicence?: boolean; requiresBankTransactions?: boolean;
  minMonthlyRevenueMinor?: number | null; other?: string;
}
export interface Plan {
  id: string; institutionId: string; planName: string; serviceType: string; description: string;
  minAmountMinor: number | null; maxAmountMinor: number | null; interestRateMin: number | null; interestRateMax: number | null;
  durationMonths: number | null; eligibilityCriteria: Eligibility;
  feesDetails: { facility?: string; processingFeePct?: number | null; assumedTenorMonths?: number | null; rateNote?: string; other?: string };
  sourceUrl: string | null; lastVerifiedAt: number; isActive: boolean;
}
export const institutions = institutionsData as Institution[];
export const plans = (plansData as unknown as Plan[]).filter((plan) => plan.isActive);
export const catalogueCheckedAt = new Date(Math.max(...plans.map((plan) => plan.lastVerifiedAt))).toISOString();
export const institutionFor = (plan: Plan) => institutions.find((i) => i.id === plan.institutionId);

export const PRIORITY_RATIO_HIGH = 2;
export const PRIORITY_RATIO_MEDIUM = 1.3;
/** Instalment ceiling: half of monthly revenue, the same 2× rule as "high priority". */
export const MAX_DEBT_SERVICE_RATIO = 0.5;
export const DEFAULT_TENOR_MONTHS = 36;
const BENCHMARK_RATE_PCT = 12;
const BENCHMARK_TENOR_MONTHS = 36;
const MATCH_LIMIT = 12;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const monthlyRate = (annualPct: number) => annualPct / 100 / 12;
const toMinor = (taka: number) => Math.round((taka + Number.EPSILON) * 100);
const fromMinor = (minor: number) => minor / 100;
const formatMoney = (minor: number) => '৳' + Math.round(minor / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function amortizedEmiMinor(principal: number, annualPct: number, months: number): number {
  if (principal <= 0) return 0;
  if (months <= 0) return Math.round(principal);
  const rate = monthlyRate(annualPct);
  if (rate <= 0) return Math.round(principal / months);
  const growth = (1 + rate) ** months;
  return Math.round((principal * rate * growth) / (growth - 1));
}
export function affordablePrincipalMinor(emi: number, annualPct: number, months: number): number {
  if (emi <= 0) return 0;
  if (months <= 0) return Math.round(emi);
  const rate = monthlyRate(annualPct);
  if (rate <= 0) return Math.round(emi * months);
  const growth = (1 + rate) ** months;
  return Math.round((emi * (growth - 1)) / (rate * growth));
}
export const interestOnlyEmiMinor = (principal: number, annualPct: number) => (principal <= 0 ? 0 : Math.round(principal * monthlyRate(annualPct)));
export const repaymentEmiMinor = (principal: number, annualPct: number, months: number, facility: RepaymentFacility) =>
  facility === 'term' ? amortizedEmiMinor(principal, annualPct, months) : interestOnlyEmiMinor(principal, annualPct);
export const affordabilityRatio = (revenue: number, emi: number) => (emi <= 0 || revenue < 0 ? null : revenue / emi);
export function priorityForRatio(ratio: number | null): MatchPriority {
  if (ratio === null || !Number.isFinite(ratio)) return 'unknown';
  // Absorbs rounding down to whole thousands: a true 2.00× must stay "high".
  if (ratio >= PRIORITY_RATIO_HIGH - 0.005) return 'high';
  if (ratio >= PRIORITY_RATIO_MEDIUM - 0.005) return 'medium';
  return 'low';
}
export const affordableEmiMinor = (revenue: number) => Math.max(0, Math.round(revenue * MAX_DEBT_SERVICE_RATIO));
/** Rounds down so the suggested principal never pushes the instalment past the ceiling. */
export const floorToThousandMinor = (amount: number) => (amount <= 0 ? 0 : Math.floor(amount / 100_000) * 100_000);
const normalizeFacility = (value: unknown): RepaymentFacility =>
  value === 'revolving' || value === 'interest_only' || value === 'bullet' ? value : 'term';

function suggestedPrincipalMinor(revenue: number, annualPct: number, months: number, min: number | null, max: number | null): number | null {
  const emi = affordableEmiMinor(revenue);
  if (emi <= 0) return null;
  const principal = affordablePrincipalMinor(emi, annualPct, months);
  const floor = min ?? 0;
  if (principal < floor) return floor > 0 ? floor : null;
  return Math.round(clamp(principal, floor, max ?? Number.MAX_SAFE_INTEGER));
}

export const priorityLabels: Record<MatchPriority, string> = { high: 'High priority', medium: 'Good fit', low: 'Stretch', unknown: 'Terms on request' };
export const facilityLabels: Record<RepaymentFacility, string> = { term: 'Term loan', revolving: 'Revolving line', interest_only: 'Interest-only', bullet: 'Single repayment' };

export interface PlanMatch {
  plan: Plan; institution: string; fitScore: number; priority: MatchPriority;
  /** Monthly instalment in taka, or null without a published rate. */
  emi: number | null; suggestedAmount: number | null; affordabilityRatio: number | null;
  interestRate: number | null; tenorMonths: number | null; facility: RepaymentFacility;
  reasons: string[]; requirements: string[]; warnings: string[];
}
export interface LoanCapacity {
  monthlyRevenue: number; maxAffordableEmi: number; suggestedAmount: number; tenorMonths: number; interestRate: number;
  facility: RepaymentFacility; affordabilityRatio: number | null; priority: MatchPriority;
  basis: 'matched_plan' | 'indicative_benchmark' | 'insufficient_revenue'; planId?: string; assumptions: string[];
}
export interface MatchResult { matches: PlanMatch[]; ranked: PlanMatch[]; capacity: LoanCapacity; monthlyRevenue: number }

function evaluatePlan(plan: Plan, revenue: number, shopAgeMonths: number, requested?: number) {
  const eligibility = plan.eligibilityCriteria ?? {};
  const facility = normalizeFacility(plan.feesDetails?.facility);
  const tenorMonths = plan.durationMonths ?? plan.feesDetails?.assumedTenorMonths ?? DEFAULT_TENOR_MONTHS;
  const rate = plan.interestRateMin ?? plan.interestRateMax ?? null;
  const { minAmountMinor: min, maxAmountMinor: max } = plan;
  const reasons: string[] = [], requirements: string[] = [], warnings: string[] = [];

  let principal: number | null = null;
  let basis: 'requested' | 'affordable' | 'minimum' | 'none' = 'none';
  let requestedFits = true;
  if (requested !== undefined) {
    principal = clamp(requested, min ?? 0, max ?? Number.MAX_SAFE_INTEGER);
    basis = 'requested';
    requestedFits = (min === null || requested >= min) && (max === null || requested <= max);
    reasons.push(`You asked for ${formatMoney(requested)}.`);
    if (!requestedFits) warnings.push(`This product lends ${min !== null ? formatMoney(min) : 'any amount'}${max !== null ? ` to ${formatMoney(max)}` : ''}.`);
  } else if (rate !== null && tenorMonths > 0) {
    principal = suggestedPrincipalMinor(revenue, rate, tenorMonths, min, max);
    basis = principal !== null ? 'affordable' : 'none';
  } else if (min !== null) {
    principal = min;
    basis = 'minimum';
  }

  let emi: number | null = null, ratio: number | null = null;
  if (principal !== null && rate !== null) {
    emi = repaymentEmiMinor(principal, rate, tenorMonths, facility);
    // Revolving lines are tested as if repaid over the renewal period; otherwise
    // every cash-credit facility would look 30× affordable.
    ratio = affordabilityRatio(revenue, amortizedEmiMinor(principal, rate, tenorMonths));
  }
  const priority = priorityForRatio(ratio);
  if (emi !== null)
    reasons.push(facility === 'revolving' || facility === 'interest_only'
      ? `Interest-only about ${formatMoney(emi)}/month at ${rate!.toFixed(2)}% a year; affordability is checked as if the principal were repaid over ${tenorMonths} months.`
      : `Instalment about ${formatMoney(emi)}/month at ${rate!.toFixed(2)}% a year over ${tenorMonths} months.`);
  if (ratio !== null && revenue > 0) {
    const coverage = ratio.toFixed(1);
    reasons.push(priority === 'high'
      ? `Your average business revenue (${formatMoney(revenue)}/month) covers this ${coverage}× — high priority.`
      : priority === 'medium' ? `Your average revenue covers this ${coverage}× — possible, but keep a cash buffer.`
        : `Your average revenue covers this ${coverage}× — below the 2× comfort rule.`);
  } else if (revenue <= 0) warnings.push('No business revenue is recorded yet, so affordability cannot be checked.');
  if (basis === 'affordable' && principal !== null) reasons.push(`At half of your monthly revenue, this plan supports about ${formatMoney(floorToThousandMinor(principal))}.`);
  else if (basis === 'minimum' && principal !== null) reasons.push(`Published terms do not state a rate, so ${formatMoney(principal)} is the entry amount shown.`);

  if (eligibility.requiresCollateral === true) requirements.push(eligibility.collateralNote ? `Collateral: ${eligibility.collateralNote}` : 'Collateral or mortgage required');
  else if (eligibility.requiresCollateral === false) requirements.push(eligibility.collateralNote ? `Unsecured: ${eligibility.collateralNote}` : 'No collateral required');
  if (eligibility.guarantorsRequired) requirements.push(`${eligibility.guarantorsRequired} personal guarantee${eligibility.guarantorsRequired === 1 ? '' : 's'}`);
  const minAgeMonths = eligibility.minBusinessAgeMonths ?? null;
  if (minAgeMonths) {
    const years = Math.round(minAgeMonths / 12);
    requirements.push(`Business age of at least ${years} year${years === 1 ? '' : 's'}`);
    if (shopAgeMonths < minAgeMonths) warnings.push(`Your recorded business history is ${Math.max(0, Math.floor(shopAgeMonths))} months; the product asks for ${minAgeMonths}.`);
  }
  if (eligibility.womenOwned) requirements.push('Women-led business');
  const minAge = eligibility.minAgeYears ?? null, maxAge = eligibility.maxAgeYears ?? null;
  if (minAge !== null || maxAge !== null) requirements.push(minAge !== null && maxAge !== null ? `Owner age ${minAge}–${maxAge}` : minAge !== null ? `Owner age ${minAge}+` : `Owner age up to ${maxAge}`);
  if (eligibility.requiresTradeLicence) requirements.push('Valid trade licence');
  if (eligibility.requiresBankTransactions) requirements.push('Bank transaction history');
  if (eligibility.other) requirements.push(eligibility.other);
  const minRevenue = eligibility.minMonthlyRevenueMinor ?? null;
  if (minRevenue !== null) {
    requirements.push(`Monthly income of at least ${formatMoney(minRevenue)}`);
    if (revenue < minRevenue) warnings.push(`Your average revenue (${formatMoney(revenue)}/month) is below this product's minimum.`);
  }

  const affordabilityScore = ratio === null ? (revenue > 0 ? 0.15 : 0) : clamp(ratio / 3, 0, 1);
  const costScore = rate === null ? 0.3 : clamp(1 - (rate - 4) / 16, 0, 1);
  const trustScore = (institutionFor(plan)?.institutionType === 'commercial_bank' ? 1 : 0.8) * (plan.sourceUrl ? 1 : 0.9);
  let eligibilityScore = 1;
  if (!requestedFits) eligibilityScore -= 0.4;
  if (minRevenue !== null && revenue < minRevenue) eligibilityScore -= 0.3;
  if (minAgeMonths !== null && shopAgeMonths < minAgeMonths) eligibilityScore -= 0.2;
  const fitScore = Number(clamp(affordabilityScore * 0.55 + costScore * 0.25 + trustScore * 0.12 + clamp(eligibilityScore, 0, 1) * 0.08, 0, 1).toFixed(4));

  return {
    plan, institution: institutionFor(plan)?.name ?? 'Unknown provider', fitScore, priority,
    emi: emi === null ? null : fromMinor(emi),
    suggestedAmount: principal === null ? null : fromMinor(floorToThousandMinor(principal)),
    affordabilityRatio: ratio === null ? null : Number(ratio.toFixed(2)),
    interestRate: rate, tenorMonths: rate === null ? null : tenorMonths, facility, reasons, requirements, warnings,
  } satisfies PlanMatch;
}

function capacityFrom(ranked: PlanMatch[], revenue: number): LoanCapacity {
  if (revenue <= 0)
    return { monthlyRevenue: 0, maxAffordableEmi: 0, suggestedAmount: 0, tenorMonths: 0, interestRate: 0, facility: 'term', affordabilityRatio: null, priority: 'unknown', basis: 'insufficient_revenue', assumptions: ['Record business sales for at least a month so the estimate has revenue to work from.'] };
  const usable = ranked.filter((m) => m.emi !== null && (m.suggestedAmount ?? 0) > 0);
  // Largest serviceable amount inside a real product band; term plans preferred.
  const pick = (pool: PlanMatch[]) => {
    if (!pool.length) return undefined;
    const term = pool.filter((m) => m.facility === 'term' && (m.tenorMonths ?? 0) <= 72);
    return [...(term.length ? term : pool)].sort((a, b) => (b.suggestedAmount ?? 0) - (a.suggestedAmount ?? 0))[0];
  };
  const preferred = pick(usable.filter((m) => m.priority === 'high')) ?? pick(usable.filter((m) => m.priority === 'medium')) ?? pick(usable);
  const emi = affordableEmiMinor(revenue);
  if (preferred)
    return {
      monthlyRevenue: fromMinor(revenue), maxAffordableEmi: fromMinor(emi), suggestedAmount: preferred.suggestedAmount!, tenorMonths: preferred.tenorMonths ?? DEFAULT_TENOR_MONTHS,
      interestRate: preferred.interestRate ?? BENCHMARK_RATE_PCT, facility: preferred.facility, affordabilityRatio: preferred.affordabilityRatio, priority: preferred.priority,
      basis: 'matched_plan', planId: preferred.plan.id,
      assumptions: ['Instalment is capped at 50% of your average monthly business revenue.', `Based on ${preferred.institution} — ${preferred.plan.planName}.`, "Uses the plan's lowest stated rate and published tenor.", 'Indicative only. The lender checks collateral, CIB and documents.'],
    };
  const ratio = affordabilityRatio(revenue, emi);
  return {
    monthlyRevenue: fromMinor(revenue), maxAffordableEmi: fromMinor(emi), suggestedAmount: fromMinor(floorToThousandMinor(affordablePrincipalMinor(emi, BENCHMARK_RATE_PCT, BENCHMARK_TENOR_MONTHS))),
    tenorMonths: BENCHMARK_TENOR_MONTHS, interestRate: BENCHMARK_RATE_PCT, facility: 'term', affordabilityRatio: ratio, priority: priorityForRatio(ratio), basis: 'indicative_benchmark',
    assumptions: ['Instalment is capped at 50% of your average monthly business revenue.', `Benchmark: ${BENCHMARK_RATE_PCT}% a year over ${BENCHMARK_TENOR_MONTHS} months, because no catalogue product could be sized yet.`, 'Indicative only. The lender decides the final amount.'],
  };
}

/** Ranks every published product for this shop: priority, then fit, then the lower instalment. */
export function matchPlans(options: { monthlyRevenue: number; shopAgeMonths: number; requestedAmount?: number }): MatchResult {
  const revenue = toMinor(Math.max(0, options.monthlyRevenue));
  const requested = options.requestedAmount && options.requestedAmount > 0 ? toMinor(options.requestedAmount) : undefined;
  const rank = { high: 0, medium: 1, low: 2, unknown: 3 } as const;
  const ranked = plans
    .filter((plan) => plan.serviceType === 'loan' || plan.serviceType === 'working_capital')
    .map((plan) => evaluatePlan(plan, revenue, options.shopAgeMonths, requested))
    .sort((a, b) => rank[a.priority] - rank[b.priority] || b.fitScore - a.fitScore || (a.emi ?? Number.MAX_SAFE_INTEGER) - (b.emi ?? Number.MAX_SAFE_INTEGER));
  const capacity = capacityFrom(ranked, revenue);
  let matches = ranked.slice(0, MATCH_LIMIT);
  // The headline estimate's plan always appears in the list.
  const headline = ranked.find((m) => m.plan.id === capacity.planId);
  if (headline && !matches.includes(headline)) matches = [headline, ...matches.slice(0, MATCH_LIMIT - 1)];
  return { matches, ranked, capacity, monthlyRevenue: fromMinor(revenue) };
}
