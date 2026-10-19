/**
 * How far a mobile-money receipt may sit from the sale total and still be the
 * same payment. Cash-out charges run about 10–20 taka per thousand, and the
 * customer usually adds the charge (or the shop absorbs it), so the message is
 * a few taka away from the bill either way. Integer poisha arithmetic only.
 */
export const CASH_OUT_PER_THOUSAND_MAX = 20;
export const MIN_TOLERANCE_POISHA = 100;
/** A confirmation lands a minute or two after the customer pays. */
export const SUGGESTION_WINDOW_MINUTES = 10;
export const HISTORY_WINDOW_DAYS = 30;

const poisha = (taka: number) => Math.round((taka + Number.EPSILON) * 100);

/** The ± band, in taka, that still counts as the payment for a bill. */
export function paymentTolerance(total: number): number {
  const expected = poisha(total);
  if (expected <= 0) return 0;
  const twoPercent = Math.floor((expected * CASH_OUT_PER_THOUSAND_MAX) / 1000);
  return Math.max(MIN_TOLERANCE_POISHA, twoPercent) / 100;
}

export type AmountFit = 'exact' | 'cashOut' | 'outside';

export interface AmountMatch {
  fit: AmountFit;
  /** Signed taka: positive when the customer added the charge. */
  difference: number;
  tolerance: number;
  label: string;
}

const compact = (taka: number) =>
  '৳' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(taka);

export function matchAmount(received: number, total: number): AmountMatch {
  const difference = (poisha(received) - poisha(total)) / 100;
  const tolerance = paymentTolerance(total);
  const fit: AmountFit =
    poisha(received) <= 0 || poisha(total) <= 0
      ? 'outside'
      : difference === 0
        ? 'exact'
        : Math.abs(poisha(received) - poisha(total)) <= poisha(tolerance)
          ? 'cashOut'
          : 'outside';
  const signed = difference === 0 ? '' : (difference > 0 ? '+' : '−') + compact(Math.abs(difference));
  return {
    fit,
    difference,
    tolerance,
    label: fit === 'exact' ? 'Matches total' : fit === 'cashOut' ? `${signed} cash-out charge` : `${signed} away`,
  };
}

export const isAttachable = (received: number, total: number) =>
  matchAmount(received, total).fit !== 'outside';
