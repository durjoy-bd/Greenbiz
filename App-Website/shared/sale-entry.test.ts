import { expect, it } from 'vitest';
import { matchSaleText } from './sale-entry';
import type { Product } from './types';
const products = [
  { id: 'rice', name: 'Miniket rice', quantity: 20, unit: 'kg' },
  { id: 'oil', name: 'Soybean oil', quantity: 5, unit: 'bottle' },
  { id: 'brown', name: 'Brown rice', quantity: 3, unit: 'kg' },
] as Product[];
it('builds a reviewed list from quantities and exact names, including Bengali digits', () => {
  expect(matchSaleText('২.৫ Miniket rice and 1 Soybean oil', products)).toEqual({
    items: [
      { productId: 'rice', quantity: 2.5 },
      { productId: 'oil', quantity: 1 },
    ],
    unmatched: [],
  });
});
it('does not invent a match or quantity for ambiguous or excessive stock requests', () => {
  const result = matchSaleText('2 rice, 9 Soybean oil, 1 soap', products);
  expect(result.items).toEqual([]);
  expect(result.unmatched).toHaveLength(3);
});
