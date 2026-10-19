import { describe, expect, it } from 'vitest';
import { parsePaymentSms } from './sms';

const at = '2026-10-19T04:30:00.000Z';
describe('local payment message filtering', () => {
  it('uses the received amount, never the balance, and masks the counterparty', () => {
    expect(
      parsePaymentSms(
        'bKash',
        'You have received Tk 1,250.50 from 01712345678. Fee Tk 0.00. Balance Tk 8,210.00. TrxID AB12CD34EF at 19/10/2026',
        at,
      ),
    ).toMatchObject({
      amount: 1250.5,
      direction: 'in',
      method: 'bkash',
      reference: 'AB12CD34EF',
      party: '••••5678',
      business: false,
      source: 'sms',
    });
  });
  it('accepts provider debit confirmations and normalizes Bengali digits', () => {
    expect(
      parsePaymentSms(
        'NAGAD',
        'Money Received.\nAmount: Tk 500.00\nSender: 01712345678\nTxnID NG12345678\nBalance: Tk 900.',
        at,
      ),
    ).toMatchObject({ amount: 500, direction: 'in' });
    expect(
      parsePaymentSms(
        'NAGAD',
        'Payment Tk ২৫০.৫০ to 01812345678 successful. TxnID NG123456789. Balance Tk 900.',
        at,
      ),
    ).toMatchObject({ amount: 250.5, direction: 'out', method: 'nagad' });
    expect(
      parsePaymentSms('ROCKET', 'Tk 500.00 received from 01912345678. Txn ID RX123456789.', at)
        ?.amount,
    ).toBe(500);
    expect(
      parsePaymentSms(
        'AD-HDFCBK',
        'INR 199.50 credited to your account via UPI. Ref No 123456789012.',
        at,
      ),
    ).toMatchObject({ amount: 199.5, method: 'upi', direction: 'in' });
  });
  it('accepts provider short codes, Upay, merchant wording and Bangla amounts', () => {
    expect(
      parsePaymentSms('16247', 'You have received payment Tk 500.00 from 01712345678. TrxID BK12345678', at),
    ).toMatchObject({ method: 'bkash', direction: 'in', amount: 500 });
    expect(
      parsePaymentSms('16216', 'You have received Tk 1,000.00 from 01712345678. Reference: 123456789012.', at),
    ).toMatchObject({ method: 'rocket', amount: 1000 });
    expect(
      parsePaymentSms('16268', 'Cash In Tk 2,000.00 from 01712345678 successful. TrxID UP12345678', at),
    ).toMatchObject({ method: 'upay', direction: 'in', amount: 2000 });
    expect(
      parsePaymentSms('bKash', 'আপনি ১,৫০০.০০ টাকা পেয়েছেন ০১৭৮২৬৬৫৪৮৪ থেকে। TrxID DJG73D7KLD', at),
    ).toMatchObject({ method: 'bkash', direction: 'in', amount: 1500, party: '••••5484' });
    expect(
      parsePaymentSms('NAGAD', 'Payment of Tk 200.00 to MERCHANT successful. TrxID NG12345678', at),
    ).toMatchObject({ direction: 'out', amount: 200 });
  });
  it.each([
    ['01712345678', 'You received Tk 100 from 01811111111 TrxID AA12345678'],
    ['01711116247', 'You received Tk 100 from 01811111111 TrxID AA12345678'],
    ['bKash', 'Your OTP is 123456. You received Tk 100. TrxID AA12345678'],
    ['bKash', 'Your OTP123456. You received Tk 100. TrxID AA12345678'],
    ['bKash', 'Cashback offer! Get Tk 500. TrxID AA12345678'],
    ['bKash', 'Balance Tk 500. TrxID AA12345678'],
    ['bKash', 'Your payment request of Tk 500 is pending. TrxID AA12345678'],
    ['bKash', 'Payment failed. Tk 500 sent. TrxID AA12345678'],
    ['NAGAD', 'You received Tk 100. TrxID AA12345678. Verification code 123456'],
    ['bKash', 'You have received Tk 0.00. TrxID AA12345678'],
  ])('rejects unrecognized/private/promotional/unsuccessful messages (%s)', (sender, body) => {
    expect(parsePaymentSms(sender, body, at)).toBeNull();
  });
  it('deduplicates the same provider reference regardless of inbox row or timestamp', () => {
    const body = 'You received Tk 100. TrxID AA12345678.';
    expect(parsePaymentSms('bKash', body, at)?.id).toBe(
      parsePaymentSms('BKASH', body, '2026-10-18T04:30:00Z')?.id,
    );
    expect(JSON.stringify(parsePaymentSms('bKash', body, at))).not.toContain(body);
  });
});
