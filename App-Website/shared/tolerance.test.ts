import { describe, expect, it } from 'vitest';
import { matchAmount, paymentTolerance } from './tolerance';

describe('cash-out tolerance', () => {
  it.each([
    [500, 10],
    [1000, 20],
    [10000, 200],
    [30, 1],
    [0, 0],
  ])('a %s taka bill tolerates %s taka', (bill, tolerance) => {
    expect(paymentTolerance(bill)).toBe(tolerance);
  });
  it('labels exact, charged and distant amounts', () => {
    expect(matchAmount(1000, 1000)).toMatchObject({ fit: 'exact', label: 'Matches total' });
    expect(matchAmount(1015, 1000)).toMatchObject({ fit: 'cashOut', difference: 15, label: '+৳15 cash-out charge' });
    expect(matchAmount(980, 1000)).toMatchObject({ fit: 'cashOut', difference: -20 });
    expect(matchAmount(1020.01, 1000).fit).toBe('outside');
    expect(matchAmount(0, 1000).fit).toBe('outside');
  });
});
