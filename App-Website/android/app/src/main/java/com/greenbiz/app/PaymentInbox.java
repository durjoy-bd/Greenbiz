package com.greenbiz.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

final class PaymentInbox {
    static SharedPreferences prefs(Context context) { return context.getSharedPreferences("greenbiz.payment.inbox", Context.MODE_PRIVATE); }
    static JSONObject json(SmsPaymentParser.Payment p) throws Exception {
        return new JSONObject().put("id", p.id).put("amount", p.amount).put("direction", p.direction).put("method", p.method).put("currency", p.currency).put("reference", p.reference).put("party", p.party).put("occurredAt", p.occurredAt).put("business", false).put("source", "sms").put("note", "Imported from a payment message. Review against your provider account.").put("message", p.message == null ? "" : p.message);
    }
    static synchronized JSONArray read(Context context) {
        try { return new JSONArray(prefs(context).getString("pending", "[]")); } catch (Exception e) { return new JSONArray(); }
    }
    static synchronized void add(Context context, SmsPaymentParser.Payment payment) throws Exception {
        JSONArray old = read(context), next = new JSONArray();
        for (int i = 0; i < old.length(); i++) if (old.getJSONObject(i).optString("id").equals(payment.id)) return;
        for (int i = Math.max(0, old.length() - 499); i < old.length(); i++) next.put(old.getJSONObject(i));
        next.put(json(payment)); if (!prefs(context).edit().putString("pending", next.toString()).commit()) throw new IllegalStateException("Inbox storage failed");
    }
    static synchronized void acknowledge(Context context, JSONArray ids) throws Exception {
        JSONArray old = read(context), next = new JSONArray();
        java.util.HashSet<String> found = new java.util.HashSet<>(); for (int i = 0; i < ids.length(); i++) found.add(ids.getString(i));
        for (int i = 0; i < old.length(); i++) if (!found.contains(old.getJSONObject(i).optString("id"))) next.put(old.getJSONObject(i));
        if (!prefs(context).edit().putString("pending", next.toString()).commit()) throw new IllegalStateException("Inbox storage failed");
    }
}
