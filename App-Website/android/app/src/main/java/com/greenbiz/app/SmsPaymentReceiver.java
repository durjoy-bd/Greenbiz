package com.greenbiz.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

public class SmsPaymentReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction()) || !PaymentInbox.prefs(context).getBoolean("enabled", false)) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts.length == 0) return;
        StringBuilder body = new StringBuilder(); for (SmsMessage part : parts) body.append(part.getMessageBody());
        SmsPaymentParser.Payment p = SmsPaymentParser.parse(parts[0].getOriginatingAddress(), body.toString(), parts[0].getTimestampMillis());
        if (p == null) return;
        try { PaymentInbox.add(context, p); } catch (Exception e) { return; }
        context.sendBroadcast(new Intent("com.greenbiz.app.PAYMENT_READY").setPackage(context.getPackageName()));
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel("payment-review", "Payment message review", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = new Intent(context, MainActivity.class).putExtra("greenbizPayments", true).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(context, 21, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String label = p.method.equals("bkash") ? "bKash" : p.method.equals("upi") ? "UPI" : p.method.substring(0, 1).toUpperCase(java.util.Locale.ROOT) + p.method.substring(1);
        String amount = (p.currency.equals("INR") ? "₹" : "৳") + java.text.NumberFormat.getNumberInstance(new java.util.Locale("en", "IN")).format(p.amount);
        String title = label + (p.direction.equals("in") ? " payment received" : " payment sent");
        String text = amount + (p.direction.equals("in") ? " · Tap to create a sale or review it" : " · Tap to review it in GreenBiz");
        // Private visibility keeps the amount off the lock screen; the public version is generic.
        NotificationCompat.Builder publicVersion = new NotificationCompat.Builder(context, "payment-review").setSmallIcon(R.drawable.greenbiz_logo).setContentTitle("GreenBiz payment message");
        manager.notify(21, new NotificationCompat.Builder(context, "payment-review").setSmallIcon(R.drawable.greenbiz_logo).setContentTitle(title).setContentText(text).setContentIntent(pending).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(publicVersion.build()).build());
    }
}
