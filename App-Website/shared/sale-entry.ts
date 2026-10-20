import type { Product } from './types';

/** Lower case, ASCII digits, punctuation to spaces, and digits split from a glued unit ("2.5kg" → "2.5 kg"). */
const normalize = (s: string) =>
  s
    .normalize('NFC')
    .toLocaleLowerCase()
    .replace(/[০-৯]/g, (c) => String(c.charCodeAt(0) - 0x09e6))
    .replace(/[^\p{L}\p{M}\p{N}.\s]/gu, ' ')
    .replace(/(\d)(?=[^\d\s.])/gu, '$1 ')
    .replace(/(^|\s)[x×](?=\d)/gu, '$1x ')
    .replace(/\s+/g, ' ')
    .trim();

const NUMBER_WORDS: Record<string, number> = Object.fromEntries(
  Object.entries({
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, half: 0.5,
    এক: 1, একটা: 1, একটি: 1, দুই: 2, দুটো: 2, দুটি: 2, তিন: 3, চার: 4, পাঁচ: 5, ছয়: 6, সাত: 7,
    আট: 8, নয়: 9, দশ: 10, আধা: 0.5, আধ: 0.5,
  }).map(([word, value]) => [word.normalize('NFC'), value]),
);
// Counts that multiply a number ("2 dozen eggs", "এক হালি ডিম" = 4 eggs).
const MULTIPLIERS: Record<string, number> = { dozen: 12, dozens: 12, ['ডজন'.normalize('NFC')]: 12, hali: 4, ['হালি'.normalize('NFC')]: 4 };
// Words that only say how the quantity is measured; they are dropped from the product search.
const UNITS = new Set([
  'kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'g', 'gm', 'gms', 'gram', 'grams', 'l', 'ltr', 'litre',
  'litres', 'liter', 'liters', 'ml', 'pc', 'pcs', 'piece', 'pieces', 'pack', 'packs', 'packet', 'packets', 'bottle',
  'bottles', 'box', 'boxes', 'bag', 'bags', 'ta', 'ti', 'x', 'of',
  'টি', 'টা', 'কেজি', 'গ্রাম', 'লিটার', 'পিস', 'প্যাকেট', 'বোতল', 'ব্যাগ',
]);

const isNumber = (token: string) => /^\d+(?:\.\d+)?$/.test(token);
const numberValue = (token: string) => (isNumber(token) ? Number(token) : NUMBER_WORDS[token]);

/** Reads "[number][multiplier]" from the given end of the tokens; returns the quantity and tokens used. */
function readQuantity(tokens: string[], fromEnd: boolean): { quantity: number; used: number } | null {
  const at = (i: number) => (fromEnd ? tokens[tokens.length - 1 - i] : tokens[i]);
  let i = 0;
  // Trailing form: "egg 12 pcs", "egg x 12". Units may follow the number at the end.
  if (fromEnd) while (i < tokens.length && UNITS.has(at(i)) && at(i) !== 'x') i++;
  if (fromEnd && at(i) !== undefined && MULTIPLIERS[at(i)] && numberValue(at(i + 1)) !== undefined) {
    const quantity = numberValue(at(i + 1))! * MULTIPLIERS[at(i)];
    return { quantity, used: i + 2 + (at(i + 2) === 'x' ? 1 : 0) };
  }
  if (fromEnd && at(i) !== undefined && MULTIPLIERS[at(i)]) return { quantity: MULTIPLIERS[at(i)], used: i + 1 };
  const value = at(i) === undefined ? undefined : numberValue(at(i));
  if (value === undefined) return null;
  let quantity = value;
  i++;
  if (fromEnd) {
    if (at(i) === 'x') i++;
    return { quantity, used: i };
  }
  if (at(i) !== undefined && MULTIPLIERS[at(i)]) {
    quantity *= MULTIPLIERS[at(i)];
    i++;
  }
  while (i < tokens.length && UNITS.has(at(i))) i++;
  return { quantity, used: i };
}

/** Offline, review-first sale matching: a line it cannot read is reported, never guessed. */
export function matchSaleText(text: string, products: Product[]) {
  const items: { productId: string; quantity: number }[] = [],
    unmatched: string[] = [];
  const names = products.map((p) => ({ product: p, name: normalize(p.name) }));
  for (const part of text
    .slice(0, 1000)
    .split(/,|;|\n|\band\b|\bplus\b| এবং | আর /i)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const cleaned = normalize(part).replace(/^(?:sell|sold|give|বিক্রি)\s+/, '');
    let quantity = 1;
    let query = cleaned;
    // The whole line naming a product exactly ("soybean oil 1 l") means one of it.
    if (!names.some((n) => n.name === cleaned)) {
      const tokens = cleaned.split(' ');
      const read = readQuantity(tokens, false) ?? readQuantity(tokens, true);
      if (read) {
        quantity = read.quantity;
        query = (readQuantity(tokens, false) ? tokens.slice(read.used) : tokens.slice(0, tokens.length - read.used))
          .filter((t) => !UNITS.has(t))
          .join(' ');
      } else if (tokens.some(isNumber)) {
        // A number we could not place: refuse rather than record a wrong quantity.
        unmatched.push(part);
        continue;
      }
    }
    quantity = Math.round(quantity * 1000) / 1000;
    const singular = query.replace(/(?:es|s)$/u, '');
    let candidates = names.filter((n) => n.name === query || n.name === singular);
    if (!candidates.length && query)
      candidates = names.filter(
        (n) =>
          n.name.includes(query) ||
          query.includes(n.name) ||
          (singular.length > 2 && (n.name.includes(singular) || singular.includes(n.name))),
      );
    const match = candidates.length === 1 ? candidates[0].product : undefined;
    const existing = match && items.find((i) => i.productId === match.id);
    if (!match || quantity <= 0 || (existing?.quantity || 0) + quantity > match.quantity) {
      unmatched.push(part);
      continue;
    }
    if (existing) existing.quantity = Math.round((existing.quantity + quantity) * 1000) / 1000;
    else items.push({ productId: match.id, quantity });
  }
  return { items, unmatched };
}
