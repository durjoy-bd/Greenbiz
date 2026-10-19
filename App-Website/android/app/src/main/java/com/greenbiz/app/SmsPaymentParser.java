package com.greenbiz.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Local filter only. A sender label is not authentication by a payment provider. Mirrors shared/sms.ts. */
public final class SmsPaymentParser {
    public static final class Payment {
        public String id, method, currency, direction, reference, party, occurredAt, message;
        public double amount;
    }
    private static final Pattern REJECT = Pattern.compile("\\b(?:otp[0-9]*|one[ -]?time|verification\\s+code|password|pin|cashback|promo|promotion|offer|discount|coupon|winner|prize|lottery|pending|failed|unsuccessful|declined|reversed|refund|request)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern INFLOW_BEFORE = Pattern.compile("(?:received(?:\\s+payment)?|cash\\s*in|credited|add(?:ed)?\\s+money|deposited|পেয়েছেন|পেয়েছেন)[.:\\s]*(?:amount\\s*[:=]?\\s*)?(?:of\\s*)?$", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern OUTFLOW_BEFORE = Pattern.compile("(?:sent|send\\s*money|payment|cash\\s*out|debited|paid)[.:\\s]*(?:amount\\s*[:=]?\\s*)?(?:of\\s*)?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern INFLOW_AFTER = Pattern.compile("^\\s*(?:has\\s+been\\s+|is\\s+)?(?:received|credited|পেয়েছেন|পেয়েছেন)", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern OUTFLOW_AFTER = Pattern.compile("^\\s*(?:has\\s+been\\s+|is\\s+)?(?:sent|debited|paid|পাঠিয়েছেন|পাঠিয়েছেন|সেন্ড)", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern EXCLUDED = Pattern.compile("(?:balance|available|fee|charge|limit|due)\\s*(?:is\\s*)?[:=]?\\s*$", Pattern.CASE_INSENSITIVE);
    private static final String NUMBER = "([0-9][0-9,]*(?:\\.[0-9]{1,2})?)";

    private static String match(String regex, String text) {
        Matcher matcher = Pattern.compile(regex, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE).matcher(text);
        return matcher.find() ? matcher.group(1) : null;
    }

    /** Numeric short codes must match exactly; bank headers may carry a two-letter operator prefix. */
    static String senderMethod(String sender) {
        String name = sender.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        if (name.matches("\\d+")) {
            switch (name) {
                case "16247": return "bkash";
                case "16167": case "16248": return "nagad";
                case "16216": case "16218": case "16222": return "rocket";
                case "16268": return "upay";
                default: return null;
            }
        }
        if (name.matches("bkash|bkashapp")) return "bkash";
        if (name.matches("nagad|nagadltd")) return "nagad";
        if (name.matches("rocket|dbbl|dutchbangla")) return "rocket";
        if (name.matches("upay|upaybd")) return "upay";
        if (name.matches("(?:[a-z]{2})?(?:hdfcbk|sbiupi|sbiinb|icicib|axisbk|kotakb|paytm|gpay|phonepe|bhim)")) return "upi";
        return null;
    }

    public static Payment parse(String sender, String raw, long timestamp) {
        if (sender == null || raw == null || raw.length() > 3000 || timestamp <= 0) return null;
        String method = senderMethod(sender);
        if (method == null) return null;
        StringBuilder normalized = new StringBuilder();
        for (char c : raw.toCharArray()) normalized.append(c >= '০' && c <= '৯' ? (char) ('0' + c - '০') : c);
        String body = normalized.toString();
        if (REJECT.matcher(body).find()) return null;
        String reference = match("\\b(?:trx\\s*id|txn\\s*id|transaction\\s*(?:id|no)|ref(?:erence)?\\s*(?:no|id)?)\\s*[:#.]?\\s*([A-Z0-9]{6,40})\\b", body);
        if (reference == null) return null;
        String currency = method.equals("upi") ? "INR" : "BDT";
        List<Pattern> patterns = new ArrayList<>();
        if (currency.equals("INR")) patterns.add(Pattern.compile("(?:INR|Rs\\.?|₹)\\s*" + NUMBER, Pattern.CASE_INSENSITIVE));
        else {
            patterns.add(Pattern.compile("(?:Tk\\.?|BDT|৳)\\s*" + NUMBER, Pattern.CASE_INSENSITIVE));
            patterns.add(Pattern.compile(NUMBER + "\\s*(?:Tk\\b|BDT\\b|taka\\b|টাকা)", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE));
        }
        // Candidates in reading order, whichever side of the number the currency sits on.
        List<int[]> spans = new ArrayList<>(); List<String> values = new ArrayList<>();
        for (Pattern pattern : patterns) {
            Matcher m = pattern.matcher(body);
            while (m.find()) {
                int at = 0; while (at < spans.size() && spans.get(at)[0] < m.start()) at++;
                spans.add(at, new int[] { m.start(), m.end() }); values.add(at, m.group(1));
            }
        }
        for (int i = 0; i < spans.size(); i++) {
            int start = spans.get(i)[0], end = spans.get(i)[1];
            String before = body.substring(Math.max(0, start - 55), start);
            String after = body.substring(end, Math.min(body.length(), end + 55));
            if (EXCLUDED.matcher(before).find()) continue;
            String direction = null;
            if (INFLOW_BEFORE.matcher(before).find() || INFLOW_AFTER.matcher(after).find()) direction = "in";
            else if (OUTFLOW_BEFORE.matcher(before).find() || OUTFLOW_AFTER.matcher(after).find()) direction = "out";
            if (direction == null) continue;
            double amount;
            try { amount = Double.parseDouble(values.get(i).replace(",", "")); } catch (NumberFormatException e) { return null; }
            if (Double.isNaN(amount) || Double.isInfinite(amount) || amount <= 0 || amount > 1_000_000_000) return null;
            Payment payment = new Payment(); payment.method = method; payment.currency = currency; payment.amount = amount; payment.direction = direction;
            payment.reference = reference.toUpperCase(Locale.ROOT);
            try {
                byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest((method + ":" + payment.reference).getBytes(java.nio.charset.StandardCharsets.UTF_8)); StringBuilder hex = new StringBuilder("sms-"); for (byte b : digest) hex.append(String.format(Locale.ROOT, "%02x", b & 0xff)); payment.id = hex.toString();
            } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
            java.text.SimpleDateFormat dateFormat = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT); dateFormat.setTimeZone(java.util.TimeZone.getTimeZone("UTC")); payment.occurredAt = dateFormat.format(new java.util.Date(timestamp));
            String phone = match("\\b(?:from|to)\\s+(?:(?:agent|customer|merchant|account)\\s+)?(?:\\+?88)?(01[0-9]{9})\\b", body);
            if (phone == null) phone = match("(?:\\+?88)?(01[0-9]{9})\\s*থেকে", body);
            payment.party = phone == null ? "" : "••••" + phone.substring(phone.length() - 4);
            // Kept only in the on-device review queue so the owner can read it; never imported or uploaded.
            payment.message = raw.length() > 1000 ? raw.substring(0, 1000) : raw;
            return payment;
        }
        return null;
    }
}
