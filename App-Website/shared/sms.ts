import type { FinancialTransaction, PaymentMethod } from './types';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Known payment senders. Numeric short codes must match exactly, so a personal
 * phone number that happens to end in 16247 is never trusted; alphanumeric bank
 * headers may carry a two-letter operator prefix such as "AD-" or "VM-".
 */
const SHORT_CODES: Record<string, PaymentMethod> = {
  '16247': 'bkash',
  '16167': 'nagad',
  '16248': 'nagad',
  '16216': 'rocket',
  '16218': 'rocket',
  '16222': 'rocket',
  '16268': 'upay',
};
const HEADERS: [RegExp, PaymentMethod][] = [
  [/^(?:bkash|bkashapp)$/, 'bkash'],
  [/^(?:nagad|nagadltd)$/, 'nagad'],
  [/^(?:rocket|dbbl|dutchbangla)$/, 'rocket'],
  [/^(?:upay|upaybd)$/, 'upay'],
  [/^(?:[a-z]{2})?(?:hdfcbk|sbiupi|sbiinb|icicib|axisbk|kotakb|paytm|gpay|phonepe|bhim)$/, 'upi'],
];
export function senderMethod(sender: string): PaymentMethod | null {
  const name = sender.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^\d+$/.test(name)) return SHORT_CODES[name] ?? null;
  return HEADERS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

const REJECT =
  /\b(?:otp[0-9]*|one[ -]?time|verification\s+code|password|pin|cashback|promo|promotion|offer|discount|coupon|winner|prize|lottery|pending|failed|unsuccessful|declined|reversed|refund|request)\b/i;
const INFLOW_BEFORE =
  /(?:received(?:\s+payment)?|cash\s*in|credited|add(?:ed)?\s+money|deposited|পেয়েছেন|পেয়েছেন)[.:\s]*(?:amount\s*[:=]?\s*)?(?:of\s*)?$/i;
const OUTFLOW_BEFORE =
  /(?:sent|send\s*money|payment|cash\s*out|debited|paid)[.:\s]*(?:amount\s*[:=]?\s*)?(?:of\s*)?$/i;
const INFLOW_AFTER = /^\s*(?:has\s+been\s+|is\s+)?(?:received|credited|পেয়েছেন|পেয়েছেন)/i;
const OUTFLOW_AFTER = /^\s*(?:has\s+been\s+|is\s+)?(?:sent|debited|paid|পাঠিয়েছেন|পাঠিয়েছেন|সেন্ড)/i;

/** Strict local heuristic, not a provider signature or proof that money arrived. */
export function parsePaymentSms(
  sender: string,
  raw: string,
  occurredAt: string,
): FinancialTransaction | null {
  const method = senderMethod(sender);
  if (!method || raw.length > 3000 || !Number.isFinite(Date.parse(occurredAt))) return null;
  const body = raw.replace(/[০-৯]/g, (c) => String(c.charCodeAt(0) - 0x09e6));
  if (REJECT.test(body)) return null;
  const ref = body
    .match(
      /\b(?:trx\s*id|txn\s*id|transaction\s*(?:id|no)|ref(?:erence)?\s*(?:no|id)?)\s*[:#.]?\s*([A-Z0-9]{6,40})\b/i,
    )?.[1]
    .toUpperCase();
  if (!ref) return null;
  const currency = method === 'upi' ? 'INR' : 'BDT';
  const number = '([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
  // The amount is written before ("Tk 500") or after ("500 টাকা") the number.
  const patterns =
    currency === 'INR'
      ? [new RegExp(`(?:INR|Rs\\.?|₹)\\s*${number}`, 'gi')]
      : [new RegExp(`(?:Tk\\.?|BDT|৳)\\s*${number}`, 'gi'), new RegExp(`${number}\\s*(?:Tk\\b|BDT\\b|taka\\b|টাকা)`, 'gi')];
  const candidates = patterns
    .flatMap((pattern) => [...body.matchAll(pattern)])
    .sort((a, b) => a.index! - b.index!);
  // The currency amount must belong to a transfer phrase, not to a later fee or balance.
  let amount = 0;
  let direction: 'in' | 'out' | null = null;
  for (const match of candidates) {
    const before = body.slice(Math.max(0, match.index! - 55), match.index);
    const after = body.slice(match.index! + match[0].length, match.index! + match[0].length + 55);
    if (/(?:balance|available|fee|charge|limit|due)\s*(?:is\s*)?[:=]?\s*$/i.test(before)) continue;
    if (INFLOW_BEFORE.test(before) || INFLOW_AFTER.test(after)) direction = 'in';
    else if (OUTFLOW_BEFORE.test(before) || OUTFLOW_AFTER.test(after)) direction = 'out';
    if (direction) {
      amount = Number(match[1].replace(/,/g, ''));
      break;
    }
  }
  if (!direction || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return null;
  const phone = body.match(
    /\b(?:from|to)\s+(?:(?:agent|customer|merchant|account)\s+)?(?:\+?88)?(01[0-9]{9})\b/i,
  )?.[1] ?? body.match(/(?:\+?88)?(01[0-9]{9})\s*থেকে/)?.[1];
  const id = 'sms-' + bytesToHex(sha256(new TextEncoder().encode(method + ':' + ref)));
  return {
    id,
    amount,
    direction,
    method,
    currency,
    reference: ref,
    party: phone ? '••••' + phone.slice(-4) : '',
    occurredAt: new Date(occurredAt).toISOString(),
    business: false,
    source: 'sms',
    note: 'Imported from a payment message. Review against your provider account.',
  };
}
