import { describe, expect, it } from 'vitest';
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

describe('quantities as people say them', () => {
  const shop = [
    { id: 'lentils', name: 'Lentils', quantity: 10, unit: 'kg' },
    { id: 'notebook', name: 'Notebook', quantity: 50, unit: 'piece' },
    { id: 'egg', name: 'Egg', quantity: 60, unit: 'piece' },
    { id: 'oil', name: 'Soybean oil 1 L', quantity: 8, unit: 'bottle' },
  ] as Product[];
  const one = (text: string) => matchSaleText(text, shop);
  it.each([
    ['two notebooks', 'notebook', 2],
    ['lentils 2.5kg', 'lentils', 2.5],
    ['2.5 kg lentils', 'lentils', 2.5],
    ['১২টি egg', 'egg', 12],
    ['egg x 12', 'egg', 12],
    ['eggs 12 pcs', 'egg', 12],
    ['a dozen eggs', 'egg', 12],
    ['2 dozen egg', 'egg', 24],
    ['এক হালি egg', 'egg', 4],
    ['half kg lentils', 'lentils', 0.5],
    ['sell 3 notebook', 'notebook', 3],
    ['Soybean oil 1 L', 'oil', 1],
    ['Notebook', 'notebook', 1],
  ])('reads "%s"', (text, productId, quantity) => {
    expect(one(text)).toEqual({ items: [{ productId, quantity }], unmatched: [] });
  });
  it('flags a line with a number it cannot place instead of recording one', () => {
    expect(one('notebook 7 blue')).toEqual({ items: [], unmatched: ['notebook 7 blue'] });
  });
  it('adds repeated lines for the same product and stops at available stock', () => {
    expect(one('3 notebooks, 2 notebook')).toEqual({ items: [{ productId: 'notebook', quantity: 5 }], unmatched: [] });
    expect(one('11 kg lentils').unmatched).toEqual(['11 kg lentils']);
  });
});
