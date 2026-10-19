import type { Product } from './types';
const normalize = (s: string) =>
  s
    .toLocaleLowerCase()
    .replace(/[০-৯]/g, (c) => String(c.charCodeAt(0) - 0x09e6))
    .replace(/[^\p{L}\p{N}.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
export function matchSaleText(text: string, products: Product[]) {
  const items: { productId: string; quantity: number }[] = [],
    unmatched: string[] = [];
  for (const part of text
    .slice(0, 1000)
    .split(/,|;|\band\b|\bplus\b| এবং | আর /i)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const cleaned = normalize(part).replace(/^(?:sell|sold|give|sold me|বিক্রি)\s+/, '');
    const qty =
      cleaned.match(/^(\d+(?:\.\d{1,3})?)\s+(.+)$/) ||
      cleaned
        .match(/^(.+?)\s+(\d+(?:\.\d{1,3})?)$/)
        ?.map((v, i, a) => (i === 1 ? a[2] : i === 2 ? a[1] : v));
    const quantity = qty ? Number(qty[1]) : 1,
      query = qty?.[2] || cleaned;
    let candidates = products.filter((p) => normalize(p.name) === query);
    if (!candidates.length)
      candidates = products.filter(
        (p) => normalize(p.name).includes(query) || query.includes(normalize(p.name)),
      );
    if (candidates.length !== 1 || quantity <= 0 || quantity > candidates[0].quantity) {
      unmatched.push(part);
      continue;
    }
    const p = candidates[0],
      existing = items.find((i) => i.productId === p.id);
    if ((existing?.quantity || 0) + quantity > p.quantity) {
      unmatched.push(part);
      continue;
    }
    if (existing) existing.quantity = Math.round((existing.quantity + quantity) * 1000) / 1000;
    else items.push({ productId: p.id, quantity });
  }
  return { items, unmatched };
}
