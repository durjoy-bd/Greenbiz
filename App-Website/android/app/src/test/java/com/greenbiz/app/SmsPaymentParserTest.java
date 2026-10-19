package com.greenbiz.app;

import static org.junit.Assert.*;
import org.junit.Test;

public class SmsPaymentParserTest {
    private static final long AT = 1792384200000L;
    @Test public void filtersAndExtractsLocally() {
        SmsPaymentParser.Payment p = SmsPaymentParser.parse("bKash", "You have received Tk 1,250.50 from 01712345678. Fee Tk 0.00. Balance Tk 8,210.00. TrxID AB12CD34EF.", AT);
        assertNotNull(p); assertEquals(1250.50, p.amount, .001); assertEquals("in", p.direction); assertEquals("••••5678", p.party); assertFalse(p.id.contains("AB12CD34EF"));
        assertNull(SmsPaymentParser.parse("01712345678", "You received Tk 100. TrxID AA12345678", AT));
        assertNull(SmsPaymentParser.parse("bKash", "Your OTP123456. You received Tk 100. TrxID AA12345678", AT));
        assertNull(SmsPaymentParser.parse("bKash", "OTP 123456. You received Tk 100. TrxID AA12345678", AT));
        assertNull(SmsPaymentParser.parse("bKash", "Cashback offer! Tk 500 received. TrxID AA12345678", AT));
        assertNull(SmsPaymentParser.parse("bKash", "Payment failed. Tk 500 sent. TrxID AA12345678", AT));
        assertNull(SmsPaymentParser.parse("bKash", "Balance Tk 500. TrxID AA12345678", AT));
    }
    @Test public void handlesDebitsDigitsAndSeparateCurrency() {
        SmsPaymentParser.Payment received = SmsPaymentParser.parse("NAGAD", "Money Received.\nAmount: Tk 500.00\nSender: 01712345678\nTxnID NG12345678\nBalance: Tk 900.", AT);
        assertNotNull(received); assertEquals(500, received.amount, .001); assertEquals("in", received.direction);
        SmsPaymentParser.Payment nagad = SmsPaymentParser.parse("NAGAD", "Payment Tk ২৫০.৫০ to 01812345678 successful. TxnID NG123456789. Balance Tk 900.", AT);
        assertNotNull(nagad); assertEquals("out", nagad.direction); assertEquals(250.5, nagad.amount, .001);
        SmsPaymentParser.Payment upi = SmsPaymentParser.parse("AD-HDFCBK", "INR 199.50 credited to your account via UPI. Ref No 123456789012.", AT);
        assertNotNull(upi); assertEquals("INR", upi.currency); assertEquals("in", upi.direction);
    }
    @Test public void acceptsShortCodesUpayMerchantAndBanglaAmounts() {
        SmsPaymentParser.Payment merchant = SmsPaymentParser.parse("16247", "You have received payment Tk 500.00 from 01712345678. TrxID BK12345678", AT);
        assertNotNull(merchant); assertEquals("bkash", merchant.method); assertEquals("in", merchant.direction);
        SmsPaymentParser.Payment upay = SmsPaymentParser.parse("16268", "Cash In Tk 2,000.00 from 01712345678 successful. TrxID UP12345678", AT);
        assertNotNull(upay); assertEquals("upay", upay.method); assertEquals(2000, upay.amount, .001);
        SmsPaymentParser.Payment bangla = SmsPaymentParser.parse("bKash", "আপনি ১,৫০০.০০ টাকা পেয়েছেন ০১৭৮২৬৬৫৪৮৪ থেকে। TrxID DJG73D7KLD", AT);
        assertNotNull(bangla); assertEquals(1500, bangla.amount, .001); assertEquals("in", bangla.direction); assertEquals("••••5484", bangla.party);
        assertNull(SmsPaymentParser.parse("01711116247", "You received Tk 100. TrxID AA12345678", AT));
    }
    @Test public void identityIsStableAcrossInboxCopies() {
        String body = "You received Tk 100. TrxID AA12345678.";
        assertEquals(SmsPaymentParser.parse("bKash", body, AT).id, SmsPaymentParser.parse("BKASH", body, AT - 1000).id);
    }
}
