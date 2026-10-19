package com.greenbiz.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.provider.Telephony;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name="BusinessTools", permissions={
    @Permission(alias="sms", strings={Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS}),
    @Permission(alias="microphone", strings={Manifest.permission.RECORD_AUDIO}),
    @Permission(alias="notifications", strings={Manifest.permission.POST_NOTIFICATIONS})
})
public class BusinessToolsPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SpeechRecognizer recognizer; private PluginCall speechCall;
    private final android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable speechTimeout = () -> finishSpeech(null, "Speech timed out. Try again or type the sale.");
    private final BroadcastReceiver receiver = new BroadcastReceiver() { @Override public void onReceive(Context c, Intent i) { notifyListeners("paymentReady", new JSObject()); } };
    @Override public void load() { ContextCompat.registerReceiver(getContext(), receiver, new IntentFilter("com.greenbiz.app.PAYMENT_READY"), ContextCompat.RECEIVER_NOT_EXPORTED); }
    @PluginMethod public void status(PluginCall call) {
        JSObject result = new JSObject(); result.put("sms", getPermissionState("sms").toString()); result.put("notifications", Build.VERSION.SDK_INT < 33 ? "granted" : getPermissionState("notifications").toString());
        result.put("microphone", getPermissionState("microphone").toString()); result.put("enabled", PaymentInbox.prefs(getContext()).getBoolean("enabled", false)); result.put("speechAvailable", SpeechRecognizer.isRecognitionAvailable(getContext()));
        result.put("openPayments", getActivity().getIntent().getBooleanExtra("greenbizPayments", false)); getActivity().getIntent().removeExtra("greenbizPayments"); call.resolve(result);
    }
    @PluginMethod public void enableSms(PluginCall call) { if (!Boolean.TRUE.equals(call.getBoolean("enabled"))) { PaymentInbox.prefs(getContext()).edit().putBoolean("enabled", false).apply(); call.resolve(); return; } if (getPermissionState("sms") == PermissionState.GRANTED) enableGranted(call); else requestPermissionForAlias("sms", call, "enableGranted"); }
    @PermissionCallback private void enableGranted(PluginCall call) { if (getPermissionState("sms") != PermissionState.GRANTED) { call.reject("SMS access was not granted. You can paste payment messages manually."); return; } PaymentInbox.prefs(getContext()).edit().putBoolean("enabled", true).apply(); call.resolve(); }
    @PluginMethod public void requestNotifications(PluginCall call) { if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) call.resolve(); else requestPermissionForAlias("notifications", call, "notificationsGranted"); }
    @PermissionCallback private void notificationsGranted(PluginCall call) { if (getPermissionState("notifications") == PermissionState.GRANTED) call.resolve(); else call.reject("Notifications are off. Payment messages can still be reviewed inside GreenBiz."); }
    @PluginMethod public void openSettings(PluginCall call) { getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + getContext().getPackageName()))); call.resolve(); }
    @PluginMethod public void pending(PluginCall call) { JSObject result = new JSObject(); result.put("transactions", PaymentInbox.read(getContext())); call.resolve(result); }
    @PluginMethod public void acknowledge(PluginCall call) { try { PaymentInbox.acknowledge(getContext(), call.getArray("ids", new JSArray())); notifyListeners("paymentReady", new JSObject()); call.resolve(); } catch (Exception e) { call.reject("Could not update the local inbox."); } }
    @PluginMethod public void readInbox(PluginCall call) {
        if (!PaymentInbox.prefs(getContext()).getBoolean("enabled", false) || getPermissionState("sms") != PermissionState.GRANTED) { call.reject("Enable payment message access in Settings first."); return; }
        worker.execute(() -> {
            JSArray results = new JSArray(); java.util.HashSet<String> seen = new java.util.HashSet<>();
            long since = System.currentTimeMillis() - 90L * 86400000;
            try (Cursor cursor = getContext().getContentResolver().query(Telephony.Sms.Inbox.CONTENT_URI, new String[]{"address", "body", "date"}, "date >= ?", new String[]{Long.toString(since)}, "date DESC")) {
                if (cursor != null) while (cursor.moveToNext() && results.length() < 1000) {
                    SmsPaymentParser.Payment p = SmsPaymentParser.parse(cursor.getString(0), cursor.getString(1), cursor.getLong(2));
                    if (p != null && seen.add(p.id)) results.put(PaymentInbox.json(p));
                }
                JSObject response = new JSObject(); response.put("transactions", results); call.resolve(response);
            } catch (Exception e) { call.reject("Could not read payment messages. Check SMS permission in Android Settings."); }
        });
    }
    @PluginMethod public void speak(PluginCall call) { if (getPermissionState("microphone") == PermissionState.GRANTED) speakGranted(call); else requestPermissionForAlias("microphone", call, "speakGranted"); }
    @PermissionCallback private void speakGranted(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) { call.reject("Microphone access was not granted. Type your sale instead."); return; }
        getActivity().runOnUiThread(() -> {
            if (speechCall != null) { call.reject("A speech recording is already in progress."); return; }
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) { call.reject("Install or enable an Android speech service, or type your sale."); return; }
            speechCall = call;
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                public void onReadyForSpeech(Bundle b) {} public void onBeginningOfSpeech() {} public void onRmsChanged(float r) {} public void onBufferReceived(byte[] b) {} public void onEndOfSpeech() {} public void onPartialResults(Bundle b) {} public void onEvent(int t, Bundle b) {}
                public void onError(int error) { finishSpeech(null, "Could not recognize the sale (" + error + "). Try again or type it."); }
                public void onResults(Bundle b) { java.util.ArrayList<String> text = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION); finishSpeech(text == null || text.isEmpty() ? "" : text.get(0), null); }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_LANGUAGE, "bn".equals(call.getString("language")) ? "bn-BD" : "en-US").putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            try { recognizer.startListening(intent); mainHandler.postDelayed(speechTimeout, 30000); } catch (Exception e) { finishSpeech(null, "Speech service could not start. Type your sale instead."); }
        });
    }
    private void finishSpeech(String text, String error) { mainHandler.removeCallbacks(speechTimeout); PluginCall call = speechCall; speechCall = null; if (recognizer != null) { recognizer.destroy(); recognizer = null; } if (call != null) { if (error != null) call.reject(error); else { JSObject result = new JSObject(); result.put("text", text); call.resolve(result); } } }
    @PluginMethod public void cancelSpeech(PluginCall call) { getActivity().runOnUiThread(() -> { finishSpeech(null, "Speech cancelled."); call.resolve(); }); }
    @PluginMethod public void aiRequest(PluginCall call) {
        // Only these fixed providers may receive a device key. Redirects are forbidden.
        String provider = call.getString("provider", ""), model = call.getString("model", ""), key = call.getString("key", ""), body = call.getString("body", "");
        if ((!provider.equals("gemini") && !provider.equals("openrouter")) || !model.matches("[A-Za-z0-9_./:-]{1,160}") || key.length() < 10 || key.length() > 1000 || body.length() > 12_000_000) { call.reject("Invalid AI settings or request."); return; }
        worker.execute(() -> {
            HttpURLConnection connection = null;
            try {
                String endpoint = provider.equals("gemini") ? "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent" : "https://openrouter.ai/api/v1/chat/completions";
                connection = (HttpURLConnection) new URL(endpoint).openConnection(); connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(60000); connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty(provider.equals("gemini") ? "x-goog-api-key" : "Authorization", provider.equals("gemini") ? key : "Bearer " + key);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body.getBytes(StandardCharsets.UTF_8)); }
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) { call.reject("AI provider could not complete the request (HTTP " + status + "). Check your key, model and credit."); return; }
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream data = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192]; int n; while ((n = input.read(buffer)) != -1) { if (data.size() + n > 2_000_000) throw new IllegalStateException("Response too large"); data.write(buffer, 0, n); }
                    JSObject result = new JSObject(); result.put("body", data.toString("UTF-8")); call.resolve(result);
                }
            } catch (Exception e) { call.reject("Could not reach your AI provider. Check your connection and try again."); } finally { if (connection != null) connection.disconnect(); }
        });
    }
    @Override protected void handleOnPause() { getActivity().runOnUiThread(() -> finishSpeech(null, "Speech stopped while the app is in the background.")); }
    @Override protected void handleOnDestroy() { try { getContext().unregisterReceiver(receiver); } catch (Exception ignored) {} getActivity().runOnUiThread(() -> finishSpeech(null, "The screen was closed.")); worker.shutdownNow(); }
}
